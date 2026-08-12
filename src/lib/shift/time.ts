const MINUTES_PER_HOUR = 60;

export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map((part) => Number(part));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * MINUTES_PER_HOUR + minutes;
}

export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "0h";
  const hours = minutes / MINUTES_PER_HOUR;
  return `${hours.toFixed(1).replace(/\.0$/, "")}h`;
}

/** 確定時間に、必要時間との差分を括弧付きで付ける。例: 8h(+2h), 8h(-3h) */
export function formatConfirmedWithDiff(requiredMinutes: number, confirmedMinutes: number): string {
  const base = formatMinutes(confirmedMinutes);
  const diff = confirmedMinutes - requiredMinutes;
  if (diff > 0) {
    return `${base}(+${formatMinutes(diff)})`;
  }
  if (diff < 0) {
    return `${base}(-${formatMinutes(Math.abs(diff))})`;
  }
  return base;
}

export function formatHoursDecimal(minutes: number): string {
  return (minutes / MINUTES_PER_HOUR).toFixed(1).replace(/\.0$/, "");
}

/** 実働時間 ＝ 終了 − 開始 − 休憩 */
export function calcActualMinutes(startTime: string, endTime: string, breakMinutes: number): number {
  return Math.max(0, toMinutes(endTime) - toMinutes(startTime) - breakMinutes);
}

/**
 * 休憩は入力不要。拘束時間が6時間を超える場合のみ自動で1時間を入れる。
 */
export function calcBreakMinutes(startTime: string, endTime: string): number {
  const workMinutes = toMinutes(endTime) - toMinutes(startTime);
  if (workMinutes > 6 * MINUTES_PER_HOUR) return 60;
  return 0;
}

export function formatTimeRange(startTime: string, endTime: string): string {
  return `${startTime}～${endTime}`;
}

export function formatShiftSummary(startTime: string, endTime: string, breakMinutes: number): string {
  const actualMinutes = Math.max(0, toMinutes(endTime) - toMinutes(startTime) - breakMinutes);
  return `${formatMinutes(actualMinutes)}（休憩${formatMinutes(breakMinutes)}）`;
}

export function isValidTimeRange(startTime: string, endTime: string): boolean {
  return toMinutes(endTime) > toMinutes(startTime);
}
