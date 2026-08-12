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

/** HH:MM を30分単位に丸める（近い方へ） */
export function snapTimeToHalfHour(time: string): string {
  const total = toMinutes(time);
  const snapped = Math.round(total / 30) * 30;
  const clamped = Math.min(Math.max(snapped, 0), 23 * 60 + 30);
  const hours = Math.floor(clamped / MINUTES_PER_HOUR);
  const minutes = clamped % MINUTES_PER_HOUR;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** 30分刻みの時刻選択肢（start〜end を含む） */
export function buildHalfHourTimeOptions(start = "10:00", end = "18:00"): string[] {
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  const options: string[] = [];
  for (let minutes = startMinutes; minutes <= endMinutes; minutes += 30) {
    const hours = Math.floor(minutes / MINUTES_PER_HOUR);
    const mins = minutes % MINUTES_PER_HOUR;
    options.push(`${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`);
  }
  return options;
}

/** アルバイト希望シフト用。社保ありは 18:30 まで */
export function getWorkerShiftTimeOptions(socialInsurance: boolean): string[] {
  return buildHalfHourTimeOptions("10:00", socialInsurance ? "18:30" : "18:00");
}

export function clampTimeToOptions(time: string, options: string[]): string {
  const snapped = snapTimeToHalfHour(time);
  if (options.includes(snapped)) return snapped;
  if (options.length === 0) return snapped;
  const target = toMinutes(snapped);
  return options.reduce((best, option) => {
    const bestDiff = Math.abs(toMinutes(best) - target);
    const optionDiff = Math.abs(toMinutes(option) - target);
    return optionDiff < bestDiff ? option : best;
  }, options[0]);
}

export const HALF_HOUR_TIME_OPTIONS = buildHalfHourTimeOptions();
