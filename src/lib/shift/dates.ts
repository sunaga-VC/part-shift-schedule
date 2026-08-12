const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

export function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00+09:00`);
}

export function toDateKeyJst(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(date);
}

export function toDateKey(date: Date): string {
  return toDateKeyJst(date);
}

export function addDays(dateKey: string, days: number): string {
  const cursor = parseDate(dateKey);
  cursor.setDate(cursor.getDate() + days);
  return toDateKeyJst(cursor);
}

export function addMonthsToDateKey(dateKey: string, months: number): string {
  const cursor = parseDate(dateKey);
  cursor.setMonth(cursor.getMonth() + months);
  return toDateKeyJst(cursor);
}

export function getWeekdayJst(dateKey: string): number {
  const label = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", weekday: "short" }).format(parseDate(dateKey));
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[label] ?? 0;
}

export function getDayOfMonthJst(dateKey: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", day: "numeric" }).format(parseDate(dateKey)));
}

export function formatDateLong(date: string): string {
  const d = parseDate(date);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
}

export function formatDateShort(date: string): string {
  const d = parseDate(date);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function getMonthMatrix(year: number, monthIndex: number): (string | null)[][] {
  const first = new Date(year, monthIndex, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: (string | null)[] = [];

  for (let i = 0; i < startPad; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(toDateKey(new Date(year, monthIndex, day)));
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

export function getWorkdayMatrix(year: number, monthIndex: number): (string | null)[][] {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: (string | null)[] = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, monthIndex, day);
    const weekday = date.getDay();
    if (weekday === 0 || weekday === 6) continue;
    cells.push(toDateKey(date));
  }

  while (cells.length % 5 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 5) {
    weeks.push(cells.slice(i, i + 5));
  }
  return weeks;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** 月曜始まりの平日5日分 */
export function getWeekDates(startDate: string): string[] {
  const result: string[] = [];
  const cursor = parseDate(startDate);
  while (result.length < 5) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      result.push(toDateKey(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

/** 指定日が属する週の月曜日（JST） */
export function getMondayOfWeek(dateKey: string): string {
  const weekday = getWeekdayJst(dateKey);
  const offset = weekday === 0 ? -6 : 1 - weekday;
  return addDays(dateKey, offset);
}

/** 指定日が属する週の平日（月〜金） */
export function getWorkWeekDates(dateKey: string): string[] {
  return getWeekDates(getMondayOfWeek(dateKey));
}

/** 日付範囲の短い表示（例: 8/10〜8/14） */
export function formatDateRangeShort(dates: string[]): string {
  if (dates.length === 0) return "";
  const first = dates[0];
  const last = dates[dates.length - 1];
  return first === last ? formatDateShort(first) : `${formatDateShort(first)}〜${formatDateShort(last)}`;
}

/** 平日週（月〜金）の表示。同月なら 8/10～14、跨月なら 8/31～9/4 */
export function formatWorkWeekLabel(mondayKey: string): string {
  const dates = getWorkWeekDates(mondayKey);
  if (dates.length === 0) return "";
  const first = dates[0];
  const last = dates[dates.length - 1];
  const start = parseDate(first);
  const end = parseDate(last);
  const startLabel = `${start.getMonth() + 1}/${start.getDate()}`;
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${startLabel}～${end.getDate()}`;
  }
  return `${startLabel}～${end.getMonth() + 1}/${end.getDate()}`;
}

/** 今日基準の平日週（月曜キー）一覧 */
export function listWorkWeekMondays(options?: {
  pastWeeks?: number;
  futureWeeks?: number;
  todayKey?: string;
}): string[] {
  const past = options?.pastWeeks ?? 2;
  const future = options?.futureWeeks ?? 8;
  const todayKey = options?.todayKey ?? toDateKeyJst(new Date());
  const thisMonday = getMondayOfWeek(todayKey);
  const mondays: string[] = [];
  for (let i = -past; i <= future; i += 1) {
    mondays.push(addDays(thisMonday, i * 7));
  }
  return mondays;
}

/** 複数の月曜キーから平日（月〜金）の日付をまとめる */
export function getWorkWeekDateKeysFromMondays(mondayKeys: string[]): string[] {
  const keys = new Set<string>();
  for (const monday of mondayKeys) {
    for (const date of getWorkWeekDates(monday)) keys.add(date);
  }
  return Array.from(keys).sort();
}

/** 来週・再来週の月曜キー（来週から2週間） */
export function getNextTwoWorkWeekMondays(todayKey = toDateKeyJst(new Date())): string[] {
  const nextMonday = addDays(getMondayOfWeek(todayKey), 7);
  return [nextMonday, addDays(nextMonday, 7)];
}

/** 指定日が属する月の初日・末日（JST） */
export function getMonthRange(dateKey: string): { start: string; end: string } {
  const d = parseDate(dateKey);
  const start = toDateKeyJst(new Date(d.getFullYear(), d.getMonth(), 1));
  const end = toDateKeyJst(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  return { start, end };
}

export function formatDateRangeLabel(start: string, end: string): string {
  return start === end ? formatDateShort(start) : `${formatDateShort(start)}〜${formatDateShort(end)}`;
}

/** start〜end の日付キー一覧（両端含む） */
export function enumerateDateKeys(start: string, end: string): string[] {
  if (!start || !end) return [];
  const from = start <= end ? start : end;
  const to = start <= end ? end : start;
  const keys: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    keys.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return keys;
}

/** 来週月曜〜その翌週金曜（来週からの2週間） */
export function getNextTwoWeeksRange(todayKey = toDateKeyJst(new Date())): { start: string; end: string } {
  const nextMonday = addDays(getMondayOfWeek(todayKey), 7);
  const endFriday = addDays(nextMonday, 11);
  return { start: nextMonday, end: endFriday };
}

/** 期間内の週数（契約時間超過判定用。最低1週） */
export function countWeeksInRange(start: string, end: string): number {
  const startMs = parseDate(start).getTime();
  const endMs = parseDate(end).getTime();
  if (endMs < startMs) return 1;
  const days = Math.floor((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;
  return Math.max(1, Math.ceil(days / 7));
}
