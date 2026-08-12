import { createClient } from "@/lib/supabase/client";
import { buildGoalRequiredMinutesByDepartment, createDefaultGoalBlocks, normalizeGoalBlocks } from "@/lib/shift/goal";
import type { AppState, ConfirmedShift, DesiredShift, GoalMemo, RequiredShiftCount, ShiftPeriod } from "@/lib/shift/types";
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
  "period" | "desiredShifts" | "confirmedShifts" | "requiredShifts" | "goalBlocksByDate" | "goalMemos"
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
    start_time: shift.startTime,
    end_time: shift.endTime,
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
    startTime: row.start_time,
    endTime: row.end_time,
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
    start_time: shift.startTime,
    end_time: shift.endTime,
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
    startTime: row.start_time,
    endTime: row.end_time,
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
      ...fallback,
      period: deserializePeriod(periodRow),
      desiredShifts: fallback.desiredShifts.map((shift) => ({ ...shift, periodId })),
      confirmedShifts: fallback.confirmedShifts.map((shift) => ({ ...shift, periodId })),
      requiredShifts: fallback.requiredShifts.map((item) => ({ ...item, periodId })),
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
  const { error: periodError } = await supabase.from("shift_periods").upsert(serializePeriod(snapshot.period), {
    onConflict: "id",
  });
  if (periodError) throw periodError;

  const { data: departmentRows, error: departmentError } = await supabase.from("departments").select("id, name");
  if (departmentError) throw departmentError;
  const departmentIdByName = new Map((departmentRows ?? []).map((department: DepartmentRow) => [department.name, department.id]));

  const goalBlocksRows = serializeGoalBlocks(snapshot.goalBlocksByDate, departmentIdByName);
  const requiredRows = serializeRequiredShifts(snapshot, snapshot.goalBlocksByDate);
  const goalMemoRows = snapshot.goalMemos.map((memo) => serializeGoalMemo(snapshot.period.id, memo));
  const desiredRows = snapshot.desiredShifts.map(serializeDesiredShift);
  const confirmedRows = snapshot.confirmedShifts.map(serializeConfirmedShift);

  const deleteResults = await Promise.all([
    supabase.from("desired_shifts").delete().eq("period_id", snapshot.period.id),
    supabase.from("confirmed_shifts").delete().eq("period_id", snapshot.period.id),
    supabase.from("required_shifts").delete().eq("period_id", snapshot.period.id),
    supabase.from("goal_memos").delete().eq("period_id", snapshot.period.id),
    supabase.from("goal_block_slots").delete(),
  ]);
  const deleteError = deleteResults.find((result) => result.error)?.error;
  if (deleteError) throw deleteError;

  const insertResults = await Promise.all([
    desiredRows.length > 0 ? supabase.from("desired_shifts").insert(desiredRows) : Promise.resolve({ error: null } as const),
    confirmedRows.length > 0 ? supabase.from("confirmed_shifts").insert(confirmedRows) : Promise.resolve({ error: null } as const),
    requiredRows.length > 0 ? supabase.from("required_shifts").insert(requiredRows) : Promise.resolve({ error: null } as const),
    goalBlocksRows.length > 0 ? supabase.from("goal_block_slots").insert(goalBlocksRows) : Promise.resolve({ error: null } as const),
    goalMemoRows.length > 0 ? supabase.from("goal_memos").insert(goalMemoRows) : Promise.resolve({ error: null } as const),
  ]);
  const insertError = insertResults.find((result) => result.error)?.error;
  if (insertError) throw insertError;
}

export async function persistWorkerDesiredShiftsToSupabase(
  supabase: SupabaseClient,
  snapshot: ShiftPersistenceSnapshot,
  staffId: string
): Promise<void> {
  const desiredRows = snapshot.desiredShifts
    .filter((shift) => shift.staffId === staffId)
    .map(serializeDesiredShift);

  const { error: deleteError } = await supabase
    .from("desired_shifts")
    .delete()
    .eq("period_id", snapshot.period.id)
    .eq("staff_id", staffId);
  if (deleteError) throw deleteError;

  if (desiredRows.length === 0) return;
  const { error: insertError } = await supabase.from("desired_shifts").insert(desiredRows);
  if (insertError) throw insertError;
}

