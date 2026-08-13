import { createClient } from "@/lib/supabase/client";
import { buildGoalRequiredMinutesByDepartment, createDefaultGoalBlocks, normalizeGoalBlocks } from "@/lib/shift/goal";
import { getMondayOfWeek, getWeekDates } from "@/lib/shift/dates";
import {
  computeWorkerPublishedDates,
  hasWishChangedAfterPublish,
  isRestConfirmedShift,
} from "@/lib/shift/publish-state";
import { normalizeDisplayTime } from "@/lib/shift/time";
import type {
  AppState,
  ConfirmedShift,
  DesiredShift,
  GoalMemo,
  RequiredShiftCount,
  ShiftPeriod,
  Staff,
} from "@/lib/shift/types";
import type { Database } from "@/lib/supabase/database.types";

type SupabaseClient = ReturnType<typeof createClient>;

type DesiredShiftRow = Database["public"]["Tables"]["desired_shifts"]["Row"];
type DesiredShiftInsert = Database["public"]["Tables"]["desired_shifts"]["Insert"];
type ConfirmedShiftRow = Database["public"]["Tables"]["confirmed_shifts"]["Row"];
type ConfirmedShiftInsert = Database["public"]["Tables"]["confirmed_shifts"]["Insert"];
type RequiredShiftRow = Database["public"]["Tables"]["required_shifts"]["Row"];
type RequiredShiftInsert = Database["public"]["Tables"]["required_shifts"]["Insert"];
type GoalBlockSlotRow = Database["public"]["Tables"]["goal_block_slots"]["Row"];
type GoalBlockSlotInsert = Database["public"]["Tables"]["goal_block_slots"]["Insert"];
type DepartmentRow = Pick<Database["public"]["Tables"]["departments"]["Row"], "id" | "name">;
type PeriodRow = Database["public"]["Tables"]["shift_periods"]["Row"];
type GoalMemoRow = Database["public"]["Tables"]["goal_memos"]["Row"];
type GoalMemoInsert = Database["public"]["Tables"]["goal_memos"]["Insert"];

export type ShiftPersistenceSnapshot = Pick<
  AppState,
  | "period"
  | "desiredShifts"
  | "confirmedShifts"
  | "requiredShifts"
  | "goalBlocksByDate"
  | "goalMemos"
  | "workerPublishedDates"
>;

function serializePeriod(period: ShiftPeriod): PeriodRow {
  return {
    id: period.id,
    adjustment_status: period.adjustmentStatus,
    published_week_start_date: period.publishedWeekStartDate,
    published_at: period.publishedAt,
    created_at: period.createdAt,
    updated_at: period.updatedAt,
  };
}

function deserializePeriod(row: PeriodRow): ShiftPeriod {
  return {
    id: row.id,
    adjustmentStatus: row.adjustment_status,
    publishedWeekStartDate: row.published_week_start_date,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeDesiredShift(shift: DesiredShift): DesiredShiftInsert {
  return {
    staff_id: shift.staffId,
    period_id: shift.periodId,
    work_date: shift.date,
    start_time: normalizeDisplayTime(shift.startTime),
    end_time: normalizeDisplayTime(shift.endTime),
    break_minutes: shift.breakMinutes,
    actual_minutes: shift.actualMinutes,
    note: shift.note,
    created_at: shift.createdAt,
    updated_at: shift.updatedAt,
  };
}

function deserializeDesiredShift(row: DesiredShiftRow): DesiredShift {
  return {
    id: row.id,
    staffId: row.staff_id,
    periodId: row.period_id,
    date: row.work_date,
    startTime: normalizeDisplayTime(row.start_time),
    endTime: normalizeDisplayTime(row.end_time),
    breakMinutes: row.break_minutes,
    actualMinutes: row.actual_minutes,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeConfirmedShift(shift: ConfirmedShift): ConfirmedShiftInsert {
  return {
    staff_id: shift.staffId,
    period_id: shift.periodId,
    work_date: shift.date,
    status: shift.status,
    start_time: normalizeDisplayTime(shift.startTime),
    end_time: normalizeDisplayTime(shift.endTime),
    break_minutes: shift.breakMinutes,
    actual_minutes: shift.actualMinutes,
    note: shift.note,
    admin_note: shift.adminNote,
    published_at: shift.publishedAt,
    created_at: shift.createdAt,
    updated_at: shift.updatedAt,
  };
}

function deserializeConfirmedShift(row: ConfirmedShiftRow): ConfirmedShift {
  return {
    id: row.id,
    staffId: row.staff_id,
    periodId: row.period_id,
    date: row.work_date,
    status: row.status,
    startTime: normalizeDisplayTime(row.start_time),
    endTime: normalizeDisplayTime(row.end_time),
    breakMinutes: row.break_minutes,
    actualMinutes: row.actual_minutes,
    note: row.note,
    adminNote: row.admin_note,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeGoalMemo(periodId: string, memo: GoalMemo): GoalMemoInsert {
  return {
    period_id: periodId,
    body: memo.body,
    start_date: memo.startDate,
    end_date: memo.endDate,
    frequency: memo.frequency,
    weekdays: memo.weekdays,
    repeat_months: memo.repeatMonths,
    monthly_mode: memo.monthlyMode,
    month_day: memo.monthDay,
    month_day_start: memo.monthDayStart,
    month_day_end: memo.monthDayEnd,
  };
}

function deserializeGoalMemo(row: GoalMemoRow): GoalMemo {
  return {
    id: row.id,
    body: row.body,
    startDate: row.start_date,
    endDate: row.end_date,
    frequency: row.frequency,
    weekdays: row.weekdays ?? [],
    repeatMonths: row.repeat_months,
    monthlyMode: row.monthly_mode,
    monthDay: row.month_day,
    monthDayStart: row.month_day_start,
    monthDayEnd: row.month_day_end,
  };
}

function serializeGoalBlocks(
  goalBlocksByDate: AppState["goalBlocksByDate"],
  departmentIdByName: Map<string, string>
): GoalBlockSlotInsert[] {
  const rows: GoalBlockSlotInsert[] = [];
  for (const [date, blocks] of Object.entries(goalBlocksByDate)) {
    const normalized = normalizeGoalBlocks(blocks);
    normalized.forEach((slots, blockIndex) => {
      slots.forEach((department, slotIndex) => {
        const departmentId = departmentIdByName.get(department);
        if (!departmentId) return;
        rows.push({
          work_date: date,
          block_index: blockIndex,
          slot_index: slotIndex,
          department_id: departmentId,
        });
      });
    });
  }
  return rows;
}

function deserializeGoalBlocks(rows: GoalBlockSlotRow[], departmentNameById: Map<string, string>): AppState["goalBlocksByDate"] {
  const grouped: Record<string, [string[], string[], string[], string[]]> = {};
  for (const row of rows.sort((a, b) => {
    if (a.work_date !== b.work_date) return a.work_date.localeCompare(b.work_date);
    if (a.block_index !== b.block_index) return a.block_index - b.block_index;
    return a.slot_index - b.slot_index;
  })) {
    const date = row.work_date;
    if (!grouped[date]) {
      grouped[date] = createDefaultGoalBlocks();
    }
    const department = departmentNameById.get(row.department_id);
    if (!department) continue;
    grouped[date][row.block_index][row.slot_index] = department;
  }
  return grouped;
}

function serializeRequiredShifts(
  snapshot: ShiftPersistenceSnapshot,
  goalBlocksByDate: AppState["goalBlocksByDate"]
): RequiredShiftInsert[] {
  const requiredByDate = new Map(snapshot.requiredShifts.map((item) => [item.date, item]));
  const dates = new Set<string>([
    ...Object.keys(goalBlocksByDate),
    ...snapshot.requiredShifts.map((item) => item.date),
  ]);
  return Array.from(dates)
    .sort()
    .map((date) => {
      const blocks = normalizeGoalBlocks(goalBlocksByDate[date]);
      const existing = requiredByDate.get(date);
      const requiredMinutes = Object.values(buildGoalRequiredMinutesByDepartment(blocks)).reduce(
        (total, minutes) => total + minutes,
        0
      );
      const requiredPeople = existing?.requiredPeople ?? blocks.reduce((total, slots) => total + slots.length, 0);
      return {
        period_id: snapshot.period.id,
        work_date: date,
        required_people: requiredPeople,
        required_minutes: requiredMinutes,
        note: existing?.note ?? "",
      };
    });
}

function deserializeRequiredShifts(
  rows: RequiredShiftRow[],
  goalBlocksByDate: AppState["goalBlocksByDate"]
): RequiredShiftCount[] {
  return rows
    .slice()
    .sort((a, b) => a.work_date.localeCompare(b.work_date))
    .map((row) => ({
      id: row.id,
      periodId: row.period_id,
      date: row.work_date,
      requiredPeople: row.required_people,
      requiredMinutes: row.required_minutes,
      departmentRequiredMinutes: Object.fromEntries(
        Object.entries(buildGoalRequiredMinutesByDepartment(normalizeGoalBlocks(goalBlocksByDate[row.work_date])))
      ),
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
}

export async function loadShiftSnapshotFromSupabase(
  supabase: SupabaseClient,
  fallback: ShiftPersistenceSnapshot
): Promise<ShiftPersistenceSnapshot> {
  const [latestPeriodResult, departmentsResult] = await Promise.all([
    supabase.from("shift_periods").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("departments").select("id, name"),
  ]);

  if (latestPeriodResult.error) throw latestPeriodResult.error;
  if (departmentsResult.error) throw departmentsResult.error;

  let periodRow = latestPeriodResult.data;
  if (!periodRow) {
    const inserted = await supabase
      .from("shift_periods")
      .insert({
        adjustment_status: fallback.period.adjustmentStatus,
        published_week_start_date: fallback.period.publishedWeekStartDate,
        published_at: fallback.period.publishedAt,
        created_at: fallback.period.createdAt,
        updated_at: fallback.period.updatedAt,
      })
      .select("*")
      .single();
    if (inserted.error) throw inserted.error;
    periodRow = inserted.data;
  }

  const periodId = periodRow.id;
  const [desiredResult, confirmedResult, requiredResult, goalBlocksResult, goalMemoResult] =
    await Promise.all([
      supabase.from("desired_shifts").select("*").eq("period_id", periodId).order("work_date", { ascending: true }),
      supabase.from("confirmed_shifts").select("*").eq("period_id", periodId).order("work_date", { ascending: true }),
      supabase.from("required_shifts").select("*").eq("period_id", periodId).order("work_date", { ascending: true }),
      supabase.from("goal_block_slots").select("*").order("work_date", { ascending: true }).order("block_index", { ascending: true }).order("slot_index", { ascending: true }),
      supabase.from("goal_memos").select("*").eq("period_id", periodId).order("start_date", { ascending: true }),
    ]);
  if (desiredResult.error) throw desiredResult.error;
  if (confirmedResult.error) throw confirmedResult.error;
  if (requiredResult.error) throw requiredResult.error;
  if (goalBlocksResult.error) throw goalBlocksResult.error;
  if (goalMemoResult.error) throw goalMemoResult.error;

  const departmentNameById = new Map((departmentsResult.data ?? []).map((department: DepartmentRow) => [department.id, department.name]));

  const desiredShifts = (desiredResult.data ?? []).map(deserializeDesiredShift);
  const confirmedShifts = (confirmedResult.data ?? []).map(deserializeConfirmedShift);
  const goalBlocksByDate = goalBlocksResult.data && goalBlocksResult.data.length > 0
    ? deserializeGoalBlocks(goalBlocksResult.data, departmentNameById)
    : fallback.goalBlocksByDate;
  const requiredShifts = (requiredResult.data ?? []).length > 0
    ? deserializeRequiredShifts(requiredResult.data ?? [], goalBlocksByDate)
    : fallback.requiredShifts.map((item) => ({ ...item, periodId }));
  const goalMemos = (goalMemoResult.data ?? []).length > 0
    ? (goalMemoResult.data ?? []).map(deserializeGoalMemo)
    : fallback.goalMemos;

  const needsFallbackSeed =
    (desiredResult.data?.length ?? 0) === 0 &&
    (confirmedResult.data?.length ?? 0) === 0 &&
    (requiredResult.data?.length ?? 0) === 0 &&
    (goalBlocksResult.data?.length ?? 0) === 0 &&
    (goalMemoResult.data?.length ?? 0) === 0;

  if (needsFallbackSeed) {
    return {
      period: deserializePeriod(periodRow),
      desiredShifts: [],
      confirmedShifts: [],
      requiredShifts: [],
      goalBlocksByDate: {},
      goalMemos: [],
    };
  }

  return {
    period: deserializePeriod(periodRow),
    desiredShifts,
    confirmedShifts,
    requiredShifts,
    goalBlocksByDate,
    goalMemos,
  };
}

export async function persistShiftSnapshotToSupabase(
  supabase: SupabaseClient,
  snapshot: ShiftPersistenceSnapshot
): Promise<void> {
  const { periodId, period } = await resolveCanonicalPeriod(supabase, snapshot);
  const normalizedSnapshot: ShiftPersistenceSnapshot = {
    ...snapshot,
    period: { ...period, id: periodId },
    desiredShifts: snapshot.desiredShifts.map((shift) => ({ ...shift, periodId })),
    confirmedShifts: snapshot.confirmedShifts.map((shift) => ({ ...shift, periodId })),
    requiredShifts: snapshot.requiredShifts.map((shift) => ({ ...shift, periodId })),
  };

  const { error: periodError } = await supabase
    .from("shift_periods")
    .update({
      adjustment_status: normalizedSnapshot.period.adjustmentStatus,
      published_week_start_date: normalizedSnapshot.period.publishedWeekStartDate,
      published_at: normalizedSnapshot.period.publishedAt,
      updated_at: normalizedSnapshot.period.updatedAt,
    })
    .eq("id", periodId);
  if (periodError) throw periodError;

  const { data: departmentRows, error: departmentError } = await supabase.from("departments").select("id, name");
  if (departmentError) throw departmentError;
  const departmentIdByName = new Map((departmentRows ?? []).map((department: DepartmentRow) => [department.name, department.id]));

  const goalBlocksRows = serializeGoalBlocks(normalizedSnapshot.goalBlocksByDate, departmentIdByName);
  const requiredRows = serializeRequiredShifts(normalizedSnapshot, normalizedSnapshot.goalBlocksByDate);
  const goalMemoRows = normalizedSnapshot.goalMemos.map((memo) => serializeGoalMemo(periodId, memo));
  const desiredRows = normalizedSnapshot.desiredShifts.map(serializeDesiredShift);
  const confirmedRows = normalizedSnapshot.confirmedShifts.map(serializeConfirmedShift);
  const goalBlockDates = [
    ...new Set([
      ...Object.keys(normalizedSnapshot.goalBlocksByDate),
      ...normalizedSnapshot.requiredShifts.map((shift) => shift.date),
    ]),
  ];

  const { count: existingConfirmedCount, error: existingConfirmedError } = await supabase
    .from("confirmed_shifts")
    .select("*", { count: "exact", head: true })
    .eq("period_id", periodId);
  if (existingConfirmedError) throw existingConfirmedError;
  if ((existingConfirmedCount ?? 0) > 0 && confirmedRows.length === 0) {
    throw new Error(
      "確定シフトが空の状態では保存できません。画面を再読み込みしてからやり直してください。"
    );
  }

  const deleteResults = await Promise.all([
    supabase.from("desired_shifts").delete().eq("period_id", periodId),
    supabase.from("confirmed_shifts").delete().eq("period_id", periodId),
    supabase.from("required_shifts").delete().eq("period_id", periodId),
    supabase.from("goal_memos").delete().eq("period_id", periodId),
    goalBlockDates.length > 0
      ? supabase.from("goal_block_slots").delete().in("work_date", goalBlockDates)
      : Promise.resolve({ error: null } as const),
  ]);
  const deleteError = deleteResults.find((result) => result.error)?.error;
  if (deleteError) {
    throw new Error(deleteError.message || "既存シフトデータの削除に失敗しました。");
  }

  // unique (staff_id, work_date) は period を跨ぐため、挿入前に衝突行を除去
  await deleteShiftStaffDateRows(supabase, "desired_shifts", desiredRows);
  await deleteShiftStaffDateRows(supabase, "confirmed_shifts", confirmedRows);

  const insertResults = await Promise.all([
    desiredRows.length > 0 ? supabase.from("desired_shifts").insert(desiredRows) : Promise.resolve({ error: null } as const),
    confirmedRows.length > 0 ? supabase.from("confirmed_shifts").insert(confirmedRows) : Promise.resolve({ error: null } as const),
    requiredRows.length > 0 ? supabase.from("required_shifts").insert(requiredRows) : Promise.resolve({ error: null } as const),
    goalBlocksRows.length > 0 ? supabase.from("goal_block_slots").insert(goalBlocksRows) : Promise.resolve({ error: null } as const),
    goalMemoRows.length > 0 ? supabase.from("goal_memos").insert(goalMemoRows) : Promise.resolve({ error: null } as const),
  ]);
  const insertError = insertResults.find((result) => result.error)?.error;
  if (insertError) {
    throw new Error(insertError.message || "シフトデータの保存に失敗しました。");
  }
}

/** DB 上の最新 period に統一（クライアントの固定 ID と二重化しない） */
async function resolveCanonicalPeriod(
  supabase: SupabaseClient,
  snapshot: ShiftPersistenceSnapshot
): Promise<{ periodId: string; period: ShiftPeriod }> {
  const { data: latestRow, error } = await supabase
    .from("shift_periods")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;

  if (latestRow) {
    return {
      periodId: latestRow.id,
      period: {
        ...deserializePeriod(latestRow),
        adjustmentStatus: snapshot.period.adjustmentStatus,
        publishedWeekStartDate: snapshot.period.publishedWeekStartDate,
        publishedAt: snapshot.period.publishedAt,
        updatedAt: snapshot.period.updatedAt,
      },
    };
  }

  const inserted = await supabase
    .from("shift_periods")
    .insert({
      adjustment_status: snapshot.period.adjustmentStatus,
      published_week_start_date: snapshot.period.publishedWeekStartDate,
      published_at: snapshot.period.publishedAt,
      created_at: snapshot.period.createdAt,
      updated_at: snapshot.period.updatedAt,
    })
    .select("*")
    .single();
  if (inserted.error) throw inserted.error;
  return { periodId: inserted.data.id, period: deserializePeriod(inserted.data) };
}

export function createEmptyShiftPersistenceFallback(): ShiftPersistenceSnapshot {
  return {
    period: {
      id: "period-2026-08-10",
      adjustmentStatus: "editing",
      publishedWeekStartDate: null,
      publishedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    desiredShifts: [],
    confirmedShifts: [],
    requiredShifts: [],
    goalBlocksByDate: {},
    goalMemos: [],
  };
}

export function createEmptyAppState(): AppState {
  return {
    staffList: [],
    departments: [],
    homeMessages: [],
    currentUserId: "",
    ...createEmptyShiftPersistenceFallback(),
  };
}

export type WorkerPublishContext = {
  staffId: string;
  workerTeam: string;
  staffList: Pick<Staff, "id" | "role" | "status" | "team">[];
  knownDepartments: ReadonlySet<string>;
};

export async function loadWorkerPublishContext(
  supabase: SupabaseClient,
  staffId: string
): Promise<WorkerPublishContext> {
  const [profilesResult, departmentsResult] = await Promise.all([
    supabase.from("staff_profiles").select("id, role, status, department_id"),
    supabase.from("departments").select("id, name"),
  ]);
  if (profilesResult.error) throw profilesResult.error;
  if (departmentsResult.error) throw departmentsResult.error;

  const departmentNameById = Object.fromEntries(
    (departmentsResult.data ?? []).map((row) => [row.id, row.name])
  );
  const knownDepartments = new Set(Object.values(departmentNameById));
  const staffList: Pick<Staff, "id" | "role" | "status" | "team">[] = (profilesResult.data ?? []).map(
    (row) => ({
      id: row.id,
      role: row.role as Staff["role"],
      status: row.status as Staff["status"],
      team: row.department_id ? (departmentNameById[row.department_id] ?? "") : "",
    })
  );

  const workerTeam = staffList.find((staff) => staff.id === staffId)?.team ?? "";

  return { staffId, workerTeam, staffList, knownDepartments };
}

/** Auth ID と staff_profiles ID がズレている場合に、実データ側の ID を優先 */
export function resolveWorkerStaffIdFromSnapshot(
  snapshot: ShiftPersistenceSnapshot,
  preferredIds: string[]
): string {
  for (const id of preferredIds) {
    if (!id) continue;
    const hasShiftData =
      snapshot.desiredShifts.some((shift) => shift.staffId === id) ||
      snapshot.confirmedShifts.some((shift) => shift.staffId === id);
    if (hasShiftData) return id;
  }
  return preferredIds.find(Boolean) ?? "";
}

/** 所属の確定週（月〜金）に含まれる日付一覧 */
export function buildWorkerPublishedDates(
  snapshot: ShiftPersistenceSnapshot,
  context: WorkerPublishContext
): string[] {
  return computeWorkerPublishedDates(
    snapshot.period,
    context.staffList,
    snapshot.confirmedShifts,
    context.staffId,
    context.workerTeam,
    { knownDepartments: context.knownDepartments }
  );
}

function isWorkerDatePublished(
  snapshot: ShiftPersistenceSnapshot,
  context: WorkerPublishContext,
  date: string
): boolean {
  return computeWorkerPublishedDates(
    snapshot.period,
    context.staffList,
    snapshot.confirmedShifts,
    context.staffId,
    context.workerTeam,
    { knownDepartments: context.knownDepartments }
  ).includes(date);
}

function buildWorkerConfirmedShifts(
  snapshot: ShiftPersistenceSnapshot,
  context: WorkerPublishContext
): ConfirmedShift[] {
  const { staffId } = context;
  const publishStamp = snapshot.period.publishedAt ?? new Date().toISOString();
  const ownDesired = snapshot.desiredShifts.filter((shift) => shift.staffId === staffId);
  const ownConfirmedRaw = snapshot.confirmedShifts.filter((shift) => shift.staffId === staffId);

  return ownConfirmedRaw
    .map((shift) => {
      const publishedForWorker = isWorkerDatePublished(snapshot, context, shift.date);
      let next = shift;
      if (!shift.publishedAt && publishedForWorker) {
        next = { ...shift, publishedAt: shift.updatedAt ?? publishStamp };
      }
      if (
        next.publishedAt &&
        next.status === "adjusting" &&
        !hasWishChangedAfterPublish(next, ownDesired.find((desired) => desired.date === shift.date))
      ) {
        next = {
          ...next,
          status: isRestConfirmedShift(next) ? "unconfirmed" : "confirmed",
        };
      }
      return next;
    })
    .filter((shift) => Boolean(shift.publishedAt))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

/** アルバイト向け: 自分の希望 + 所属で確定公開済みの確定シフト */
export function filterShiftSnapshotForWorker(
  snapshot: ShiftPersistenceSnapshot,
  context: WorkerPublishContext
): ShiftPersistenceSnapshot {
  const workerPublishedDates = buildWorkerPublishedDates(snapshot, context);
  return {
    ...snapshot,
    desiredShifts: snapshot.desiredShifts.filter((shift) => shift.staffId === context.staffId),
    confirmedShifts: buildWorkerConfirmedShifts(snapshot, context),
    workerPublishedDates,
  };
}

async function syncWorkerAdjustingConfirmedShifts(
  supabase: SupabaseClient,
  snapshot: ShiftPersistenceSnapshot,
  staffId: string
): Promise<void> {
  const ownDesired = snapshot.desiredShifts.filter((shift) => shift.staffId === staffId);
  const ownConfirmed = snapshot.confirmedShifts.filter(
    (shift) => shift.staffId === staffId && Boolean(shift.publishedAt)
  );

  for (const confirmed of ownConfirmed) {
    const desired = ownDesired.find((shift) => shift.date === confirmed.date);
    const wishChanged = hasWishChangedAfterPublish(confirmed, desired);

    if (wishChanged) {
      const { error } = await supabase
        .from("confirmed_shifts")
        .update({
          status: "adjusting",
          updated_at: desired?.updatedAt ?? confirmed.updatedAt,
        })
        .eq("staff_id", staffId)
        .eq("work_date", confirmed.date);
      if (error) throw error;
      continue;
    }

    if (confirmed.status === "adjusting" && !wishChanged) {
      const nextStatus =
        !desired || !confirmed.publishedAt || isRestConfirmedShift(confirmed)
          ? "unconfirmed"
          : "confirmed";
      const { error } = await supabase
        .from("confirmed_shifts")
        .update({
          status: nextStatus,
          updated_at: confirmed.publishedAt ?? confirmed.updatedAt,
        })
        .eq("staff_id", staffId)
        .eq("work_date", confirmed.date);
      if (error) throw error;
    }
  }
}

export async function persistWorkerDesiredShiftsToSupabase(
  supabase: SupabaseClient,
  snapshot: ShiftPersistenceSnapshot,
  staffId: string
): Promise<string> {
  const { periodId } = await resolveCanonicalPeriod(supabase, snapshot);
  const ownDesired = snapshot.desiredShifts.filter((shift) => shift.staffId === staffId);
  const desiredDates = new Set(ownDesired.map((shift) => shift.date));

  const { data: existingRows, error: existingError } = await supabase
    .from("desired_shifts")
    .select("work_date")
    .eq("staff_id", staffId);
  if (existingError) throw existingError;

  const deleteDates = (existingRows ?? [])
    .map((row) => row.work_date)
    .filter((date) => !desiredDates.has(date));
  if (deleteDates.length > 0) {
    const { error: deleteRemovedError } = await supabase
      .from("desired_shifts")
      .delete()
      .eq("staff_id", staffId)
      .in("work_date", deleteDates);
    if (deleteRemovedError) throw deleteRemovedError;

    const { error: deleteDraftConfirmedError } = await supabase
      .from("confirmed_shifts")
      .delete()
      .eq("staff_id", staffId)
      .in("work_date", deleteDates)
      .is("published_at", null);
    if (deleteDraftConfirmedError) throw deleteDraftConfirmedError;
  }

  if (ownDesired.length > 0) {
    const desiredRows = ownDesired.map((shift) => ({
      ...serializeDesiredShift({ ...shift, staffId, periodId }),
      staff_id: staffId,
      period_id: periodId,
    }));
    const { error: upsertError } = await supabase
      .from("desired_shifts")
      .upsert(desiredRows, { onConflict: "staff_id,work_date" });
    if (upsertError) throw upsertError;
  }

  await syncWorkerAdjustingConfirmedShifts(supabase, snapshot, staffId);
  return periodId;
}

type ShiftStaffDateRow = { staff_id: string; work_date: string };

async function deleteShiftStaffDateRows(
  supabase: SupabaseClient,
  table: "desired_shifts" | "confirmed_shifts",
  rows: ShiftStaffDateRow[]
): Promise<void> {
  const uniqueKeys = new Map<string, ShiftStaffDateRow>();
  for (const row of rows) {
    uniqueKeys.set(`${row.staff_id}:${row.work_date}`, row);
  }
  if (uniqueKeys.size === 0) return;

  const results = await Promise.all(
    Array.from(uniqueKeys.values()).map((row) =>
      supabase.from(table).delete().eq("staff_id", row.staff_id).eq("work_date", row.work_date)
    )
  );
  const error = results.find((result) => result.error)?.error;
  if (error) throw error;
}

