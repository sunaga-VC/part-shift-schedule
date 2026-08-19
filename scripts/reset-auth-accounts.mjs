import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import canonicalAccountData from "../src/lib/supabase/canonicalAuthAccounts.json" with { type: "json" };

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

const ACCOUNTS = canonicalAccountData.accounts;

const service = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function listAllAuthUsers() {
  const users = [];
  let page = 1;
  while (page <= 20) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
    page += 1;
  }
  return users;
}

async function getDepartmentMap() {
  const { data, error } = await service.from("departments").select("id, name");
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((row) => [row.name, row.id]));
}

async function findProfile(account) {
  const { data: byEmail, error } = await service
    .from("staff_profiles")
    .select("id, email, last_name, role, admin_permission")
    .in("email", account.matchEmails);
  if (error) throw error;
  if (byEmail?.[0]) return byEmail[0];

  if (account.findByAdminPermission) {
    const { data: byPerm, error: permError } = await service
      .from("staff_profiles")
      .select("id, email, last_name, role, admin_permission")
      .eq("admin_permission", account.findByAdminPermission)
      .eq("role", "admin")
      .limit(1);
    if (permError) throw permError;
    if (byPerm?.[0]) return byPerm[0];
  }

  const { data: byName, error: nameError } = await service
    .from("staff_profiles")
    .select("id, email, last_name, role, admin_permission")
    .eq("last_name", account.lastName)
    .eq("role", account.role)
    .limit(1);
  if (nameError) throw nameError;
  return byName?.[0] ?? null;
}

async function ensureProfile(account, departmentByName) {
  const existing = await findProfile(account);
  if (existing) return existing;

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email: account.loginEmail,
    password: account.password,
    email_confirm: true,
  });
  if (createError || !created.user) throw createError ?? new Error("Auth create failed");

  const departmentId = departmentByName[account.departmentName] ?? null;
  const { error: profileError } = await service.from("staff_profiles").insert({
    id: created.user.id,
    email: account.loginEmail,
    last_name: account.lastName,
    first_name: account.firstName ?? "",
    display_given_name: Boolean(account.firstName),
    icon_label: account.lastName.slice(0, 1),
    department_id: departmentId,
    role: account.role,
    admin_permission: account.adminPermission,
    status: "active",
    weekly_contract_hours: account.role === "admin" ? 40 : 20,
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

  return { id: created.user.id, email: account.loginEmail };
}

async function syncManagedDepartments(staffId, departmentNames, departmentByName) {
  await service.from("staff_managed_departments").delete().eq("staff_id", staffId);
  for (const name of departmentNames) {
    const departmentId = departmentByName[name];
    if (!departmentId) continue;
    await service.from("staff_managed_departments").insert({ staff_id: staffId, department_id: departmentId });
  }
}

async function verifyLogin(email, password) {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, message: error.message };
  await anon.auth.signOut();
  return { ok: true };
}

async function main() {
  const results = [];
  const keptProfileIds = new Set();
  const keptEmails = new Set(ACCOUNTS.map((a) => a.loginEmail.toLowerCase()));
  const departmentByName = await getDepartmentMap();
  let authUsers = await listAllAuthUsers();

  for (const account of ACCOUNTS) {
    const loginEmail = account.loginEmail.toLowerCase();
    const profile = await ensureProfile(account, departmentByName);
    keptProfileIds.add(profile.id);

    const departmentId = departmentByName[account.departmentName] ?? null;
    const { error: profileUpdateError } = await service
      .from("staff_profiles")
      .update({
        email: account.loginEmail,
        last_name: account.lastName,
        first_name: account.firstName ?? "",
        display_given_name: Boolean(account.firstName),
        icon_label: account.lastName.slice(0, 1),
        department_id: departmentId,
        role: account.role,
        admin_permission: account.adminPermission,
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile.id);
    if (profileUpdateError) throw profileUpdateError;
    results.push(`PROFILE ${profile.id} -> ${account.loginEmail}`);

    if (account.role === "admin" && account.managedDepartments.length > 0) {
      await syncManagedDepartments(profile.id, account.managedDepartments, departmentByName);
    }

    for (const aliasEmail of new Set([loginEmail, ...account.matchEmails.map((e) => e.toLowerCase())])) {
      for (const auth of authUsers.filter((u) => u.email?.toLowerCase() === aliasEmail)) {
        if (auth.id === profile.id) continue;
        const { error } = await service.auth.admin.deleteUser(auth.id);
        if (error) throw error;
        results.push(`DELETE duplicate ${auth.email} ${auth.id}`);
        authUsers = authUsers.filter((u) => u.id !== auth.id);
      }
    }

    const { data: byId } = await service.auth.admin.getUserById(profile.id);
    if (byId.user) {
      const { error } = await service.auth.admin.updateUserById(profile.id, {
        email: account.loginEmail,
        password: account.password,
        email_confirm: true,
      });
      if (error) throw error;
      results.push(`UPDATE auth ${account.loginEmail}`);
    } else {
      const { error } = await service.auth.admin.createUser({
        id: profile.id,
        email: account.loginEmail,
        password: account.password,
        email_confirm: true,
      });
      if (error) throw error;
      results.push(`CREATE auth ${account.loginEmail}`);
    }
  }

  const { data: allProfiles, error: allProfilesError } = await service
    .from("staff_profiles")
    .select("id, email, last_name");
  if (allProfilesError) throw allProfilesError;

  for (const profile of allProfiles ?? []) {
    if (keptProfileIds.has(profile.id)) continue;
    const { error } = await service.auth.admin.deleteUser(profile.id);
    if (error) {
      results.push(`WARN delete profile auth ${profile.email ?? profile.id}: ${error.message}`);
      continue;
    }
    results.push(`DELETE profile+auth ${profile.email ?? profile.last_name ?? profile.id}`);
  }

  authUsers = await listAllAuthUsers();
  for (const auth of authUsers) {
    if (keptProfileIds.has(auth.id)) continue;
    if (auth.email && keptEmails.has(auth.email.toLowerCase())) continue;
    const { error } = await service.auth.admin.deleteUser(auth.id);
    if (error) throw error;
    results.push(`DELETE orphan auth ${auth.email ?? auth.id}`);
  }

  results.push("--- login check ---");
  for (const account of ACCOUNTS) {
    const check = await verifyLogin(account.loginEmail, account.password);
    results.push(
      check.ok ? `OK login ${account.loginEmail}` : `FAIL login ${account.loginEmail}: ${check.message}`
    );
  }

  console.log(results.join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
