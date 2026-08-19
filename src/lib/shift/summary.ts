import {
  buildGoalRequiredMinutesByDepartment,
  countGoalIcons,
  getGoalBlocksForDate,
  GOAL_SLOT_MINUTES,
} from "./goal";
import type {
  AppState,
  ConfirmedShift,
  DesiredShift,
  RequiredShiftCount,
  ShiftDaySummary,
  Staff,
  StaffWeeklySummary,
} from "./types";

export function getActiveWorkers(staffList: Staff[]): Staff[] {
  return staffList.filter((s) => s.role === "worker" && s.status === "active");
}

function buildShiftMapByDate<T extends { date: string }>(shifts: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const shift of shifts) {
    const list = map.get(shift.date);
    if (list) {
      list.push(shift);
    } else {
      map.set(shift.date, [shift]);
    }
  }
  return map;
}

function buildRequiredShiftMap(requiredShifts: RequiredShiftCount[]): Map<string, RequiredShiftCount> {
  return new Map(requiredShifts.map((shift) => [shift.date, shift]));
}

function getRequiredMinutesForDate(
  date: string,
  requiredByDate: Map<string, RequiredShiftCount>,
  goalBlocksByDate?: AppState["goalBlocksByDate"],
  departmentFilter?: string
): { requiredPeople: number; requiredMinutes: number } {
  if (goalBlocksByDate) {
    const blocks = getGoalBlocksForDate({ goalBlocksByDate }, date);
    if (departmentFilter) {
      const byDept = buildGoalRequiredMinutesByDepartment(blocks);
      const requiredMinutes = byDept[departmentFilter] ?? 0;
      if (requiredMinutes > 0) {
        return { requiredPeople: 0, requiredMinutes };
      }
    } else {
      const iconCount = countGoalIcons(blocks);
      const required = requiredByDate.get(date);
      if (iconCount > 0) {
        return {
          requiredPeople: required?.requiredPeople ?? 0,
          requiredMinutes: iconCount * GOAL_SLOT_MINUTES,
        };
      }
    }
  }

  if (departmentFilter) {
    return { requiredPeople: 0, requiredMinutes: 0 };
  }

  const required = requiredByDate.get(date);
  return {
    requiredPeople: required?.requiredPeople ?? 0,
    requiredMinutes: required?.requiredMinutes ?? 0,
  };
}

export function buildDaySummaries(
  desiredShifts: DesiredShift[],
  confirmedShifts: ConfirmedShift[],
  requiredShifts: RequiredShiftCount[],
  goalBlocksByDate?: AppState["goalBlocksByDate"],
  departmentFilter?: string
): ShiftDaySummary[] {
  const desiredByDate = buildShiftMapByDate(desiredShifts);
  const confirmedByDate = buildShiftMapByDate(confirmedShifts);
  const requiredByDate = buildRequiredShiftMap(requiredShifts);
  const dates = new Set<string>();
  for (const shift of desiredShifts) dates.add(shift.date);
  for (const shift of confirmedShifts) dates.add(shift.date);
  for (const required of requiredShifts) dates.add(required.date);
  if (goalBlocksByDate) {
    for (const [date, blocks] of Object.entries(goalBlocksByDate)) {
      if (departmentFilter) {
        const minutes = buildGoalRequiredMinutesByDepartment(blocks)[departmentFilter] ?? 0;
        if (minutes > 0) dates.add(date);
      } else if (countGoalIcons(blocks) > 0) {
        dates.add(date);
      }
    }
  }

  return Array.from(dates)
    .sort()
    .map((date) => {
      const desiredForDay = desiredByDate.get(date) ?? [];
      const confirmedForDay = (confirmedByDate.get(date) ?? []).filter((s) => Boolean(s.publishedAt));
      const { requiredPeople, requiredMinutes } = getRequiredMinutesForDate(
        date,
        requiredByDate,
        goalBlocksByDate,
        departmentFilter
      );
      const desiredMinutes = desiredForDay.reduce((t, s) => t + s.actualMinutes, 0);
      const confirmedMinutes = confirmedForDay.reduce((t, s) => t + s.actualMinutes, 0);

      return {
        date,
        desiredCount: desiredForDay.length,
        desiredMinutes,
        confirmedCount: confirmedForDay.length,
        confirmedMinutes,
        requiredPeople,
        requiredMinutes,
        peopleShortage: Math.max(0, requiredPeople - confirmedForDay.length),
        minutesShortage: Math.max(0, requiredMinutes - confirmedMinutes),
        isAdjusted: confirmedForDay.length > 0,
      };
    });
}

export function buildWeeklyStaffSummary(
  staffList: Staff[],
  desiredShifts: DesiredShift[],
  confirmedShifts: ConfirmedShift[],
  options?: { contractWeeks?: number }
): StaffWeeklySummary[] {
  const contractWeeks = Math.max(1, options?.contractWeeks ?? 1);
  const desiredMinutesByStaff = new Map<string, number>();
  for (const shift of desiredShifts) {
    desiredMinutesByStaff.set(shift.staffId, (desiredMinutesByStaff.get(shift.staffId) ?? 0) + shift.actualMinutes);
  }

  const confirmedMinutesByStaff = new Map<string, number>();
  for (const shift of confirmedShifts) {
    if (!shift.publishedAt) continue;
    confirmedMinutesByStaff.set(shift.staffId, (confirmedMinutesByStaff.get(shift.staffId) ?? 0) + shift.actualMinutes);
  }

  return staffList
    .filter((s) => s.role === "worker")
    .map((staff) => {
      const desiredMinutes = desiredMinutesByStaff.get(staff.id) ?? 0;
      const confirmedMinutes = confirmedMinutesByStaff.get(staff.id) ?? 0;
      const contractMinutes = staff.weeklyContractHours * 60 * contractWeeks;

      return {
        staffId: staff.id,
        desiredMinutes,
        confirmedMinutes,
        hasDesiredShift: desiredMinutes > 0,
        overContract:
          !staff.socialInsurance && Math.max(desiredMinutes, confirmedMinutes) > contractMinutes,
      };
    });
}

export function buildDashboardStats(
  staffList: Staff[],
  desiredShifts: DesiredShift[],
  confirmedShifts: ConfirmedShift[],
  requiredShifts: RequiredShiftCount[],
  goalBlocksByDate?: AppState["goalBlocksByDate"],
  departmentFilter?: string
) {
  const workers = getActiveWorkers(staffList);
  const daySummaries = buildDaySummaries(
    desiredShifts,
    confirmedShifts,
    requiredShifts,
    goalBlocksByDate,
    departmentFilter
  );
  const weekly = buildWeeklyStaffSummary(staffList, desiredShifts, confirmedShifts);
  const activeWorkerIds = new Set(workers.map((worker) => worker.id));
  const activeWeekly = weekly.filter((w) => activeWorkerIds.has(w.staffId));

  const registeredStaffIds = new Set(desiredShifts.map((s) => s.staffId));
  const withWish = workers.filter((w) => registeredStaffIds.has(w.id)).length;
  const withoutWish = workers.length - withWish;

  const desiredMinutes = desiredShifts.reduce((t, s) => t + s.actualMinutes, 0);
  const confirmedMinutes = confirmedShifts
    .filter((s) => Boolean(s.publishedAt))
    .reduce((t, s) => t + s.actualMinutes, 0);
  const requiredMinutes = daySummaries.reduce((t, d) => t + d.requiredMinutes, 0);

  return {
    targetStaffCount: workers.length,
    withWishCount: withWish,
    withoutWishCount: withoutWish,
    desiredMinutes,
    confirmedMinutes,
    requiredMinutes,
    shortageMinutes: Math.max(0, requiredMinutes - confirmedMinutes),
    peopleShortageDays: daySummaries.filter((d) => d.peopleShortage > 0).length,
    minutesShortageDays: daySummaries.filter((d) => d.minutesShortage > 0).length,
    unadjustedDays: daySummaries.filter((d) => !d.isAdjusted).length,
    overContractCount: activeWeekly.filter((w) => w.overContract).length,
    daySummaries,
    weekly,
  };
}
