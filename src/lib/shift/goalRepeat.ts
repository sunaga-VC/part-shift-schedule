import { addDays, addMonthsToDateKey, getDayOfMonthJst, getWeekdayJst } from "./dates";
import type { GoalBlockSlots } from "./goal";
import { getGoalBlocksForDate, normalizeGoalBlocks } from "./goal";
import type { AppState } from "./types";

export type GoalRepeatFrequency = "daily" | "weekdays" | "monthly";
export type GoalMonthlyMode = "single" | "range";

export type GoalRepeatRule = {
  frequency: GoalRepeatFrequency;
  /** JavaScript getDay(): 1=月 … 5=金 */
  weekdays: number[];
  /** 開始日から何か月間繰り返すか */
  repeatMonths: number;
  monthlyMode: GoalMonthlyMode;
  /** 毎月の指定日（1〜31） */
  monthDay: number;
  /** 毎月の期間開始日 */
  monthDayStart: number;
  /** 毎月の期間終了日 */
  monthDayEnd: number;
};

export const WORKDAY_OPTIONS = [
  { value: 1, label: "月" },
  { value: 2, label: "火" },
  { value: 3, label: "水" },
  { value: 4, label: "木" },
  { value: 5, label: "金" },
] as const;

export function isWorkdayKey(dateKey: string): boolean {
  const day = getWeekdayJst(dateKey);
  return day !== 0 && day !== 6;
}

export function getRepeatPeriodEndKey(sourceDate: string, repeatMonths: number): string {
  return addMonthsToDateKey(sourceDate, repeatMonths);
}

export function createDefaultRepeatRule(sourceDate: string): GoalRepeatRule {
  const weekday = getWeekdayJst(sourceDate);
  const dayOfMonth = getDayOfMonthJst(sourceDate);

  return {
    frequency: "weekdays",
    weekdays: weekday >= 1 && weekday <= 5 ? [weekday] : [1],
    repeatMonths: 3,
    monthlyMode: "single",
    monthDay: dayOfMonth,
    monthDayStart: 1,
    monthDayEnd: dayOfMonth,
  };
}

export function matchesRepeatRule(sourceDate: string, dateKey: string, rule: GoalRepeatRule): boolean {
  if (dateKey <= sourceDate) return false;
  if (!isWorkdayKey(dateKey)) return false;

  if (rule.frequency === "daily") return true;

  if (rule.frequency === "weekdays") {
    return rule.weekdays.includes(getWeekdayJst(dateKey));
  }

  const dayOfMonth = getDayOfMonthJst(dateKey);
  if (rule.monthlyMode === "single") {
    return dayOfMonth === rule.monthDay;
  }

  return dayOfMonth >= rule.monthDayStart && dayOfMonth <= rule.monthDayEnd;
}

export function getRepeatTargetDates(sourceDate: string, rule: GoalRepeatRule): string[] {
  const repeatMonths = Number(rule.repeatMonths);
  if (!Number.isFinite(repeatMonths) || repeatMonths < 1) return [];

  const endDateKey = getRepeatPeriodEndKey(sourceDate, repeatMonths);
  if (endDateKey <= sourceDate) return [];

  const result: string[] = [];
  let cursorKey = addDays(sourceDate, 1);

  while (cursorKey <= endDateKey) {
    if (matchesRepeatRule(sourceDate, cursorKey, rule)) {
      result.push(cursorKey);
    }
    cursorKey = addDays(cursorKey, 1);
  }

  return result;
}

export function cloneGoalBlocks(blocks: GoalBlockSlots): GoalBlockSlots {
  const normalized = normalizeGoalBlocks(blocks);
  return normalized.map((slots) => [...slots]) as GoalBlockSlots;
}

export function getEffectiveGoalBlocks(state: Pick<AppState, "goalBlocksByDate">, date: string): GoalBlockSlots {
  return cloneGoalBlocks(getGoalBlocksForDate(state, date));
}

export function clampMonthDay(value: number, fallback = 1): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(31, Math.max(1, Math.round(value)));
}
