import type { ConfirmedShift } from "@/lib/shift/types";

export type ConfirmedShiftStatus = ConfirmedShift["status"];

/** 出社・在宅など、勤務として扱うステータス */
export function isAttendanceStatus(status: ConfirmedShiftStatus | string): boolean {
  return status === "confirmed" || status === "remote";
}

/** アルバイトに公開済みの確定シフトか */
export function isPublishedConfirmedShift(shift: ConfirmedShift | null | undefined): boolean {
  if (!shift?.publishedAt) return false;
  return isAttendanceStatus(shift.status);
}

export function getShiftStatusLabel(status: ConfirmedShiftStatus | string): string {
  if (status === "confirmed") return "出社";
  if (status === "remote") return "在宅";
  if (status === "adjusting") return "調整";
  if (status === "unconfirmed") return "休み";
  return String(status);
}

/** カレンダーアイコンのリング色（globals.css の --status-* と揃える） */
export function getShiftStatusRingColor(status: ConfirmedShiftStatus | string): string {
  if (status === "confirmed" || status === "remote") return "#34c759";
  if (status === "adjusting") return "#ff9500";
  if (status === "unconfirmed") return "#aeaeb2";
  return "#aeaeb2";
}
