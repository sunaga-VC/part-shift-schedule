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

/** @type {const} */
const STAFF = [
  { lastName: "伊藤", firstName: "咲夢", email: "vegeintern01@vegecoop.co.jp", password: "vegepart@01", department: "リクルーティング" },
  { lastName: "塚田", firstName: "真希仁", email: "vegeintern11@vegecoop.co.jp", password: "vegeintern@11", department: "リクルーティング" },
  { lastName: "火ノ口", firstName: "紗彩和", email: "vegeintern25@vegecoop.co.jp", password: "vegepart@25", department: "リクルーティング" },
  { lastName: "小森", firstName: "まな", email: "vegeintern14@vegecoop.co.jp", password: "vegepart@14", department: "リクルーティング" },
  { lastName: "中城", firstName: "杏", email: "vegeintern24@vegecoop.co.jp", password: "vegepart@24", department: "リクルーティング" },
  { lastName: "島田", firstName: "陽大", email: "vegeintern27@vegecoop.co.jp", password: "vegepart@27", department: "リクルーティング" },
  { lastName: "本多", firstName: "陽向", email: "vegeintern28@vegecoop.co.jp", password: "vegepart@28", department: "リクルーティング" },
  { lastName: "嘉本", firstName: "有恭", email: "vegeintern29@vegecoop.co.jp", password: "vegepart@29", department: "リクルーティング" },
  { lastName: "阿部", firstName: "優正", email: "vegeintern30@vegecoop.co.jp", password: "vegepart@30", department: "リクルーティング" },
  { lastName: "渡邉", firstName: "琴実", email: "vegeintern31@vegecoop.co.jp", password: "vegepart@31", department: "リクルーティング" },
  { lastName: "原", firstName: "亜沙美", email: "vegeintern04@vegecoop.co.jp", password: "vegepart@04", department: "業務" },
  { lastName: "宮﨑", firstName: "莉理子", email: "vegeintern32@vegecoop.co.jp", password: "vegepart@32", department: "業務" },
];

const service = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
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

function profilePayload(member, departmentId) {
  return {
    last_name: member.lastName,
    first_name: member.firstName,
    display_given_name: false,
    icon_label: member.lastName.slice(0, 1),
    department_id: departmentId,
    role: "worker",
    admin_permission: "general",
    status: "active",
    weekly_contract_hours: 20,
    social_insurance: false,
    contract_renewal_months: 3,
  };
}

async function ensureStaff(member, departmentId) {
  const { data: existingProfile } = await service
    .from("staff_profiles")
    .select("id, email, last_name, first_name, role, department_id, social_insurance")
    .eq("email", member.email)
    .maybeSingle();

  if (existingProfile) {
    const { error: updateError } = await service
      .from("staff_profiles")
      .update(profilePayload(member, departmentId))
      .eq("id", existingProfile.id);
    if (updateError) throw updateError;

    const authUser = await findAuthUserByEmail(member.email);
    if (authUser) {
      const { error: authUpdateError } = await service.auth.admin.updateUserById(authUser.id, {
        email: member.email,
        password: member.password,
        email_confirm: true,
      });
      if (authUpdateError) throw authUpdateError;
      if (authUser.id !== existingProfile.id) {
        return {
          status: "skipped_mismatch",
          message: `${member.lastName} ${member.firstName}: profile と auth の ID が一致しません (profile=${existingProfile.id}, auth=${authUser.id})`,
        };
      }
      return { status: "updated", email: member.email, name: `${member.lastName} ${member.firstName}` };
    }

    const { data: created, error: createError } = await service.auth.admin.createUser({
      id: existingProfile.id,
      email: member.email,
      password: member.password,
      email_confirm: true,
    });
    if (createError || !created.user) throw createError ?? new Error("Auth create failed");
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
      return {
        status: "skipped",
        message: `${member.lastName} ${member.firstName}: Auth は存在するが profile も別 ID で存在`,
      };
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
    ...profilePayload(member, departmentId),
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
  const departmentIds = new Map();
  for (const name of new Set(STAFF.map((member) => member.department))) {
    departmentIds.set(name, await ensureDepartmentId(name));
    console.log(JSON.stringify({ department: name, departmentId: departmentIds.get(name) }));
  }

  const results = [];
  for (const member of STAFF) {
    const departmentId = departmentIds.get(member.department);
    if (!departmentId) {
      results.push({
        status: "error",
        email: member.email,
        name: `${member.lastName} ${member.firstName}`,
        message: `所属「${member.department}」が見つかりません`,
      });
      continue;
    }
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
  for (const member of STAFF) {
    const login = await verifyLogin(member.email, member.password);
    console.log(JSON.stringify({ email: member.email, login: login.ok ? "ok" : login.message }));
  }

  const created = results.filter((r) => r.status === "created").length;
  const updated = results.filter((r) => r.status?.startsWith("updated")).length;
  const errors = results.filter((r) => r.status === "error" || r.status?.startsWith("skipped")).length;
  console.log(`\nDone: created=${created}, updated=${updated}, skipped/errors=${errors}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
