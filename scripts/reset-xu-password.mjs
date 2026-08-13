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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const service = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

const authId = "f96f5769-7fd2-4238-ada4-5600354ad499";
const email = "j_kyo@vegecoop.co.jp";
const password = "general1";

await service.auth.admin.updateUserById(authId, { email, password, email_confirm: true });
console.log("Reset 許 password to general1");

for (const testEmail of ["j_kyo@vegecoop.co.jp", "help@vegecoop.co.jp"]) {
  const { error } = await anon.auth.signInWithPassword({ email: testEmail, password });
  console.log(testEmail, error ? `FAIL: ${error.message}` : "OK");
  await anon.auth.signOut();
}
