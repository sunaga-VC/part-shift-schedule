import type { ConfirmedShift } from "@/lib/shift/types";

export type ConfirmedShiftStatus = ConfirmedShift["status"];

/** 出社・在宅など、勤務として扱うステータス */
export function isAttendanceStatus(status: ConfirmedShiftStatus | string): boolean {
  return status === "confirmed" || status === "remote";
}

export function getShiftStatusLabel(status: ConfirmedShiftStatus | string): string {
  if (status === "confirmed") return "出社";
  if (status === "remote") return "在宅";
  if (status === "adjusting") return "調整";
  if (status === "unconfirmed") return "休み";
  return String(status);
}
