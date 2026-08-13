"use client";

import { useEffect, useMemo, useState } from "react";
import { getStaffDisplayName } from "@/lib/shift/display";
import { formatDateShort } from "@/lib/shift/dates";
import { getGoalDepartmentLabel } from "@/lib/shift/goal";
import { getStaffShiftStatus } from "@/lib/shift/publish-state";
import { getShiftStatusLabel, isAttendanceStatus } from "@/lib/shift/status";
import { formatMinutes, formatTimeRange, normalizeDisplayTime, toMinutes } from "@/lib/shift/time";
import type { ConfirmedShift, DesiredShift, Staff } from "@/lib/shift/types";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;
const TIMELINE_HOURS = [10, 12, 14, 16, 18] as const;
const ALL_DATES = "";

type DayEntry = {
  staff: Staff;
  desiredShift: DesiredShift | undefined;
  confirmedShift: ConfirmedShift | undefined;
  currentStatus: ConfirmedShift["status"];
};

function formatDayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00+09:00`);
  return `${formatDateShort(date)}（${WEEKDAYS[d.getDay()]}）`;
}

function statusRank(status: DayEntry["currentStatus"]): number {
  return isAttendanceStatus(status) ? 0 : status === "adjusting" ? 1 : 2;
}

function barStyle(startTime: string, endTime: string): { left: string; width: string } {
  const left = ((Math.max(toMinutes(startTime), 10 * 60) - 10 * 60) / (9 * 60)) * 100;
  const width = Math.max(
    ((Math.min(toMinutes(endTime), 19 * 60) - Math.max(toMinutes(startTime), 10 * 60)) / (9 * 60)) * 100,
    4
  );
  return { left: `${left}%`, width: `${width}%` };
}

function buildEntriesForDate(
  date: string,
  workers: Staff[],
  desiredShifts: DesiredShift[],
  confirmedShifts: ConfirmedShift[]
): DayEntry[] {
  return workers
    .map((staff) => {
      const desiredShift = desiredShifts.find((shift) => shift.date === date && shift.staffId === staff.id);
      const confirmedShift = confirmedShifts.find((shift) => shift.date === date && shift.staffId === staff.id);
      const currentStatus = getStaffShiftStatus(confirmedShift, desiredShift);
      return { staff, desiredShift, confirmedShift, currentStatus };
    })
    .filter((entry) => Boolean(entry.desiredShift || entry.confirmedShift))
    .sort((a, b) => {
      const statusDiff = statusRank(a.currentStatus) - statusRank(b.currentStatus);
      if (statusDiff !== 0) return statusDiff;
      return getStaffDisplayName(a.staff).localeCompare(getStaffDisplayName(b.staff), "ja");
    });
}

function DayGanttBlock({
  date,
  entries,
}: {
  date: string;
  entries: DayEntry[];
}) {
  return (
    <section className="day-summary-day-block">
      <div className="day-summary-day-head">
        <strong className="day-summary-day-title">{formatDayLabel(date)}</strong>
        <span className="muted">{entries.length}人</span>
      </div>

      <div className="timeline-gantt day-summary-timeline">
        <div className="timeline-header timeline-row-gantt">
          <div className="timeline-corner" />
          <div className="timeline-axis">
            {TIMELINE_HOURS.map((hour) => (
              <span
                key={hour}
                className="timeline-axis-label"
                style={{ left: `${((hour - 10) / 9) * 100}%` }}
              >
                {`${hour}:00`}
              </span>
            ))}
          </div>
        </div>

        {entries.length === 0 ? (
          <div className="muted" style={{ padding: "12px 0" }}>
            この日のシフトはありません。
          </div>
        ) : (
          entries.map(({ staff, desiredShift, currentStatus }) => {
            const shift = desiredShift;
            return (
              <div key={`${date}-${staff.id}`} className="timeline-row timeline-row-gantt">
                <div className="timeline-worker-name">
                  <span
                    className={`status-select timeline-status-select ${currentStatus}`}
                    style={{ pointerEvents: "none" }}
                  >
                    {getShiftStatusLabel(currentStatus)}
                  </span>
                  <div className="timeline-worker-meta day-summary-worker-meta">
                    <span className="day-summary-worker-name-row">
                      <span>{getStaffDisplayName(staff)}</span>
                      <span
                        className="person-icon goal-person-icon day-summary-team-icon"
                        title={staff.team || "未所属"}
                      >
                        {getGoalDepartmentLabel(staff.team || "未所属")}
                      </span>
                    </span>
                  </div>
                </div>
                <div className="timeline-track timeline-track-gantt">
                  <div className="timeline-grid-lines">
                    {TIMELINE_HOURS.map((hour) => (
                      <span
                        key={hour}
                        className="timeline-grid-line"
                        style={{ left: `${((hour - 10) / 9) * 100}%` }}
                      />
                    ))}
                  </div>
                  {shift ? (
                    <div
                      className={`gantt-bar ${currentStatus}`}
                      style={barStyle(shift.startTime, shift.endTime)}
                      title={`${getStaffDisplayName(staff)}さん ${formatTimeRange(shift.startTime, shift.endTime)}`}
                    >
                      <span className="gantt-time-start"> {normalizeDisplayTime(shift.startTime)}</span>
                      <span className="gantt-center-stack">
                        <span className="gantt-time-center">
                          {formatTimeRange(shift.startTime, shift.endTime)}
                        </span>
                        {shift.breakMinutes > 0 && currentStatus !== "unconfirmed" ? (
                          <span className="gantt-break">
                            <span className="gantt-break-mark">休</span>
                            <span>{formatMinutes(shift.breakMinutes)}</span>
                          </span>
                        ) : null}
                      </span>
                      <span className="gantt-time-end">{normalizeDisplayTime(shift.endTime)} </span>
                    </div>
                  ) : (
                    <div style={{ minHeight: 24 }} />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

export function DaySummaryGantt({
  dates,
  workers,
  desiredShifts,
  confirmedShifts,
}: {
  dates: string[];
  workers: Staff[];
  desiredShifts: DesiredShift[];
  confirmedShifts: ConfirmedShift[];
}) {
  const [selectedDate, setSelectedDate] = useState(ALL_DATES);

  useEffect(() => {
    if (selectedDate === ALL_DATES) return;
    if (!dates.includes(selectedDate)) {
      setSelectedDate(ALL_DATES);
    }
  }, [dates, selectedDate]);

  const visibleDates = useMemo(() => {
    if (selectedDate === ALL_DATES) return dates;
    return dates.includes(selectedDate) ? [selectedDate] : [];
  }, [dates, selectedDate]);

  const dayBlocks = useMemo(
    () =>
      visibleDates.map((date) => ({
        date,
        entries: buildEntriesForDate(date, workers, desiredShifts, confirmedShifts),
      })),
    [confirmedShifts, desiredShifts, visibleDates, workers]
  );

  if (dates.length === 0) {
    return <div className="muted">表示する日がありません</div>;
  }

  return (
    <div className="stack day-summary-gantt">
      <div className="filters dashboard-filters">
        <label className="filter-field day-summary-date-field">
          <span>日付</span>
          <select value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}>
            <option value={ALL_DATES}>ー</option>
            {dates.map((date) => (
              <option key={date} value={date}>
                {formatDayLabel(date)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="day-summary-day-list">
        {dayBlocks.map(({ date, entries }) => (
          <DayGanttBlock key={date} date={date} entries={entries} />
        ))}
      </div>
    </div>
  );
}
