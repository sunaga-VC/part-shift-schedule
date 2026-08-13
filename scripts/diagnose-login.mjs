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
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !serviceKey || !anonKey) {
  console.error("Missing env vars");
  process.exit(1);
}

const TARGETS = [
  { label: "許", email: "j_kyo@vegecoop.co.jp", altEmails: ["help@vegecoop.co.jp", "j_ky@vegecoop.co.jp"], password: "general1" },
  { label: "須永", email: "recruiting@example.co.jp", altEmails: ["vegeintern01@vegecoop.co.jp"], password: "admin01" },
];

const service = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

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

async function diagnoseTarget(target) {
  console.log(`\n======== ${target.label} (${target.email}) ========`);

  const { data: profileByEmail, error: profileErr } = await service
    .from("staff_profiles")
    .select("id, email, last_name, first_name, role, admin_permission, status")
    .eq("email", target.email)
    .maybeSingle();
  if (profileErr) console.log("profile error:", profileErr.message);
  console.log("profile by login email:", profileByEmail ?? "NOT FOUND");

  for (const alt of target.altEmails) {
    const { data: altProfile } = await service
      .from("staff_profiles")
      .select("id, email, last_name, role, status")
      .eq("email", alt)
      .maybeSingle();
    if (altProfile) console.log(`profile by alt ${alt}:`, altProfile);
  }

  const authUsers = await listAllAuthUsers();
  const authByLogin = authUsers.find((u) => u.email?.trim().toLowerCase() === target.email.toLowerCase());
  console.log("auth by login email:", authByLogin ? { id: authByLogin.id, email: authByLogin.email, confirmed: authByLogin.email_confirmed_at } : "NOT FOUND");

  if (profileByEmail) {
    const authById = authUsers.find((u) => u.id === profileByEmail.id);
    console.log("auth by profile id:", authById ? { id: authById.id, email: authById.email } : "NOT FOUND");
    if (authById && authById.email?.toLowerCase() !== target.email.toLowerCase()) {
      console.log("!! MISMATCH: auth email != profile email");
    }
    if (authById && authById.id !== profileByEmail.id) {
      console.log("!! MISMATCH: auth id != profile id");
    }
  }

  // Try login with canonical password
  const { data: signInData, error: signInError } = await anon.auth.signInWithPassword({
    email: target.email,
    password: target.password,
  });
  if (signInError) {
    console.log(`login test (${target.password}): FAILED -`, signInError.message);
  } else {
    console.log(`login test (${target.password}): OK`, { authId: signInData.user?.id, authEmail: signInData.user?.email });
    if (profileByEmail && signInData.user?.id !== profileByEmail.id) {
      console.log("!! login auth id != profile id");
    }
    await anon.auth.signOut();
  }

  // Reset password to known value if login failed
  if (signInError && profileByEmail) {
    const authId = authUsers.find((u) => u.id === profileByEmail.id)?.id
      ?? authUsers.find((u) => u.email?.trim().toLowerCase() === target.email.toLowerCase())?.id;
    if (authId) {
      console.log(`Attempting password reset for auth id ${authId}...`);
      const { error: resetErr } = await service.auth.admin.updateUserById(authId, {
        password: target.password,
        email: target.email,
        email_confirm: true,
      });
      if (resetErr) {
        console.log("password reset FAILED:", resetErr.message);
      } else {
        console.log("password reset OK, retrying login...");
        const { error: retryErr } = await anon.auth.signInWithPassword({
          email: target.email,
          password: target.password,
        });
        console.log(retryErr ? `retry login FAILED: ${retryErr.message}` : "retry login OK");
        await anon.auth.signOut();
      }
    }
  }
}

async function main() {
  for (const target of TARGETS) {
    await diagnoseTarget(target);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
