import { addDays, getDayOfMonthJst, getWeekdayJst } from "./dates";
import {
  WORKDAY_OPTIONS,
  createDefaultRepeatRule,
  getRepeatPeriodEndKey,
  isWorkdayKey,
  type GoalRepeatRule,
} from "./goalRepeat";
import type { GoalMemo } from "./types";

type MemoRuleSource = Pick<
  GoalMemo,
  | "startDate"
  | "endDate"
  | "frequency"
  | "weekdays"
  | "repeatMonths"
  | "monthlyMode"
  | "monthDay"
  | "monthDayStart"
  | "monthDayEnd"
>;

/** 旧データ（frequency なし）も含めて繰り返しルールへ正規化 */
export function getMemoRepeatRule(memo: MemoRuleSource): GoalRepeatRule {
  const fallback = createDefaultRepeatRule(memo.startDate || "2000-01-01");
  const weekdays = [...new Set((memo.weekdays ?? []).filter((day) => day >= 1 && day <= 5))].sort();

  if (memo.frequency === "daily" || memo.frequency === "weekdays" || memo.frequency === "monthly") {
    return {
      frequency: memo.frequency,
      weekdays: weekdays.length > 0 ? weekdays : fallback.weekdays,
      repeatMonths: Math.max(1, Number(memo.repeatMonths) || fallback.repeatMonths),
      monthlyMode: memo.monthlyMode === "range" ? "range" : "single",
      monthDay: memo.monthDay ?? fallback.monthDay,
      monthDayStart: memo.monthDayStart ?? fallback.monthDayStart,
      monthDayEnd: memo.monthDayEnd ?? fallback.monthDayEnd,
    };
  }

  // 旧形式: weekdays 空 = 平日すべて、指定あり = 曜日指定
  return {
    frequency: weekdays.length === 0 ? "daily" : "weekdays",
    weekdays: weekdays.length > 0 ? weekdays : [1, 2, 3, 4, 5],
    repeatMonths: fallback.repeatMonths,
    monthlyMode: "single",
    monthDay: fallback.monthDay,
    monthDayStart: 1,
    monthDayEnd: fallback.monthDay,
  };
}

export function dateMatchesMemoRule(date: string, startDate: string, rule: GoalRepeatRule, endDate: string): boolean {
  if (!startDate || !endDate) return false;
  if (date < startDate || date > endDate) return false;
  if (!isWorkdayKey(date)) return false;

  if (rule.frequency === "daily") return true;

  if (rule.frequency === "weekdays") {
    return rule.weekdays.includes(getWeekdayJst(date));
  }

  const dayOfMonth = getDayOfMonthJst(date);
  if (rule.monthlyMode === "single") {
    return dayOfMonth === rule.monthDay;
  }
  return dayOfMonth >= rule.monthDayStart && dayOfMonth <= rule.monthDayEnd;
}

/** 開始日〜期間内で備考が表示される日付一覧（開始日を含む） */
export function getMemoDisplayDates(startDate: string, rule: GoalRepeatRule): string[] {
  const repeatMonths = Number(rule.repeatMonths);
  if (!startDate || !Number.isFinite(repeatMonths) || repeatMonths < 1) return [];

  const endDateKey = getRepeatPeriodEndKey(startDate, repeatMonths);
  if (endDateKey < startDate) return [];

  const result: string[] = [];
  let cursorKey = startDate;
  while (cursorKey <= endDateKey) {
    if (dateMatchesMemoRule(cursorKey, startDate, rule, endDateKey)) {
      result.push(cursorKey);
    }
    cursorKey = addDays(cursorKey, 1);
  }
  return result;
}

/** 指定日に表示する備考 */
export function getGoalMemosForDate(memos: GoalMemo[] | undefined, date: string): GoalMemo[] {
  if (!memos?.length) return [];
  return memos.filter((memo) => {
    if (!memo.body.trim()) return false;
    const rule = getMemoRepeatRule(memo);
    return dateMatchesMemoRule(date, memo.startDate, rule, memo.endDate);
  });
}

export function formatMemoRepeatLabel(memo: MemoRuleSource): string {
  const rule = getMemoRepeatRule(memo);
  const period = `${rule.repeatMonths}か月`;

  if (rule.frequency === "daily") {
    return `毎日（平日）・${period}`;
  }
  if (rule.frequency === "weekdays") {
    const labels = WORKDAY_OPTIONS.filter((option) => rule.weekdays.includes(option.value)).map((option) => option.label);
    return `${labels.join("・") || "曜日指定"}・${period}`;
  }
  if (rule.monthlyMode === "range") {
    return `毎月${rule.monthDayStart}〜${rule.monthDayEnd}日・${period}`;
  }
  return `毎月${rule.monthDay}日・${period}`;
}

export function buildGoalMemoFromDraft(input: {
  id?: string;
  body: string;
  startDate: string;
  rule: GoalRepeatRule;
}): Omit<GoalMemo, "id"> & { id?: string } {
  const startDate = input.startDate;
  const rule = input.rule;
  const endDate = getRepeatPeriodEndKey(startDate, rule.repeatMonths);
  return {
    id: input.id,
    body: input.body,
    startDate,
    endDate,
    frequency: rule.frequency,
    weekdays: rule.frequency === "weekdays" ? [...rule.weekdays].sort() : [],
    repeatMonths: rule.repeatMonths,
    monthlyMode: rule.monthlyMode,
    monthDay: rule.monthDay,
    monthDayStart: rule.monthDayStart,
    monthDayEnd: rule.monthDayEnd,
  };
}
