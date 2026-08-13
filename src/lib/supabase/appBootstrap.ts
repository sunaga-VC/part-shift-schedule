import type { HomeMessage } from "@/lib/shift/types";
import type { AuthenticatedProfileOk } from "@/lib/supabase/adminApi";
import { loadHomeMessagesFromSupabase } from "@/lib/supabase/homeMessages";
import {
  buildWorkerPublishContextFromStaffList,
  createEmptyShiftPersistenceFallback,
  filterShiftSnapshotForWorker,
  loadShiftSnapshotFromSupabase,
  resolveWorkerStaffIdFromSnapshot,
  type ShiftPersistenceSnapshot,
} from "@/lib/supabase/shiftPersistence";
import { loadStaffBootstrapFromService, type StaffBootstrap } from "@/lib/supabase/staff";

export type AppBootstrapPayload = {
  bootstrap: StaffBootstrap;
  snapshot: ShiftPersistenceSnapshot;
  messages: HomeMessage[];
};

/** 初回読み込み用: スタッフ・シフト・お知らせを1リクエスト分で並列取得 */
export async function loadAppBootstrapForAuth(auth: AuthenticatedProfileOk): Promise<AppBootstrapPayload | null> {
  const fallback = createEmptyShiftPersistenceFallback();
  const normalizedEmail = auth.email.trim().toLowerCase();

  const departmentResult = await auth.service
    .from("departments")
    .select("id, name, sort_order")
    .order("sort_order", { ascending: true });
  if (departmentResult.error) {
    throw new Error(departmentResult.error.message);
  }

  const departmentRows = departmentResult.data ?? [];
  const departmentNameById = Object.fromEntries(departmentRows.map((d) => [d.id, d.name]));
  const departmentNames = departmentRows.map((d) => d.name).filter((name) => name !== "本部");

  const [bootstrap, snapshotRaw, messages] = await Promise.all([
    loadStaffBootstrapFromService(auth.service, auth.authUserId, normalizedEmail, departmentRows),
    loadShiftSnapshotFromSupabase(auth.service, fallback, departmentRows),
    loadHomeMessagesFromSupabase(auth.service, departmentNameById),
  ]);

  if (!bootstrap) return null;

  let snapshot = snapshotRaw;
  if (auth.role === "worker") {
    const staffId = resolveWorkerStaffIdFromSnapshot(snapshot, [
      auth.profileId,
      auth.authUserId,
      bootstrap.userId,
    ]);
    const workerStaffList = bootstrap.staffList.map((staff) => ({
      id: staff.id,
      role: staff.role,
      status: staff.status,
      team: staff.team,
    }));
    const context = buildWorkerPublishContextFromStaffList(workerStaffList, staffId, departmentNames);
    snapshot = filterShiftSnapshotForWorker(snapshot, context);
  }

  return { bootstrap, snapshot, messages };
}
