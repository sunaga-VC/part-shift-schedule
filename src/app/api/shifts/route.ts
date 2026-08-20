import { NextResponse } from "next/server";
import { requireAdminService, requireAuthenticatedProfileService } from "@/lib/supabase/adminApi";
import {
  createEmptyShiftPersistenceFallback,
  filterShiftSnapshotForWorker,
  loadShiftSnapshotFromSupabase,
  loadWorkerPublishContext,
  persistShiftSnapshotToSupabase,
  resolveWorkerStaffIdFromSnapshot,
  type ShiftPersistenceSnapshot,
} from "@/lib/supabase/shiftPersistence";

type UpdateShiftsBody = {
  snapshot?: ShiftPersistenceSnapshot;
};

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

/** シフトスナップショット取得（service role 経由、RLS を回避） */
export async function GET() {
  const auth = await requireAuthenticatedProfileService();
  if (!auth.ok) return auth.response;

  try {
    const snapshot = await loadShiftSnapshotFromSupabase(
      auth.service,
      createEmptyShiftPersistenceFallback()
    );
    let filteredSnapshot = snapshot;
    if (auth.role === "worker") {
      const baseContext = await loadWorkerPublishContext(auth.service, auth.profileId);
      const staffId = resolveWorkerStaffIdFromSnapshot(snapshot, [
        auth.profileId,
        auth.authUserId,
        baseContext.staffId,
      ]);
      const workerTeam =
        baseContext.staffList.find((staff) => staff.id === staffId)?.team ?? baseContext.workerTeam;
      filteredSnapshot = filterShiftSnapshotForWorker(snapshot, {
        ...baseContext,
        staffId,
        workerTeam,
      });
    }
    return NextResponse.json(
      { ok: true, snapshot: filteredSnapshot },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = errorMessage(error, "シフト情報の取得に失敗しました。");
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminService();
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as UpdateShiftsBody;
  const snapshot = body.snapshot;
  if (!snapshot?.period?.id) {
    return NextResponse.json({ ok: false, message: "シフト情報が不正です。" }, { status: 400 });
  }

  try {
    await persistShiftSnapshotToSupabase(auth.service, snapshot);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = errorMessage(error, "シフト保存に失敗しました。");
    console.error("POST /api/shifts failed", error);
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
