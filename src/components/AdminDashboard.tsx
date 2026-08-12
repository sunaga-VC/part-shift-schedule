"use client";

import { useMemo, useState } from "react";
import { useShift } from "@/context/ShiftContext";
import {
  addDays,
  addMonthsToDateKey,
  formatDateRangeLabel,
  formatDateShort,
  getMondayOfWeek,
  getMonthRange,
  getWorkWeekDates,
  toDateKeyJst,
} from "@/lib/shift/dates";
import { DEFAULT_GOAL_DEPARTMENT } from "@/lib/shift/goal";
import { formatContractHoursLabel } from "@/lib/shift/staffEmployment";
import { buildDashboardStats, buildWeeklyStaffSummary } from "@/lib/shift/summary";
import { formatConfirmedWithDiff, formatMinutes } from "@/lib/shift/time";

type StaffFilterKey = "all" | "withWish" | "withoutWish" | "overContract";
type DayFilterKey = "all" | "minutesShortage" | "adjusted" | "unadjusted";
type PeriodKey = "thisWeek" | "nextWeek" | "thisMonth" | "nextMonth" | "all" | "custom";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

function formatDayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00+09:00`);
  return `${formatDateShort(date)}（${WEEKDAYS[d.getDay()]}）`;
}

function matchesStaffName(staff: { name: string; firstName: string }, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  return staff.name.includes(q) || staff.firstName.includes(q) || `${staff.name}${staff.firstName}`.includes(q);
}

function resolveStaffPeriod(
  period: PeriodKey,
  customFrom: string,
  customTo: string
): { start: string | null; end: string | null; label: string } {
  const today = toDateKeyJst(new Date());

  if (period === "all") {
    return { start: null, end: null, label: "全期間" };
  }

  if (period === "thisWeek") {
    const dates = getWorkWeekDates(today);
    const start = dates[0];
    const end = dates[dates.length - 1];
    return { start, end, label: `今週（${formatDateRangeLabel(start, end)}）` };
  }

  if (period === "nextWeek") {
    const monday = addDays(getMondayOfWeek(today), 7);
    const dates = getWorkWeekDates(monday);
    const start = dates[0];
    const end = dates[dates.length - 1];
    return { start, end, label: `来週（${formatDateRangeLabel(start, end)}）` };
  }

  if (period === "thisMonth") {
    const { start, end } = getMonthRange(today);
    return {
      start,
      end,
      label: `今月（${formatDateRangeLabel(start, end)}）`,
    };
  }

  if (period === "nextMonth") {
    const { start, end } = getMonthRange(addMonthsToDateKey(today, 1));
    return {
      start,
      end,
      label: `来月（${formatDateRangeLabel(start, end)}）`,
    };
  }

  const start = customFrom || today;
  const end = customTo || customFrom || today;
  const normalizedStart = start <= end ? start : end;
  const normalizedEnd = start <= end ? end : start;
  return {
    start: normalizedStart,
    end: normalizedEnd,
    label: `指定期間（${formatDateRangeLabel(normalizedStart, normalizedEnd)}）`,
  };
}

function inPeriod(date: string, start: string | null, end: string | null): boolean {
  if (!start || !end) return true;
  return date >= start && date <= end;
}

export function AdminDashboard() {
  const { state, isAdmin } = useShift();
  const [nameQuery, setNameQuery] = useState("");
  const [team, setTeam] = useState("all");
  const [staffFilter, setStaffFilter] = useState<StaffFilterKey>("all");
  const [staffPeriod, setStaffPeriod] = useState<PeriodKey>("thisWeek");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [dayFilter, setDayFilter] = useState<DayFilterKey>("all");

  const stats = useMemo(
    () =>
      buildDashboardStats(
        state.staffList,
        state.desiredShifts,
        state.confirmedShifts,
        state.requiredShifts,
        state.goalBlocksByDate
      ),
    [state]
  );

  const departments = useMemo(() => {
    const base =
      state.departments.length > 0 ? state.departments : Array.from(new Set(state.staffList.map((s) => s.team)));
    return base.includes(DEFAULT_GOAL_DEPARTMENT) ? base : [DEFAULT_GOAL_DEPARTMENT, ...base];
  }, [state.departments, state.staffList]);

  const periodRange = useMemo(
    () => resolveStaffPeriod(staffPeriod, customFrom, customTo),
    [customFrom, customTo, staffPeriod]
  );

  const periodStaffSummary = useMemo(() => {
    const desired = state.desiredShifts.filter((shift) => inPeriod(shift.date, periodRange.start, periodRange.end));
    const confirmed = state.confirmedShifts.filter((shift) => inPeriod(shift.date, periodRange.start, periodRange.end));
    return buildWeeklyStaffSummary(state.staffList, desired, confirmed);
  }, [periodRange, staffPeriod, state.confirmedShifts, state.desiredShifts, state.staffList]);

  const staffRows = useMemo(() => {
    return state.staffList
      .filter((s) => s.role === "worker" && s.status === "active")
      .filter((s) => (team === "all" ? true : s.team === team))
      .filter((s) => matchesStaffName(s, nameQuery))
      .map((staff) => {
        const weekly = periodStaffSummary.find((w) => w.staffId === staff.id);
        return { staff, weekly };
      })
      .filter((row) => {
        if (staffFilter === "withWish") return row.weekly?.hasDesiredShift;
        if (staffFilter === "withoutWish") return !row.weekly?.hasDesiredShift;
        if (staffFilter === "overContract") return row.weekly?.overContract;
        return true;
      })
      .sort((a, b) => a.staff.name.localeCompare(b.staff.name, "ja"));
  }, [nameQuery, periodStaffSummary, staffFilter, state.staffList, team]);

  const dayRows = useMemo(() => {
    return stats.daySummaries.filter((d) => {
      if (dayFilter === "minutesShortage") return d.minutesShortage > 0;
      if (dayFilter === "adjusted") return d.isAdjusted;
      if (dayFilter === "unadjusted") return !d.isAdjusted;
      return true;
    });
  }, [dayFilter, stats.daySummaries]);

  if (!isAdmin) {
    return null;
  }

  return (
    <>
      <section className="home-attention">
        <article className={`home-attention-card ${stats.shortageMinutes > 0 ? "warn" : "ok"}`}>
          <div className="home-attention-label">不足時間</div>
          <div className="home-attention-value">{formatMinutes(stats.shortageMinutes)}</div>
        </article>
        <article className={`home-attention-card ${stats.unadjustedDays > 0 ? "warn" : "ok"}`}>
          <div className="home-attention-label">調整未完了</div>
          <div className="home-attention-value">{stats.unadjustedDays}日</div>
        </article>
        <article className={`home-attention-card ${stats.overContractCount > 0 ? "warn" : "ok"}`}>
          <div className="home-attention-label">契約時間超過</div>
          <div className="home-attention-value">{stats.overContractCount}人</div>
        </article>
        <article className={`home-attention-card ${stats.minutesShortageDays > 0 ? "warn" : "ok"}`}>
          <div className="home-attention-label">時間不足の日</div>
          <div className="home-attention-value">{stats.minutesShortageDays}日</div>
        </article>
      </section>

      <section className="panel stack">
        <div className="home-section-head">
          <h2 style={{ margin: 0 }}>今週の概況</h2>
          <span className="muted">希望・確定・目安のサマリー</span>
        </div>
        <div className="grid-stats home-stats-grid">
          <Stat label="対象スタッフ" value={`${stats.targetStaffCount}人`} />
          <Stat label="希望登録あり" value={`${stats.withWishCount}人`} tone="ok" />
          <Stat label="希望登録なし" value={`${stats.withoutWishCount}人`} />
          <Stat label="希望勤務時間" value={formatMinutes(stats.desiredMinutes)} />
          <Stat label="確定勤務時間" value={formatMinutes(stats.confirmedMinutes)} tone="ok" />
          <Stat label="目安勤務時間" value={formatMinutes(stats.requiredMinutes)} />
        </div>
      </section>

      <section className="panel stack">
        <div className="actions" style={{ justifyContent: "space-between", marginTop: 0, alignItems: "baseline" }}>
          <div className="stack" style={{ gap: 2 }}>
            <h2 style={{ margin: 0 }}>個人集計</h2>
            <span className="muted" style={{ fontSize: 12 }}>
              {periodRange.label}
            </span>
          </div>
          <span className="muted">{staffRows.length}人</span>
        </div>
        <div className="filters dashboard-filters">
          <label className="filter-field">
            <span>期間</span>
            <select value={staffPeriod} onChange={(e) => setStaffPeriod(e.target.value as PeriodKey)}>
              <option value="thisWeek">今週</option>
              <option value="nextWeek">来週</option>
              <option value="thisMonth">今月</option>
              <option value="nextMonth">来月</option>
              <option value="custom">期間指定</option>
              <option value="all">全期間</option>
            </select>
          </label>
          {staffPeriod === "custom" ? (
            <>
              <label className="filter-field">
                <span>開始日</span>
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              </label>
              <label className="filter-field">
                <span>終了日</span>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </label>
            </>
          ) : null}
          <label className="filter-field">
            <span>姓・名</span>
            <input placeholder="マスタの姓・名で検索" value={nameQuery} onChange={(e) => setNameQuery(e.target.value)} />
          </label>
          <label className="filter-field">
            <span>所属</span>
            <select value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="all">すべて</option>
              {departments.map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>条件</span>
            <select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value as StaffFilterKey)}>
              <option value="all">すべて</option>
              <option value="withWish">希望登録あり</option>
              <option value="withoutWish">希望登録なし</option>
              <option value="overContract">契約時間超過</option>
            </select>
          </label>
        </div>
        <div className="table-scroll">
          <table className="table dashboard-table">
            <thead>
              <tr>
                <th>姓</th>
                <th>名</th>
                <th>所属</th>
                <th>契約h</th>
                <th>希望</th>
                <th>確定</th>
                <th>備考</th>
              </tr>
            </thead>
            <tbody>
              {staffRows.map(({ staff, weekly }) => (
                <tr key={staff.id}>
                  <td>{staff.name}</td>
                  <td>{staff.firstName}</td>
                  <td>{staff.team}</td>
                  <td>{formatContractHoursLabel(staff)}</td>
                  <td>{formatMinutes(weekly?.desiredMinutes ?? 0)}</td>
                  <td>{formatMinutes(weekly?.confirmedMinutes ?? 0)}</td>
                  <td>
                    {weekly?.hasDesiredShift ? "希望登録あり" : "希望登録なし"}
                    {weekly?.overContract ? " / 超過" : ""}
                  </td>
                </tr>
              ))}
              {staffRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    該当するスタッフがいません
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel stack">
        <div className="actions" style={{ justifyContent: "space-between", marginTop: 0, alignItems: "baseline" }}>
          <h2 style={{ margin: 0 }}>日別サマリー</h2>
          <span className="muted">{dayRows.length}日</span>
        </div>
        <div className="filters dashboard-filters">
          <label className="filter-field">
            <span>表示</span>
            <select value={dayFilter} onChange={(e) => setDayFilter(e.target.value as DayFilterKey)}>
              <option value="all">すべて</option>
              <option value="minutesShortage">時間不足</option>
              <option value="unadjusted">調整未完了</option>
              <option value="adjusted">調整済み</option>
            </select>
          </label>
        </div>
        <div className="table-scroll">
          <table className="table dashboard-table day-summary-table">
            <thead>
              <tr>
                <th>日付</th>
                <th>希望</th>
                <th>確定</th>
                <th>目安</th>
                <th>差分</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {dayRows.map((d) => {
                const hasShortage = d.minutesShortage > 0;
                return (
                  <tr key={d.date} className={hasShortage ? "row-shortage" : undefined}>
                    <td className="day-summary-date">{formatDayLabel(d.date)}</td>
                    <td>
                      <span className="day-summary-main">{d.desiredCount}人</span>
                      <span className="muted day-summary-sub">{formatMinutes(d.desiredMinutes)}</span>
                    </td>
                    <td>
                      <span className="day-summary-main">{d.confirmedCount}人</span>
                      <span className="muted day-summary-sub">{formatMinutes(d.confirmedMinutes)}</span>
                    </td>
                    <td>{formatMinutes(d.requiredMinutes)}</td>
                    <td className={hasShortage ? "text-shortage" : d.confirmedMinutes > d.requiredMinutes && d.requiredMinutes > 0 ? "text-ok" : undefined}>
                      {d.requiredMinutes > 0
                        ? formatConfirmedWithDiff(d.requiredMinutes, d.confirmedMinutes)
                        : formatMinutes(d.confirmedMinutes)}
                    </td>
                    <td>
                      <span className={`status-pill ${d.isAdjusted ? (hasShortage ? "warn" : "ok") : "muted"}`}>
                        {!d.isAdjusted ? "調整未完了" : hasShortage ? "時間不足" : "調整済み"}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {dayRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    表示する日がありません
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          目安時間は目安設定のブロックから集計しています。希望登録なしはエラー扱いしません。
        </p>
      </section>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className={`stat home-stat ${tone ? `tone-${tone}` : ""}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
