import { useEffect, useMemo, useRef, useState } from "react";

type CalendarMonth = { year: number; month: number };

function compareMonth(a: CalendarMonth, b: CalendarMonth) {
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

function buildWeekdayDates(startMonth: CalendarMonth, endMonth: CalendarMonth): string[] {
  const result: string[] = [];
  const cursor = new Date(startMonth.year, startMonth.month, 1);
  const startOffset = (cursor.getDay() + 6) % 7;
  cursor.setDate(cursor.getDate() - startOffset);

  const endCursor = new Date(endMonth.year, endMonth.month + 1, 0);
  const endOffset = (5 - endCursor.getDay() + 7) % 7;
  endCursor.setDate(endCursor.getDate() + endOffset);

  while (cursor <= endCursor) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, "0");
      const d = String(cursor.getDate()).padStart(2, "0");
      result.push(`${y}-${m}-${d}`);
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
}

function getFirstVisibleWeekDateKey(year: number, month: number): string {
  const cursor = new Date(year, month, 1);
  const offsetToMonday = (cursor.getDay() + 6) % 7;
  cursor.setDate(cursor.getDate() - offsetToMonday);
  return `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
}

function shiftMonth(year: number, month: number, delta: number) {
  const next = new Date(year, month + delta, 1);
  return { year: next.getFullYear(), month: next.getMonth() };
}

export function getTodayKey(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

export function useWorkCalendarNavigation() {
  const todayKey = useMemo(() => getTodayKey(), []);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = new Date();
    return { year: today.getFullYear(), month: today.getMonth() };
  });
  const [rangeStartMonth, setRangeStartMonth] = useState(() => {
    const today = new Date();
    return shiftMonth(today.getFullYear(), today.getMonth(), -2);
  });
  const [rangeEndMonth, setRangeEndMonth] = useState(() => {
    const today = new Date();
    return shiftMonth(today.getFullYear(), today.getMonth(), 2);
  });
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [scrollToDateKey, setScrollToDateKey] = useState<string | null>(null);
  const calendarScrollRef = useRef<HTMLDivElement>(null);

  const visibleDates = useMemo(
    () => buildWeekdayDates(rangeStartMonth, rangeEndMonth),
    [rangeStartMonth, rangeEndMonth]
  );

  const weekGroups = useMemo(() => {
    const groups: string[][] = [];
    for (let index = 0; index < visibleDates.length; index += 5) {
      groups.push(visibleDates.slice(index, index + 5));
    }
    return groups;
  }, [visibleDates]);

  const currentWeekIndex = useMemo(
    () => weekGroups.findIndex((group) => group.includes(todayKey)),
    [todayKey, weekGroups]
  );

  const ensureRangeIncludesMonth = (targetMonth: CalendarMonth) => {
    const targetStart = shiftMonth(targetMonth.year, targetMonth.month, -2);
    const targetEnd = shiftMonth(targetMonth.year, targetMonth.month, 2);

    setRangeStartMonth((prev) => (compareMonth(prev, targetStart) > 0 ? targetStart : prev));
    setRangeEndMonth((prev) => (compareMonth(prev, targetEnd) < 0 ? targetEnd : prev));
  };

  const scrollToWeekContaining = (dateKey: string) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = calendarScrollRef.current;
        if (!container) return;

        const weekIndex = weekGroups.findIndex((group) => group.includes(dateKey));
        if (weekIndex < 0) return;

        const weekEl = container.querySelector(`[data-week-index="${weekIndex}"]`) as HTMLElement | null;
        if (!weekEl) return;

        const header = container.querySelector(".calendar-header-sticky") as HTMLElement | null;
        const headerHeight = header?.offsetHeight ?? 0;
        const containerRect = container.getBoundingClientRect();
        const weekRect = weekEl.getBoundingClientRect();
        const nextScrollTop = container.scrollTop + (weekRect.top - containerRect.top) - headerHeight;

        container.scrollTop = Math.max(0, nextScrollTop);
      });
    });
  };

  useEffect(() => {
    if (!scrollToDateKey) return;

    scrollToWeekContaining(scrollToDateKey);

    const retryTimer = window.setTimeout(() => {
      scrollToWeekContaining(scrollToDateKey);
      setScrollToDateKey(null);
    }, 80);

    return () => window.clearTimeout(retryTimer);
  }, [scrollToDateKey, weekGroups]);

  const handleGoToday = (onSelectDate: (dateKey: string) => void) => {
    const today = new Date();
    const nextMonth = { year: today.getFullYear(), month: today.getMonth() };
    setCalendarMonth(nextMonth);
    ensureRangeIncludesMonth(nextMonth);
    onSelectDate(todayKey);
    setMonthPickerOpen(false);
    setScrollToDateKey(todayKey);
  };

  const handleSelectMonth = (month: number) => {
    setCalendarMonth((prev) => {
      const next = { ...prev, month };
      ensureRangeIncludesMonth(next);
      setScrollToDateKey(getFirstVisibleWeekDateKey(next.year, next.month));
      return next;
    });
    setMonthPickerOpen(false);
  };

  const handleChangeYear = (delta: number) => {
    setCalendarMonth((prev) => {
      const next = shiftMonth(prev.year, prev.month, delta * 12);
      ensureRangeIncludesMonth(next);
      setScrollToDateKey(getFirstVisibleWeekDateKey(next.year, next.month));
      return next;
    });
  };

  const handleJumpBackTwoMonths = () => {
    setRangeStartMonth((prev) => shiftMonth(prev.year, prev.month, -2));
    setMonthPickerOpen(false);
  };

  const navigateToDate = (dateKey: string) => {
    const [yearText, monthText] = dateKey.split("-");
    const year = Number(yearText);
    const month = Number(monthText) - 1;
    if (!Number.isFinite(year) || !Number.isFinite(month)) return;
    const nextMonth = { year, month };
    setCalendarMonth(nextMonth);
    ensureRangeIncludesMonth(nextMonth);
    setScrollToDateKey(dateKey);
  };

  return {
    todayKey,
    calendarMonth,
    monthPickerOpen,
    setMonthPickerOpen,
    calendarScrollRef,
    weekGroups,
    currentWeekIndex,
    handleGoToday,
    handleSelectMonth,
    handleChangeYear,
    handleJumpBackTwoMonths,
    navigateToDate,
  };
}
