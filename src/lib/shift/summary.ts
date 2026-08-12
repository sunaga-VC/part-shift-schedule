import {
  buildGoalRequiredMinutesByDepartment,
  countGoalIcons,
  getGoalBlocksForDate,
  GOAL_SLOT_MINUTES,
} from "./goal";
import { isAttendanceStatus } from "./status";
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

function getRequiredMinutesForDate(
  date: string,
  requiredShifts: RequiredShiftCount[],
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
      const required = requiredShifts.find((s) => s.date === date);
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

  const required = requiredShifts.find((s) => s.date === date);
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
      const desiredForDay = desiredShifts.filter((s) => s.date === date);
      const confirmedForDay = confirmedShifts.filter((s) => s.date === date && isAttendanceStatus(s.status));
      const { requiredPeople, requiredMinutes } = getRequiredMinutesForDate(
        date,
        requiredShifts,
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
  return staffList
    .filter((s) => s.role === "worker")
    .map((staff) => {
      const desiredMinutes = desiredShifts
        .filter((s) => s.staffId === staff.id)
        .reduce((t, s) => t + s.actualMinutes, 0);
      const confirmedMinutes = confirmedShifts
        .filter((s) => s.staffId === staff.id && isAttendanceStatus(s.status))
        .reduce((t, s) => t + s.actualMinutes, 0);
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
  const activeWeekly = weekly.filter((w) => workers.some((worker) => worker.id === w.staffId));

  const registeredStaffIds = new Set(desiredShifts.map((s) => s.staffId));
  const withWish = workers.filter((w) => registeredStaffIds.has(w.id)).length;
  const withoutWish = workers.length - withWish;

  const desiredMinutes = desiredShifts.reduce((t, s) => t + s.actualMinutes, 0);
  const confirmedMinutes = confirmedShifts
    .filter((s) => isAttendanceStatus(s.status))
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
