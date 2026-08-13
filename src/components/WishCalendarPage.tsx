"use client";

import { memo, useCallback, useDeferredValue, useMemo, useState, useEffect } from "react";
import { CalendarNavToolbar } from "@/components/CalendarNavToolbar";
import { WorkerShiftHeader } from "@/components/WorkerShiftHeader";
import { Icons } from "@/components/icons";
import { useShift, useShiftAuth } from "@/components/context/ShiftContext";
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
import type { ConfirmedShift, DesiredShift } from "@/lib/shift/types";

type WishCalendarDayCellData = {
  wishCount: number;
  timeLabel: string;
  timeClassName: string;
  cellStatusClass: string;
};

const WishCalendarDayCell = memo(function WishCalendarDayCell({
  date,
  weekIndex,
  currentWeekIndex,
  selected,
  data,
  onSelectDate,
}: {
  date: string;
  weekIndex: number;
  currentWeekIndex: number;
  selected: boolean;
  data: WishCalendarDayCellData;
  onSelectDate: (date: string) => void;
}) {
  return (
    <button
      type="button"
      className={`day-cell${selected ? " selected" : ""}${weekIndex < currentWeekIndex ? " past" : ""}${data.cellStatusClass}`}
      onClick={() => onSelectDate(date)}
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
          希望 {data.wishCount}人
        </span>
      </div>
      <div className="day-meta">
        <span className={data.timeClassName}>{data.timeLabel}</span>
      </div>
    </button>
  );
});

export function WishCalendarPage() {
  const { state, upsertDesiredShift, deleteDesiredShift, flushShiftPersist } = useShift();
  const { currentUser, isAdmin, workers } = useShiftAuth();

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
  const detailDate = useDeferredValue(selectedDate);
  const handleSelectCalendarDate = useCallback((date: string) => {
    setSelectedDate(date);
    setEditing(false);
    setMessage(null);
    if (!isAdmin && currentUser?.role === "worker") {
      setDetailOpen(true);
    }
  }, [currentUser?.role, isAdmin]);
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

  const calendarDates = useMemo(() => weekGroups.flat(), [weekGroups]);
  const workerCalendarCells = useMemo(() => {
    const wishCountByDate = new Map<string, number>();
    const myWishByDate = new Map<string, DesiredShift>();
    const myConfirmedByDate = new Map<string, ConfirmedShift>();
    const currentUserId = currentUser?.id;

    for (const shift of state.desiredShifts) {
      wishCountByDate.set(shift.date, (wishCountByDate.get(shift.date) ?? 0) + 1);
      if (currentUserId && shift.staffId === currentUserId) {
        myWishByDate.set(shift.date, shift);
      }
    }
    if (currentUserId) {
      for (const shift of state.confirmedShifts) {
        if (shift.staffId === currentUserId) {
          myConfirmedByDate.set(shift.date, shift);
        }
      }
    }

    const cells = new Map<string, WishCalendarDayCellData>();
    for (const date of calendarDates) {
      const mine = currentUserId ? myWishByDate.get(date) : undefined;
      const confirmedShift = currentUserId ? myConfirmedByDate.get(date) : undefined;
      const isPublishedDate = isWorkerView
        ? effectiveWorkerPublishedDates.includes(date) ||
          isWorkerCalendarDatePublished(
            date,
            workerPublishedDates,
            state.period,
            state.staffList,
            state.confirmedShifts,
            currentUser?.team ?? "",
            currentUserId ?? "",
            { knownDepartments }
          )
        : isWorkerCalendarDatePublished(
            date,
            workerPublishedDates,
            state.period,
            state.staffList,
            state.confirmedShifts,
            currentUser?.team ?? "",
            currentUserId ?? "",
            { knownDepartments }
          );
      const isPendingAdjustment =
        !isWorkerView &&
        hasStaffPendingAdjustment(
          state.period,
          confirmedShift,
          mine,
          date,
          workerPublishedDates
        );
      const display = resolveWorkerShiftDisplay(
        state.period,
        confirmedShift,
        mine,
        date,
        isWorkerView ? effectiveWorkerPublishedDates : workerPublishedDates
      );
      let timeLabel = "設定なし";
      let timeClassName = "muted";
      if (display.kind === "rest") {
        timeLabel = "休み";
      } else if (display.kind === "confirmed") {
        timeLabel = formatTimeRange(display.shift.startTime, display.shift.endTime);
        timeClassName = "published-time";
      } else if (display.kind === "wish") {
        timeLabel = formatTimeRange(display.shift.startTime, display.shift.endTime);
        timeClassName = "wish-edited-time";
      } else if (display.pending) {
        timeLabel = "設定なし";
        timeClassName = "wish-edited-time";
      }
      const cellStatusClass = isWorkerView
        ? isPublishedDate
          ? " published-date"
          : ""
        : isPendingAdjustment
          ? " pending-adjustment-date"
          : isPublishedDate
            ? " published-date"
            : "";
      cells.set(date, {
        wishCount: wishCountByDate.get(date) ?? 0,
        timeLabel,
        timeClassName,
        cellStatusClass,
      });
    }
    return cells;
  }, [
    calendarDates,
    currentUser?.id,
    currentUser?.team,
    effectiveWorkerPublishedDates,
    isWorkerView,
    knownDepartments,
    state.confirmedShifts,
    state.desiredShifts,
    state.period,
    state.staffList,
    workerPublishedDates,
  ]);

  const myWish = state.desiredShifts.find(
    (s) => s.staffId === currentUser?.id && s.date === detailDate
  );
  const selectedDateConfirmedShift = state.confirmedShifts.find(
    (s) => s.staffId === currentUser?.id && s.date === detailDate
  );

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
    detailDate,
    selectedDateConfirmedShift,
    myWish
  );

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
      .filter((s) => s.date === detailDate)
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
  }, [detailDate, state.desiredShifts, state.staffList, workers]);

  const editable = isWorkerView;
  const timeOptions = useMemo(
    () => getWorkerShiftTimeOptions(Boolean(currentUser?.socialInsurance)),
    [currentUser?.socialInsurance]
  );

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
      handleSelectCalendarDate(dateKey);
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
                    const cellData = workerCalendarCells.get(date);
                    if (!cellData) return null;
                    return (
                      <WishCalendarDayCell
                        key={date}
                        date={date}
                        weekIndex={weekIndex}
                        currentWeekIndex={currentWeekIndex}
                        selected={selectedDate === date}
                        data={cellData}
                        onSelectDate={handleSelectCalendarDate}
                      />
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
