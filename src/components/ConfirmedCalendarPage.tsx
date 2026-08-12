"use client";

import { useMemo, useState } from "react";
import { Icons } from "@/components/icons";
import { useShift } from "@/context/ShiftContext";
import { formatDateShort } from "@/lib/shift/dates";
import { getStaffDisplayName } from "@/lib/shift/display";
import { formatShiftSummary, formatTimeRange } from "@/lib/shift/time";

export function ConfirmedCalendarPage() {
  const { state, currentUser, isAdmin, workers } = useShift();
  const visibleDates = useMemo(() => {
    const result: string[] = [];
    const today = new Date();
    const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const offsetToMonday = (cursor.getDay() + 6) % 7;
    cursor.setDate(cursor.getDate() - offsetToMonday - 28);
    while (result.length < 60) {
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
  }, []);
  const weekGroups = useMemo(() => {
    const groups: string[][] = [];
    for (let index = 0; index < visibleDates.length; index += 5) {
      groups.push(visibleDates.slice(index, index + 5));
    }
    return groups;
  }, [visibleDates]);
  const todayKey = useMemo(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  }, []);
  const currentWeekIndex = useMemo(
    () => weekGroups.findIndex((group) => group.includes(todayKey)),
    [todayKey, weekGroups]
  );
  const [selectedDate, setSelectedDate] = useState(todayKey);

  const visibleConfirmed = useMemo(() => {
    return state.confirmedShifts.filter((s) => s.status === "confirmed");
  }, [isAdmin, state.confirmedShifts]);

  const myShifts = visibleConfirmed.filter(
    (s) => s.staffId === currentUser.id && s.date === selectedDate
  );
  const dayShifts = visibleConfirmed
    .filter((s) => s.date === selectedDate)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  return (
    <div className="stack">
      <section className="panel">
        <h1 style={{ marginTop: 0 }}>確定シフトカレンダー</h1>
        <p className="muted">
          {isAdmin
            ? "管理者は未公開の確定シフトも確認できます。"
            : "公開された確定シフトのみ表示されます。"}
        </p>
      </section>

      <div className="grid-2">
        <section className="panel">
          <div className="calendar-scroll">
            <div className="calendar calendar-weekday-header work-calendar">
              {["月", "火", "水", "木", "金"].map((d) => (
                <div key={d} className="calendar-head">
                  {d}
                </div>
              ))}
            </div>
            <div className="calendar-stack">
              {weekGroups.map((group, weekIndex) => (
                <div
                  className={`calendar-week-row${weekIndex < currentWeekIndex ? " past-week" : ""}`}
                  key={`week-${weekIndex}`}
                >
                  {group.map((date) => {
                    const mine = visibleConfirmed.find(
                      (s) => s.staffId === currentUser.id && s.date === date
                    );
                    const countConfirmed = visibleConfirmed.filter(
                      (s) => s.date === date && s.status === "confirmed"
                    ).length;
                    const countUnconfirmed = visibleConfirmed.filter(
                      (s) => s.date === date && s.status === "unconfirmed"
                    ).length;
                    return (
                      <button
                        key={date}
                        type="button"
                        className={`day-cell${selectedDate === date ? " selected" : ""}${
                          weekIndex < currentWeekIndex ? " past" : ""
                        }`}
                        onClick={() => setSelectedDate(date)}
                      >
                        <div className="day-num">{formatDateShort(date)}</div>
                        <div className="day-meta">
                          <span>確定 {countConfirmed}人</span>
                          {isAdmin && countUnconfirmed > 0 && <span>未確定 {countUnconfirmed}人</span>}
                          {mine && <span>自分 {formatTimeRange(mine.startTime, mine.endTime)}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="panel stack">
          <h2 style={{ marginTop: 0 }}>{formatDateShort(selectedDate)}</h2>

          <div>
            <h3>自分の確定シフト</h3>
            {myShifts.length === 0 ? (
              <p className="muted">この日の確定シフトはありません</p>
            ) : (
              myShifts.map((s) => (
                <div key={s.id} className="list-item single-line-item">
                  <strong>{getStaffDisplayName(currentUser)}さん</strong>
                  <span>{formatTimeRange(s.startTime, s.endTime)}</span>
                  <span>{formatShiftSummary(s.startTime, s.endTime, s.breakMinutes)}</span>
                  {s.note ? (
                    <span className="note-dot" title={s.note}>
                      <Icons.Note size={14} />
                    </span>
                  ) : null}
                  <span>{s.status === "confirmed" ? "確定済み" : "未確定"}</span>
                </div>
              ))
            )}
          </div>

          {isAdmin && (
            <div>
              <h3>当日の確定一覧</h3>
              <div className="list">
                {dayShifts.length === 0 && <div className="muted">なし</div>}
                {dayShifts.map((s) => {
                  const staff = workers.find((w) => w.id === s.staffId);
                  return (
                    <div key={s.id} className="list-item single-line-item">
                      <strong>{getStaffDisplayName(staff)}さん</strong>
                      <span>{formatTimeRange(s.startTime, s.endTime)}</span>
                      <span>{formatShiftSummary(s.startTime, s.endTime, s.breakMinutes)}</span>
                      <span>{s.status === "confirmed" ? "確定済み" : "未確定"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
