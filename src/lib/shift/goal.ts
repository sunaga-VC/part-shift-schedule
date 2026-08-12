import type { AppState, ConfirmedShift, DesiredShift, Staff } from "./types";
import { isAttendanceStatus } from "./status";

export const GOAL_BLOCK_TIMES = [
  { label: "10:00", start: "10:00", end: "12:00" },
  { label: "12:00", start: "12:00", end: "14:00" },
  { label: "14:00", start: "14:00", end: "16:00" },
  { label: "16:00", start: "16:00", end: "18:00" },
] as const;

export type GoalBlockSlots = [string[], string[], string[], string[]];

export const DEFAULT_GOAL_DEPARTMENT = "リクルーティング";
export const OFFICE_GOAL_DEPARTMENT = "事務";
export const GOAL_SLOT_MINUTES = 2 * 60;

/** 編集・削除不可の固定所属 */
export const FIXED_DEPARTMENT_NAMES = ["リクルーティング"] as const;

export function isFixedDepartmentName(name: string): boolean {
  return (FIXED_DEPARTMENT_NAMES as readonly string[]).includes(name.trim());
}

export type DepartmentDaySummary = {
  department: string;
  requiredMinutes: number;
  confirmedMinutes: number;
  adjustingMinutes: number;
  displayLabel: "確定" | "調整";
  displayMinutes: number;
};

export function isDefaultGoalDepartment(department: string): boolean {
  return !department || department === DEFAULT_GOAL_DEPARTMENT;
}

export function isOfficeGoalDepartment(department: string): boolean {
  return department === OFFICE_GOAL_DEPARTMENT;
}

export function createDefaultGoalBlocks(): GoalBlockSlots {
  return [[DEFAULT_GOAL_DEPARTMENT], [DEFAULT_GOAL_DEPARTMENT], [DEFAULT_GOAL_DEPARTMENT], [DEFAULT_GOAL_DEPARTMENT]];
}

export function normalizeGoalBlocks(blocks?: unknown): GoalBlockSlots {
  const defaultBlocks = createDefaultGoalBlocks();
  if (!Array.isArray(blocks) || blocks.length !== 4) {
    return defaultBlocks;
  }

  return blocks.map((block, index) => {
    if (Array.isArray(block)) {
      return block.map((entry) => (typeof entry === "string" && entry ? entry : DEFAULT_GOAL_DEPARTMENT));
    }
    if (typeof block === "number") {
      const count = Math.max(0, Math.floor(block));
      return count === 0 ? [] : Array.from({ length: count }, () => DEFAULT_GOAL_DEPARTMENT);
    }
    return defaultBlocks[index];
  }) as GoalBlockSlots;
}

export function getGoalBlocksForDate(state: Pick<AppState, "goalBlocksByDate">, date: string): GoalBlockSlots {
  return normalizeGoalBlocks(state.goalBlocksByDate[date]);
}

export function getGoalDepartmentLabel(department: string): string {
  if (isDefaultGoalDepartment(department)) return "リ";
  return department.slice(0, 1);
}

export function countGoalIcons(blocks: GoalBlockSlots): number {
  return blocks.reduce((total, slots) => total + slots.length, 0);
}

/** departments テーブル（または state.departments）に登録済みのものだけを返す（本部は除外） */
export function getGoalDisplayDepartments(departments: string[]): string[] {
  return departments.filter((department) => Boolean(department?.trim()) && department.trim() !== "本部");
}

export function buildGoalRequiredMinutesByDepartment(blocks: GoalBlockSlots): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const slots of blocks) {
    for (const department of slots) {
      const key = isDefaultGoalDepartment(department) ? DEFAULT_GOAL_DEPARTMENT : department;
      totals[key] = (totals[key] ?? 0) + GOAL_SLOT_MINUTES;
    }
  }
  return totals;
}

export function buildConfirmedMinutesByDepartment(
  date: string,
  staffList: Staff[],
  confirmedShifts: ConfirmedShift[]
): Record<string, number> {
  const staffById = new Map(staffList.map((staff) => [staff.id, staff]));
  const totals: Record<string, number> = {};

  for (const shift of confirmedShifts) {
    if (shift.date !== date || !isAttendanceStatus(shift.status)) continue;
    const staff = staffById.get(shift.staffId);
    if (!staff?.team) continue;
    totals[staff.team] = (totals[staff.team] ?? 0) + shift.actualMinutes;
  }

  return totals;
}

export function buildAdjustingMinutesByDepartment(
  date: string,
  staffList: Staff[],
  desiredShifts: DesiredShift[],
  confirmedShifts: ConfirmedShift[]
): Record<string, number> {
  const totals: Record<string, number> = {};

  for (const staff of staffList) {
    if (staff.role !== "worker" || staff.status !== "active" || !staff.team) continue;
    const desiredShift = desiredShifts.find((shift) => shift.date === date && shift.staffId === staff.id);
    const confirmedShift = confirmedShifts.find((shift) => shift.date === date && shift.staffId === staff.id);
    const currentStatus = confirmedShift?.status ?? (desiredShift ? "adjusting" : "unconfirmed");
    if (currentStatus === "unconfirmed") continue;

    const shift = confirmedShift ?? desiredShift;
    if (!shift) continue;

    totals[staff.team] = (totals[staff.team] ?? 0) + shift.actualMinutes;
  }

  return totals;
}

function isDepartmentDayPublished(
  date: string,
  department: string,
  staffList: Staff[],
  desiredShifts: DesiredShift[],
  confirmedShifts: ConfirmedShift[]
): boolean {
  const workers = staffList.filter(
    (staff) => staff.role === "worker" && staff.status === "active" && staff.team === department
  );
  let hasPublishedConfirmed = false;

  for (const staff of workers) {
    const desiredShift = desiredShifts.find((shift) => shift.date === date && shift.staffId === staff.id);
    const confirmedShift = confirmedShifts.find((shift) => shift.date === date && shift.staffId === staff.id);
    const currentStatus = confirmedShift?.status ?? (desiredShift ? "adjusting" : "unconfirmed");
    if (currentStatus === "adjusting") return false;
    if (confirmedShift?.publishedAt && isAttendanceStatus(confirmedShift.status)) {
      hasPublishedConfirmed = true;
    }
  }

  return hasPublishedConfirmed;
}

export function buildDepartmentDaySummaries(input: {
  date: string;
  departments: string[];
  goalBlocks: GoalBlockSlots;
  staffList: Staff[];
  desiredShifts: DesiredShift[];
  confirmedShifts: ConfirmedShift[];
  requiredByDepartment?: Record<string, number>;
}): DepartmentDaySummary[] {
  const requiredByDepartment =
    input.requiredByDepartment ?? buildGoalRequiredMinutesByDepartment(input.goalBlocks);
  const confirmedByDepartment = buildConfirmedMinutesByDepartment(
    input.date,
    input.staffList,
    input.confirmedShifts
  );
  const adjustingByDepartment = buildAdjustingMinutesByDepartment(
    input.date,
    input.staffList,
    input.desiredShifts,
    input.confirmedShifts
  );

  return getGoalDisplayDepartments(input.departments).map((department) => {
    const requiredMinutes = requiredByDepartment[department] ?? 0;
    const confirmedMinutes = confirmedByDepartment[department] ?? 0;
    const adjustingMinutes = adjustingByDepartment[department] ?? 0;
    const isPublished = isDepartmentDayPublished(
      input.date,
      department,
      input.staffList,
      input.desiredShifts,
      input.confirmedShifts
    );

    return {
      department,
      requiredMinutes,
      confirmedMinutes,
      adjustingMinutes,
      displayLabel: isPublished ? "確定" : "調整",
      displayMinutes: isPublished ? confirmedMinutes : adjustingMinutes,
    };
  });
}

export function getDepartmentRequiredMinutes(goalBlocks: GoalBlockSlots): Record<string, number> {
  return buildGoalRequiredMinutesByDepartment(goalBlocks);
}

export function goalBlocksFromDepartmentHours(
  departmentHours: Record<string, number>,
  departments: string[]
): GoalBlockSlots {
  const blocks: GoalBlockSlots = [[], [], [], []];
  let cursor = 0;

  for (const department of getGoalDisplayDepartments(departments)) {
    const hours = departmentHours[department] ?? 0;
    if (hours <= 0) continue;
    const iconCount = Math.max(0, Math.round((hours * 60) / GOAL_SLOT_MINUTES));
    for (let index = 0; index < iconCount; index += 1) {
      blocks[cursor % 4].push(department);
      cursor += 1;
    }
  }

  if (blocks.every((slots) => slots.length === 0)) {
    return createDefaultGoalBlocks();
  }

  return blocks;
}

export function departmentMinutesToHoursInput(minutes: number): string {
  if (!minutes) return "";
  return String(minutes / 60).replace(/\.0$/, "");
}
