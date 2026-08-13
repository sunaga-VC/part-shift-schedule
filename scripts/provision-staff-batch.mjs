import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です。");
  process.exit(1);
}

const departmentName = process.argv[2];
if (!departmentName) {
  console.error("Usage: node scripts/provision-staff-batch.mjs <department> '<lastName,firstName,email,password>' ...");
  process.exit(1);
}

/** @type {Array<{ lastName: string; firstName: string; email: string; password: string }>} */
const staff = process.argv.slice(3).map((entry) => {
  const [lastName, firstName, email, password] = entry.split(",");
  if (!lastName || !firstName || !email || !password) {
    throw new Error(`Invalid staff entry: ${entry}`);
  }
  return { lastName, firstName, email, password };
});

if (staff.length === 0) {
  console.error("スタッフ情報を1件以上指定してください。");
  process.exit(1);
}

const service = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findAuthUserByEmail(email) {
  let page = 1;
  const target = email.toLowerCase();
  while (page <= 20) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === target);
    if (found) return found;
    if (data.users.length < 1000) break;
    page += 1;
  }
  return null;
}

async function ensureDepartmentId(name) {
  const { data, error } = await service.from("departments").select("id").eq("name", name).maybeSingle();
  if (error) throw error;
  if (data?.id) return data.id;

  const { data: created, error: insertError } = await service
    .from("departments")
    .insert({ name, is_fixed: false, sort_order: 99 })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      const { data: retry, error: retryError } = await service
        .from("departments")
        .select("id")
        .eq("name", name)
        .maybeSingle();
      if (retryError) throw retryError;
      if (retry?.id) return retry.id;
    }
    throw insertError;
  }
  return created.id;
}

async function ensureStaff(member, departmentId) {
  const { data: existingProfile } = await service
    .from("staff_profiles")
    .select("id, email")
    .eq("email", member.email)
    .maybeSingle();

  if (existingProfile) {
    const { error: updateError } = await service
      .from("staff_profiles")
      .update({
        last_name: member.lastName,
        first_name: member.firstName,
        display_given_name: true,
        icon_label: member.lastName.slice(0, 1),
        department_id: departmentId,
        role: "worker",
        admin_permission: "general",
        status: "active",
        weekly_contract_hours: 20,
        social_insurance: false,
        contract_renewal_months: 3,
      })
      .eq("id", existingProfile.id);
    if (updateError) throw updateError;

    const authUser = await findAuthUserByEmail(member.email);
    if (authUser) {
      const { error: authUpdateError } = await service.auth.admin.updateUserById(authUser.id, {
        password: member.password,
        email_confirm: true,
      });
      if (authUpdateError) throw authUpdateError;
      return { status: "updated", email: member.email, name: `${member.lastName} ${member.firstName}` };
    }

    const { data: created, error: createError } = await service.auth.admin.createUser({
      email: member.email,
      password: member.password,
      email_confirm: true,
    });
    if (createError || !created.user) throw createError ?? new Error("Auth create failed");
    if (created.user.id !== existingProfile.id) {
      await service.auth.admin.deleteUser(created.user.id);
      throw new Error("既存 profile ID と新規 Auth ID が一致しません");
    }
    return { status: "updated_auth", email: member.email, name: `${member.lastName} ${member.firstName}` };
  }

  const existingAuth = await findAuthUserByEmail(member.email);
  if (existingAuth) {
    const { data: orphanProfile } = await service
      .from("staff_profiles")
      .select("id")
      .eq("id", existingAuth.id)
      .maybeSingle();
    if (orphanProfile) {
      throw new Error("Auth は存在するが profile も別 ID で存在");
    }
    const { error: deleteError } = await service.auth.admin.deleteUser(existingAuth.id);
    if (deleteError) throw deleteError;
  }

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email: member.email,
    password: member.password,
    email_confirm: true,
  });
  if (createError || !created.user) throw createError ?? new Error("Auth create failed");

  const { error: profileError } = await service.from("staff_profiles").insert({
    id: created.user.id,
    email: member.email,
    last_name: member.lastName,
    first_name: member.firstName,
    display_given_name: true,
    icon_label: member.lastName.slice(0, 1),
    department_id: departmentId,
    role: "worker",
    admin_permission: "general",
    status: "active",
    weekly_contract_hours: 20,
    social_insurance: false,
    contract_renewal_months: 3,
    hourly_wage: 0,
    google_email: "",
    note: "",
  });

  if (profileError) {
    await service.auth.admin.deleteUser(created.user.id);
    throw profileError;
  }

  return { status: "created", email: member.email, name: `${member.lastName} ${member.firstName}` };
}

async function verifyLogin(email, password) {
  const { error } = await anon.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, message: error.message };
  await anon.auth.signOut();
  return { ok: true };
}

async function main() {
  const departmentId = await ensureDepartmentId(departmentName);
  console.log(JSON.stringify({ department: departmentName, departmentId }));

  const results = [];
  for (const member of staff) {
    try {
      const result = await ensureStaff(member, departmentId);
      results.push(result);
      console.log(JSON.stringify(result));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ status: "error", email: member.email, name: `${member.lastName} ${member.firstName}`, message });
      console.error(JSON.stringify({ status: "error", email: member.email, message }));
    }
  }

  console.log("\n--- login verification ---");
  for (const member of staff) {
    const login = await verifyLogin(member.email, member.password);
    console.log(JSON.stringify({ email: member.email, login: login.ok ? "ok" : login.message }));
  }

  const created = results.filter((r) => r.status === "created").length;
  const updated = results.filter((r) => r.status?.startsWith("updated")).length;
  const errors = results.filter((r) => r.status === "error").length;
  console.log(`\nDone: created=${created}, updated=${updated}, errors=${errors}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
