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
const EMAIL = "recruiting@example.co.jp";
const PASSWORD = "admin01";

if (!url || !serviceKey || !anonKey) {
  console.error("Missing env vars");
  process.exit(1);
}

const service = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { data: profile, error: profileError } = await service
    .from("staff_profiles")
    .select("id, email, last_name, role, admin_permission, status")
    .eq("email", EMAIL)
    .maybeSingle();
  if (profileError) throw profileError;
  console.log("profile:", profile ?? "NOT FOUND");
  if (!profile) process.exit(1);

  const { data: authList, error: listError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;
  const authByEmail = authList.users.find((u) => u.email?.toLowerCase() === EMAIL);
  const authById = authList.users.find((u) => u.id === profile.id);
  console.log("auth by email:", authByEmail ? { id: authByEmail.id, email: authByEmail.email } : "NOT FOUND");
  console.log("auth by profile id:", authById ? { id: authById.id, email: authById.email } : "NOT FOUND");

  const authId = authById?.id ?? authByEmail?.id;
  if (!authId) {
    const { data: created, error: createError } = await service.auth.admin.createUser({
      id: profile.id,
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
    });
    if (createError) throw createError;
    console.log("created auth:", created.user?.id);
  } else {
    const { error: updateError } = await service.auth.admin.updateUserById(authId, {
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
    });
    if (updateError) throw updateError;
    console.log("updated auth password for:", authId);
    if (authId !== profile.id) {
      console.warn("WARN: auth id != profile id", { authId, profileId: profile.id });
    }
  }

  const { error: signInError } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  console.log("login test:", signInError ? signInError.message : "OK");
  await anon.auth.signOut();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
