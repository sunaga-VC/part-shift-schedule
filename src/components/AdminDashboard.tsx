"use client";

import { useMemo, useState } from "react";
import { DaySummaryGantt } from "@/components/DaySummaryGantt";
import { Icons } from "@/components/icons";
import { useShift } from "@/components/context/ShiftContext";
import {
  addDays,
  addMonthsToDateKey,
  formatDateRangeLabel,
  getMondayOfWeek,
  getMonthRange,
  getWorkWeekDates,
  toDateKeyJst,
} from "@/lib/shift/dates";
import { listOperableDepartmentNames } from "@/lib/shift/adminDepartments";
import { formatContractHoursLabel } from "@/lib/shift/staffEmployment";
import { buildDaySummaries, buildWeeklyStaffSummary, getActiveWorkers } from "@/lib/shift/summary";
import { formatMinutes } from "@/lib/shift/time";

type PeriodKey = "thisWeek" | "nextWeek" | "thisMonth" | "nextMonth" | "all" | "custom";

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
  const [staffPeriod, setStaffPeriod] = useState<PeriodKey>("thisWeek");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [staffSummaryOpen, setStaffSummaryOpen] = useState(false);

  const departments = useMemo(
    () => listOperableDepartmentNames(state.departments),
    [state.departments]
  );

  const periodRange = useMemo(
    () => resolveStaffPeriod(staffPeriod, customFrom, customTo),
    [customFrom, customTo, staffPeriod]
  );

  const filteredWorkers = useMemo(() => {
    return getActiveWorkers(state.staffList)
      .filter((s) => (team === "all" ? true : s.team === team))
      .filter((s) => matchesStaffName(s, nameQuery));
  }, [nameQuery, state.staffList, team]);

  const filteredStaffIds = useMemo(() => new Set(filteredWorkers.map((s) => s.id)), [filteredWorkers]);

  const filteredDesired = useMemo(
    () =>
      state.desiredShifts.filter(
        (shift) => inPeriod(shift.date, periodRange.start, periodRange.end) && filteredStaffIds.has(shift.staffId)
      ),
    [filteredStaffIds, periodRange.end, periodRange.start, state.desiredShifts]
  );

  const filteredConfirmed = useMemo(
    () =>
      state.confirmedShifts.filter(
        (shift) => inPeriod(shift.date, periodRange.start, periodRange.end) && filteredStaffIds.has(shift.staffId)
      ),
    [filteredStaffIds, periodRange.end, periodRange.start, state.confirmedShifts]
  );

  const filteredRequired = useMemo(
    () => state.requiredShifts.filter((shift) => inPeriod(shift.date, periodRange.start, periodRange.end)),
    [periodRange.end, periodRange.start, state.requiredShifts]
  );

  const filteredGoalBlocks = useMemo(() => {
    return Object.fromEntries(
      Object.entries(state.goalBlocksByDate).filter(([date]) => inPeriod(date, periodRange.start, periodRange.end))
    ) as typeof state.goalBlocksByDate;
  }, [periodRange.end, periodRange.start, state.goalBlocksByDate]);

  const departmentFilter = team === "all" ? undefined : team;

  const daySummaries = useMemo(
    () =>
      buildDaySummaries(
        filteredDesired,
        filteredConfirmed,
        filteredRequired,
        filteredGoalBlocks,
        departmentFilter
      ),
    [departmentFilter, filteredConfirmed, filteredDesired, filteredGoalBlocks, filteredRequired]
  );

  const periodStaffSummary = useMemo(
    () => buildWeeklyStaffSummary(filteredWorkers, filteredDesired, filteredConfirmed),
    [filteredConfirmed, filteredDesired, filteredWorkers]
  );

  const staffRows = useMemo(() => {
    return filteredWorkers
      .map((staff) => {
        const weekly = periodStaffSummary.find((w) => w.staffId === staff.id);
        return { staff, weekly };
      })
      .sort((a, b) => a.staff.name.localeCompare(b.staff.name, "ja"));
  }, [filteredWorkers, periodStaffSummary]);

  const staffSummaryMeta = useMemo(() => {
    const noWish = staffRows.filter(({ weekly }) => !weekly?.hasDesiredShift).length;
    const overContract = staffRows.filter(({ weekly }) => weekly?.overContract).length;
    return { noWish, overContract };
  }, [staffRows]);

  const ganttDates = useMemo(() => daySummaries.map((d) => d.date), [daySummaries]);

  if (!isAdmin) {
    return null;
  }

  return (
    <section className="panel stack">
      <div className="home-section-head">
        <h2 style={{ margin: 0 }}>絞り込み</h2>
        <span className="muted" style={{ fontSize: 12 }}>
          {periodRange.label}
        </span>
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
          <input
            placeholder="マスタの姓・名で検索"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
          />
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
      </div>

      <button
        type="button"
        className={`staff-summary-toggle${staffSummaryOpen ? " open" : ""}`}
        onClick={() => setStaffSummaryOpen((prev) => !prev)}
        aria-expanded={staffSummaryOpen}
      >
        <div className="staff-summary-toggle-main">
          <div className="staff-summary-toggle-title">
            <Icons.Master size={16} className="staff-summary-toggle-icon" />
            <strong>個人集計</strong>
            <span className="badge">{staffRows.length}人</span>
          </div>
          <div className="staff-summary-toggle-hints">
            <span className="muted">{periodRange.label}</span>
            {!staffSummaryOpen ? (
              <>
                {staffSummaryMeta.noWish > 0 ? (
                  <span className="staff-summary-chip warn">希望なし {staffSummaryMeta.noWish}</span>
                ) : null}
                {staffSummaryMeta.overContract > 0 ? (
                  <span className="staff-summary-chip warn">超過 {staffSummaryMeta.overContract}</span>
                ) : null}
                {staffSummaryMeta.noWish === 0 && staffSummaryMeta.overContract === 0 ? (
                  <span className="staff-summary-chip">特記事項なし</span>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
        <span className="staff-summary-toggle-action">
          <span>{staffSummaryOpen ? "閉じる" : "開く"}</span>
          {staffSummaryOpen ? <Icons.ChevronUp size={18} /> : <Icons.ChevronDown size={18} />}
        </span>
      </button>
      {staffSummaryOpen ? (
        <div className="table-scroll staff-summary-table-wrap">
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
      ) : null}

      <DaySummaryGantt
        dates={ganttDates}
        workers={filteredWorkers}
        desiredShifts={filteredDesired}
        confirmedShifts={filteredConfirmed}
      />
    </section>
  );
}
