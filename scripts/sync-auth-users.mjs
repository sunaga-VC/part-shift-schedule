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

const service = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

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

async function main() {
  const { data: profiles, error: profileError } = await service
    .from("staff_profiles")
    .select("id, email, last_name, first_name, role, admin_permission, status")
    .order("last_name");
  if (profileError) throw profileError;

  const authUsers = await listAllAuthUsers();
  const authById = Object.fromEntries(authUsers.map((u) => [u.id, u]));
  const authByEmail = Object.fromEntries(
    authUsers.filter((u) => u.email).map((u) => [u.email.trim().toLowerCase(), u])
  );

  console.log("=== 診断 ===");
  for (const profile of profiles ?? []) {
    const email = (profile.email ?? "").trim().toLowerCase();
    const authByProfileId = authById[profile.id];
    const authByProfileEmail = email ? authByEmail[email] : null;
    const issues = [];
    if (!authByProfileId && !authByProfileEmail) {
      issues.push("Auth なし");
    } else {
      if (authByProfileId && email && (authByProfileId.email ?? "").trim().toLowerCase() !== email) {
        issues.push(`Auth メール不一致 (Auth=${authByProfileId.email}, profile=${profile.email})`);
      }
      if (authByProfileEmail && authByProfileEmail.id !== profile.id) {
        issues.push(`Auth ID 不一致 (Auth ID=${authByProfileEmail.id}, profile ID=${profile.id})`);
      }
    }
    if (profile.status !== "active") issues.push("無効");
    const label = `${profile.last_name}${profile.first_name ? " " + profile.first_name : ""}`.trim();
    console.log(
      JSON.stringify({
        name: label,
        role: profile.role,
        email: profile.email,
        profileId: profile.id,
        issues: issues.length ? issues : ["OK"],
      })
    );
  }

  console.log("\n=== 同期 ===");
  const results = [];
  for (const profile of profiles ?? []) {
    const email = (profile.email ?? "").trim().toLowerCase();
    if (!email) {
      results.push(`SKIP ${profile.id}: email empty`);
      continue;
    }

    for (const auth of authUsers.filter((u) => u.email?.trim().toLowerCase() === email && u.id !== profile.id)) {
      const { error } = await service.auth.admin.deleteUser(auth.id);
      if (error) throw error;
      results.push(`DELETE duplicate auth ${auth.email} id=${auth.id}`);
    }

    const { data: byId, error: getError } = await service.auth.admin.getUserById(profile.id);
    if (getError) throw getError;

    if (!byId.user) {
      results.push(`WARN ${profile.id} (${email}): Auth ユーザーなし`);
      continue;
    }

    if ((byId.user.email ?? "").trim().toLowerCase() !== email) {
      const { error: updateError } = await service.auth.admin.updateUserById(profile.id, {
        email,
        email_confirm: true,
      });
      if (updateError) throw updateError;
      results.push(`SYNC ${profile.id} auth email -> ${email}`);
    }
  }

  for (const result of results) {
    console.log(result);
  }
  if (results.length === 0) {
    console.log("変更なし");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
