import { NextResponse } from "next/server";
import { requireAuthenticatedProfileService } from "@/lib/supabase/adminApi";
import {
  persistWorkerDesiredShiftsToSupabase,
  type ShiftPersistenceSnapshot,
} from "@/lib/supabase/shiftPersistence";

type WorkerShiftsBody = {
  snapshot?: ShiftPersistenceSnapshot;
};

/** アルバイトの希望シフト保存（service role 経由、staff_profiles.id 基準） */
export async function POST(request: Request) {
  const auth = await requireAuthenticatedProfileService();
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as WorkerShiftsBody;
  const snapshot = body.snapshot;
  if (!snapshot?.period?.id) {
    return NextResponse.json({ ok: false, message: "シフト情報が不正です。" }, { status: 400 });
  }

  try {
    const periodId = await persistWorkerDesiredShiftsToSupabase(auth.service, snapshot, auth.profileId);
    return NextResponse.json({ ok: true, periodId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "希望シフトの保存に失敗しました。";
    console.error("POST /api/shifts/worker failed", error);
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
