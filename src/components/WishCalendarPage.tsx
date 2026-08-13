"use client";

import { useMemo, useState, useEffect } from "react";
import { CalendarNavToolbar } from "@/components/CalendarNavToolbar";
import { WorkerShiftHeader } from "@/components/WorkerShiftHeader";
import { Icons } from "@/components/icons";
import { useShift } from "@/components/context/ShiftContext";
import { useWorkCalendarNavigation } from "@/hooks/useWorkCalendarNavigation";
import { formatDateLong, formatDateShort } from "@/lib/shift/dates";
import { getStaffDisplayName } from "@/lib/shift/display";
import {
  hasStaffPendingAdjustment,
  isWorkerCalendarDatePublished,
  resolveWorkerShiftDisplay,
} from "@/lib/shift/publish-state";
import {
  clampTimeToOptions,
  formatTimeRange,
  getWorkerShiftTimeOptions,
} from "@/lib/shift/time";

export function WishCalendarPage() {
  const {
    state,
    currentUser,
    isAdmin,
    workers,
    upsertDesiredShift,
    deleteDesiredShift,
    flushShiftPersist,
  } = useShift();

  const {
    defaultSelectedDateKey,
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
  const [selectedDate, setSelectedDate] = useState(defaultSelectedDateKey);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("18:00");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const isWorkerView = !isAdmin && currentUser?.role === "worker";
  const workerPublishedDates = state.workerPublishedDates;
  const [stickyPublishedDates, setStickyPublishedDates] = useState<string[]>([]);
  const knownDepartments = useMemo(() => new Set(state.departments), [state.departments]);

  useEffect(() => {
    if (!isWorkerView || !workerPublishedDates?.length) return;
    setStickyPublishedDates((prev) => {
      const merged = new Set([...prev, ...workerPublishedDates]);
      const next = Array.from(merged).sort();
      if (next.length === prev.length && next.every((date, index) => date === prev[index])) {
        return prev;
      }
      return next;
    });
  }, [isWorkerView, workerPublishedDates]);

  const effectiveWorkerPublishedDates = useMemo(() => {
    if (!isWorkerView) return workerPublishedDates ?? [];
    return Array.from(new Set([...(workerPublishedDates ?? []), ...stickyPublishedDates])).sort();
  }, [isWorkerView, workerPublishedDates, stickyPublishedDates]);

  function isWorkerPublishedDate(date: string) {
    if (effectiveWorkerPublishedDates.includes(date)) return true;
    return isWorkerCalendarDatePublished(
      date,
      workerPublishedDates,
      state.period,
      state.staffList,
      state.confirmedShifts,
      currentUser?.team ?? "",
      currentUser?.id ?? "",
      { knownDepartments }
    );
  }

  const myWish = state.desiredShifts.find(
    (s) => s.staffId === currentUser?.id && s.date === selectedDate
  );
  const selectedDateConfirmedShift = state.confirmedShifts.find(
    (s) => s.staffId === currentUser?.id && s.date === selectedDate
  );

  function isPublishedCalendarDate(date: string) {
    if (isWorkerView) {
      return isWorkerPublishedDate(date);
    }
    return isWorkerCalendarDatePublished(
      date,
      workerPublishedDates,
      state.period,
      state.staffList,
      state.confirmedShifts,
      currentUser?.team ?? "",
      currentUser?.id ?? "",
      { knownDepartments }
    );
  }

  function resolveCalendarShiftDisplay(
    date: string,
    confirmedShift: typeof selectedDateConfirmedShift,
    mine: typeof myWish
  ) {
    return resolveWorkerShiftDisplay(
      state.period,
      confirmedShift,
      mine,
      date,
      isWorkerView ? effectiveWorkerPublishedDates : workerPublishedDates
    );
  }

  const selectedDateDisplay = resolveCalendarShiftDisplay(
    selectedDate,
    selectedDateConfirmedShift,
    myWish
  );

  function renderDayTime(
    date: string,
    mine: typeof myWish,
    confirmedShift: typeof selectedDateConfirmedShift
  ) {
    const display = resolveCalendarShiftDisplay(date, confirmedShift, mine);
    if (display.kind === "rest") {
      return <span className="muted">休み</span>;
    }
    if (display.kind === "confirmed") {
      return (
        <span className="published-time">
          {formatTimeRange(display.shift.startTime, display.shift.endTime)}
        </span>
      );
    }
    if (display.kind === "wish") {
      return (
        <span className="wish-edited-time">
          {formatTimeRange(display.shift.startTime, display.shift.endTime)}
        </span>
      );
    }
    if (display.pending) {
      return <span className="wish-edited-time">設定なし</span>;
    }
    return <span className="muted">設定なし</span>;
  }

  function renderSelfTimeLabel() {
    if (selectedDateDisplay.kind === "rest") return "休み";
    if (selectedDateDisplay.kind === "confirmed") {
      return formatTimeRange(selectedDateDisplay.shift.startTime, selectedDateDisplay.shift.endTime);
    }
    if (selectedDateDisplay.kind === "wish") {
      return formatTimeRange(selectedDateDisplay.shift.startTime, selectedDateDisplay.shift.endTime);
    }
    return "設定なし";
  }

  function renderSelfTimeClassName() {
    if (selectedDateDisplay.kind === "rest") return "self-time muted";
    if (selectedDateDisplay.kind === "confirmed") return "self-time published-time";
    if (selectedDateDisplay.kind === "wish" || selectedDateDisplay.pending) {
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

  const editable = isWorkerView;
  const timeOptions = useMemo(
    () => getWorkerShiftTimeOptions(Boolean(currentUser?.socialInsurance)),
    [currentUser?.socialInsurance]
  );

  function selectDate(date: string) {
    setSelectedDate(date);
    setEditing(false);
    setMessage(null);
    if (isWorkerView) {
      setDetailOpen(true);
    }
  }

  function closeDetail() {
    setDetailOpen(false);
    setEditing(false);
    setMessage(null);
  }

  function openEdit(forCreate: boolean) {
    if (myWish) {
      setStartTime(clampTimeToOptions(myWish.startTime, timeOptions));
      setEndTime(clampTimeToOptions(myWish.endTime, timeOptions));
      setNote(myWish.note);
    } else {
      setStartTime("10:00");
      setEndTime(currentUser?.socialInsurance ? "18:30" : "18:00");
      setNote("");
    }
    setEditing(true);
    if (forCreate) setMessage(null);
  }

  async function handleSave() {
    const result = upsertDesiredShift({
      date: selectedDate,
      startTime: clampTimeToOptions(startTime, timeOptions),
      endTime: clampTimeToOptions(endTime, timeOptions),
      note,
    });
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    const persisted = await flushShiftPersist();
    if (!persisted.ok) {
      setMessage(`保存に失敗しました: ${persisted.message}`);
      return;
    }
    setEditing(false);
    setMessage("保存しました。管理者画面に反映されます。");
  }

  async function handleDelete() {
    const result = deleteDesiredShift(selectedDate);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    const persisted = await flushShiftPersist();
    if (!persisted.ok) {
      setMessage(`削除に失敗しました: ${persisted.message}`);
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
      if (isWorkerView) {
        setDetailOpen(true);
      }
    });
  };

  const dayDetailContent = (
    <>
      <div>
        <h2 style={{ marginTop: 0 }}>{formatDateShort(selectedDate)}</h2>
        <p className="muted" style={{ marginBottom: 8 }}>
          希望者：{dayWishes.length}人
        </p>
        <div className="list" style={{ marginTop: 12 }}>
          {currentUser?.role === "worker" && (
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
            .filter(({ shift }) => shift.staffId !== currentUser?.id)
            .map(({ shift, staff }) => (
              <div key={shift.id} className="list-item wish-row">
                <span>{getStaffDisplayName(staff)}</span>
                <span>{formatTimeRange(shift.startTime, shift.endTime)}</span>
              </div>
            ))}
          {currentUser?.role === "worker" && !myWish && dayWishes.length === 0 && (
            <div className="muted">
              {selectedDateDisplay.kind === "rest" ? "休み" : "設定なし"}
            </div>
          )}
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
              <select value={startTime} onChange={(e) => setStartTime(e.target.value)}>
                {timeOptions.map((time) => (
                  <option key={`start-${time}`} value={time}>
                    {time}
                  </option>
                ))}
              </select>
            </label>
            <label>
              終了時刻
              <select value={endTime} onChange={(e) => setEndTime(e.target.value)}>
                {timeOptions.map((time) => (
                  <option key={`end-${time}`} value={time}>
                    {time}
                  </option>
                ))}
              </select>
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
    </>
  );

  return (
    <div className="stack">
      {isWorkerView ? <WorkerShiftHeader /> : null}
      <section className="panel">
        <h1 className="page-title-with-icon" style={{ marginTop: 0 }}>
          <Icons.Shift size={20} className="page-title-icon" />
          シフトカレンダー
        </h1>
        {isAdmin && (
          <p className="badge">管理者として閲覧中（登録操作はアルバイトユーザーで行ってください）</p>
        )}
      </section>

      <div className={isWorkerView ? "stack" : "grid-2"}>
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
                      (s) => s.staffId === currentUser?.id && s.date === date
                    );
                    const confirmedShift = state.confirmedShifts.find(
                      (s) => s.staffId === currentUser?.id && s.date === date
                    );
                    const isPublishedDate = isPublishedCalendarDate(date);
                    const isPendingAdjustment =
                      !isWorkerView &&
                      hasStaffPendingAdjustment(
                        state.period,
                        confirmedShift,
                        mine,
                        date,
                        workerPublishedDates
                      );
                    const dateCellStatusClass = isWorkerView
                      ? isPublishedDate
                        ? " published-date"
                        : ""
                      : isPendingAdjustment
                        ? " pending-adjustment-date"
                        : isPublishedDate
                          ? " published-date"
                          : "";
                    return (
                      <button
                        key={date}
                        type="button"
                        className={`day-cell${selectedDate === date ? " selected" : ""}${
                          weekIndex < currentWeekIndex ? " past" : ""
                        }${dateCellStatusClass}`}
                        onClick={() => selectDate(date)}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            width: "100%",
                          }}
                        >
                          <div className="day-num">{formatDateShort(date)}</div>
                          <span className="day-meta" style={{ marginTop: 0, whiteSpace: "nowrap" }}>
                            希望 {count}人
                          </span>
                        </div>
                        <div className="day-meta">{renderDayTime(date, mine, confirmedShift)}</div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </section>

        {!isWorkerView ? <section className="panel stack">{dayDetailContent}</section> : null}
      </div>

      {isWorkerView && detailOpen ? (
        <div className="modal-backdrop" onClick={closeDetail}>
          <div
            className="modal-panel stack wish-day-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`${formatDateShort(selectedDate)}のシフト`}
          >
            <div className="actions" style={{ justifyContent: "space-between", marginTop: 0 }}>
              <strong style={{ fontSize: 15 }}>{formatDateLong(selectedDate)}</strong>
              <button type="button" className="btn" onClick={closeDetail}>
                閉じる
              </button>
            </div>
            {dayDetailContent}
          </div>
        </div>
      ) : null}
    </div>
  );
}
