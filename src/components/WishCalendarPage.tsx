"use client";

import { useMemo, useState } from "react";
import { CalendarNavToolbar } from "@/components/CalendarNavToolbar";
import { Icons } from "@/components/icons";
import { useShift } from "@/context/ShiftContext";
import { useWorkCalendarNavigation } from "@/hooks/useWorkCalendarNavigation";
import { formatDateLong, formatDateShort } from "@/lib/shift/dates";
import { getStaffDisplayName } from "@/lib/shift/display";
import { hasStaffPendingAdjustment } from "@/lib/shift/publish-state";
import { calcBreakMinutes, formatTimeRange } from "@/lib/shift/time";

export function WishCalendarPage() {
  const {
    state,
    currentUser,
    isAdmin,
    workers,
    upsertDesiredShift,
    deleteDesiredShift,
  } = useShift();

  const {
    todayKey,
    calendarMonth,
    monthPickerOpen,
    setMonthPickerOpen,
    calendarScrollRef,
    weekGroups,
    currentWeekIndex,
    handleGoToday: goToTodayWeek,
    handleSelectMonth,
    handleChangeYear,
  } = useWorkCalendarNavigation();
  const publishedWeekDates = useMemo(() => {
    const group = weekGroups.find((group) => group[0] === state.period.publishedWeekStartDate);
    return group ?? [];
  }, [state.period.publishedWeekStartDate, weekGroups]);
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [editing, setEditing] = useState(false);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const myWish = state.desiredShifts.find(
    (s) => s.staffId === currentUser.id && s.date === selectedDate
  );
  const selectedDateConfirmedShift = state.confirmedShifts.find(
    (s) => s.staffId === currentUser.id && s.date === selectedDate
  );
  const selectedDateIsPublished = publishedWeekDates.includes(selectedDate);
  const selectedDatePending = hasStaffPendingAdjustment(
    state.period,
    selectedDateConfirmedShift,
    myWish,
    selectedDate
  );

  function renderDayTime(
    date: string,
    mine: typeof myWish,
    confirmedShift: typeof selectedDateConfirmedShift,
    isPublishedDate: boolean
  ) {
    const pending = hasStaffPendingAdjustment(state.period, confirmedShift, mine, date);
    if (isPublishedDate && !pending) {
      if (confirmedShift?.publishedAt) {
        if (confirmedShift.status === "confirmed") {
          return (
            <span className="published-time">
              {formatTimeRange(confirmedShift.startTime, confirmedShift.endTime)}
            </span>
          );
        }
        return <span className="muted">休み</span>;
      }
      return <span className="muted">休み</span>;
    }
    if (mine) {
      return <span className="wish-edited-time">{formatTimeRange(mine.startTime, mine.endTime)}</span>;
    }
    if (isPublishedDate && pending) {
      return <span className="wish-edited-time">設定なし</span>;
    }
    return <span className="muted">設定なし</span>;
  }

  function renderSelfTimeLabel() {
    if (selectedDateIsPublished && !selectedDatePending) {
      if (selectedDateConfirmedShift?.publishedAt) {
        return selectedDateConfirmedShift.status === "confirmed"
          ? formatTimeRange(selectedDateConfirmedShift.startTime, selectedDateConfirmedShift.endTime)
          : "休み";
      }
      return "休み";
    }
    if (myWish) {
      return formatTimeRange(myWish.startTime, myWish.endTime);
    }
    if (selectedDateIsPublished && selectedDatePending) {
      return "設定なし";
    }
    return "設定なし";
  }

  function renderSelfTimeClassName() {
    if (selectedDateIsPublished && !selectedDatePending) {
      if (selectedDateConfirmedShift?.publishedAt && selectedDateConfirmedShift.status === "confirmed") {
        return "self-time published-time";
      }
      return "self-time muted";
    }
    if (myWish || (selectedDateIsPublished && selectedDatePending)) {
      return "self-time wish-edited-time";
    }
    return "self-time muted";
  }

  const dayWishes = useMemo(() => {
    return state.desiredShifts
      .filter((s) => s.date === selectedDate)
      .map((s) => ({
        shift: s,
        staff: workers.find((w) => w.id === s.staffId) ?? state.staffList.find((w) => w.id === s.staffId && w.status === "active"),
      }))
      .filter((x) => x.staff)
      .sort((a, b) => {
        if (a.shift.startTime !== b.shift.startTime) {
          return a.shift.startTime.localeCompare(b.shift.startTime);
        }
        return getStaffDisplayName(a.staff).localeCompare(getStaffDisplayName(b.staff), "ja");
      });
  }, [selectedDate, state.desiredShifts, state.staffList, workers]);

  const editable = !isAdmin && currentUser.role === "worker";
  function openEdit(forCreate: boolean) {
    if (myWish) {
      setStartTime(myWish.startTime);
      setEndTime(myWish.endTime);
      setNote(myWish.note);
    } else {
      setStartTime("09:00");
      setEndTime("17:00");
      setNote("");
    }
    setEditing(true);
    if (forCreate) setMessage(null);
  }

  function handleSave() {
    const result = upsertDesiredShift({
      date: selectedDate,
      startTime,
      endTime,
      note,
    });
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setEditing(false);
    setMessage("保存しました。管理者画面と希望者リストに即時反映されます。");
  }

  function handleDelete() {
    const result = deleteDesiredShift(selectedDate);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setEditing(false);
    setMessage("削除しました。");
  }

  const handleGoToday = () => {
    goToTodayWeek((dateKey) => {
      setSelectedDate(dateKey);
      setEditing(false);
      setMessage(null);
    });
  };

  return (
    <div className="stack">
      <section className="panel">
        <h1 className="page-title-with-icon" style={{ marginTop: 0 }}>
          <Icons.Shift size={20} className="page-title-icon" />
          シフトカレンダー
        </h1>
        {isAdmin && (
          <p className="badge">管理者として閲覧中（登録操作はアルバイトユーザーで行ってください）</p>
        )}
      </section>

      <div className="grid-2">
        <section className="panel">
          <div className="calendar-scroll wish-calendar" ref={calendarScrollRef}>
            <div className="calendar-header-sticky">
              <CalendarNavToolbar
                calendarMonth={calendarMonth}
                monthPickerOpen={monthPickerOpen}
                setMonthPickerOpen={setMonthPickerOpen}
                onGoToday={handleGoToday}
                onSelectMonth={handleSelectMonth}
                onChangeYear={handleChangeYear}
              />
              <div className="calendar calendar-weekday-header work-calendar">
                {["月", "火", "水", "木", "金"].map((d) => (
                  <div key={d} className="calendar-head">
                    {d}
                  </div>
                ))}
              </div>
            </div>
            <div className="calendar-stack">
              {weekGroups.map((group, weekIndex) => (
                <div
                  className={`calendar-week-row${weekIndex < currentWeekIndex ? " past-week" : ""}`}
                  key={`week-${weekIndex}`}
                  data-week-index={weekIndex}
                >
                  {group.map((date) => {
                    const count = state.desiredShifts.filter((s) => s.date === date).length;
                    const mine = state.desiredShifts.find(
                      (s) => s.staffId === currentUser.id && s.date === date
                    );
                    const confirmedShift = state.confirmedShifts.find(
                      (s) => s.staffId === currentUser.id && s.date === date
                    );
                    const isPublishedDate = publishedWeekDates.includes(date);
                    return (
                      <button
                        key={date}
                        type="button"
                        className={`day-cell${selectedDate === date ? " selected" : ""}${
                          weekIndex < currentWeekIndex ? " past" : ""
                        }${publishedWeekDates.includes(date) ? " published-date" : ""}`}
                        onClick={() => {
                          setSelectedDate(date);
                          setEditing(false);
                          setMessage(null);
                        }}
                        disabled={false}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%" }}>
                          <div className="day-num">{formatDateShort(date)}</div>
                          <span className="day-meta" style={{ marginTop: 0, whiteSpace: "nowrap" }}>
                            希望 {count}人
                          </span>
                        </div>
                        <div className="day-meta">{renderDayTime(date, mine, confirmedShift, isPublishedDate)}</div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="panel stack">
          <div>
            <h2 style={{ marginTop: 0 }}>{formatDateShort(selectedDate)}</h2>
            <p className="muted" style={{ marginBottom: 8 }}>希望者：{dayWishes.length}人</p>
            <div className="list" style={{ marginTop: 12 }}>
              {currentUser.role === "worker" && (
                <div className="list-item self-row">
                  <div className="self-summary">
                    <span className="self-name">{getStaffDisplayName(currentUser)}</span>
                    <span className={renderSelfTimeClassName()}>{renderSelfTimeLabel()}</span>
                  </div>
                  <span className="actions" style={{ marginTop: 0 }}>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "4px 8px" }}
                      disabled={!editable}
                      onClick={() => openEdit(Boolean(myWish) ? false : true)}
                      aria-label="編集"
                    >
                      <Icons.Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn danger"
                      style={{ padding: "4px 8px" }}
                      disabled={!editable || !myWish}
                      onClick={handleDelete}
                      aria-label="削除"
                    >
                      <Icons.Trash size={14} />
                    </button>
                  </span>
                </div>
              )}
              {dayWishes
                .filter(({ shift }) => shift.staffId !== currentUser.id)
                .map(({ shift, staff }) => (
                  <div key={shift.id} className="list-item wish-row">
                    <span>{getStaffDisplayName(staff)}</span>
                    <span>{formatTimeRange(shift.startTime, shift.endTime)}</span>
                  </div>
                ))}
              {currentUser.role === "worker" && !myWish && dayWishes.length === 0 && <div className="muted">設定なし</div>}
            </div>
          </div>
          {editing ? (
            <div className="form-grid">
              <div>
                <strong>{formatDateLong(selectedDate)}</strong>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                <label>
                  開始時刻
                  <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </label>
                <label>
                  終了時刻
                  <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </label>
              </div>
              <label>
                備考
                <textarea
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="16時まででも対応可能"
                />
              </label>
              <div className="actions">
                <button type="button" className="btn primary" onClick={handleSave}>
                  保存
                </button>
                <button type="button" className="btn" onClick={() => setEditing(false)}>
                  キャンセル
                </button>
              </div>
            </div>
          ) : null}

          {message && <p className="badge">{message}</p>}
        </section>
      </div>
    </div>
  );
}
