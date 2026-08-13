import { NextResponse } from "next/server";
import { getServiceClient, requireFullManagerService } from "@/lib/supabase/adminApi";
import { syncAuthUsersToStaffProfiles } from "@/lib/supabase/syncAuthUsers";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, message: "Not available in production." }, { status: 404 });
  }

  const auth = await requireFullManagerService();
  if (!auth.ok) return auth.response;

  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ ok: false, message: "Service client is unavailable." }, { status: 500 });
  }

  const result = await syncAuthUsersToStaffProfiles(service);
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, results: result.results });
}

export async function GET() {
  return POST();
}
