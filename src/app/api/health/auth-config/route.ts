import { NextResponse } from "next/server";

/** ログイン障害の切り分け用（秘密値は返さない） */
export async function GET() {
  const url = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
  const serviceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  return NextResponse.json({
    ok: url && anonKey && serviceRole,
    supabaseUrl: url,
    anonKey,
    serviceRole,
    nodeEnv: process.env.NODE_ENV ?? "unknown",
  });
}
