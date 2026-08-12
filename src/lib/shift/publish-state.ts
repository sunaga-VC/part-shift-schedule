import { getWeekDates } from "@/lib/shift/dates";
import { isAttendanceStatus } from "@/lib/shift/status";
import type { ConfirmedShift, DesiredShift, ShiftPeriod } from "@/lib/shift/types";

export function isPublishedWeekDate(period: ShiftPeriod, date: string): boolean {
  if (!period.publishedWeekStartDate) return false;
  return getWeekDates(period.publishedWeekStartDate).includes(date);
}

export function getStaffShiftStatus(
  confirmed: ConfirmedShift | undefined,
  desired: DesiredShift | undefined
): ConfirmedShift["status"] {
  return confirmed?.status ?? (desired ? "adjusting" : "unconfirmed");
}

/** 公開済み週で、再確定が必要な状態か */
export function hasStaffPendingAdjustment(
  period: ShiftPeriod,
  confirmed: ConfirmedShift | undefined,
  desired: DesiredShift | undefined,
  date: string
): boolean {
  if (!isPublishedWeekDate(period, date)) return false;

  const status = getStaffShiftStatus(confirmed, desired);
  if (status === "adjusting") return true;

  if (period.publishedAt) {
    if (confirmed && !confirmed.publishedAt) return true;
    if (!confirmed && desired) return true;
  }

  if (confirmed?.publishedAt) {
    if (confirmed.updatedAt > confirmed.publishedAt) return true;
  }

  return false;
}

export { isAttendanceStatus };
