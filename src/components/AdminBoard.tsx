"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, memo } from "react";
import { CalendarNavToolbar } from "@/components/CalendarNavToolbar";
import { Icons } from "@/components/icons";
import { useShift } from "@/components/context/ShiftContext";
import { useWorkCalendarNavigation } from "@/hooks/useWorkCalendarNavigation";
import {
  formatDateShort,
  formatWorkWeekLabel,
  getNextTwoWorkWeekMondays,
  getWorkWeekDateKeysFromMondays,
  listWorkWeekMondays,
} from "@/lib/shift/dates";
import { getStaffDisplayInitial, getStaffDisplayName } from "@/lib/shift/display";
import { buildShiftExportCsv, getShiftExportCsvFilename } from "@/lib/shift/csv";
import {
  buildDepartmentDaySummaries,
  departmentMinutesToHoursInput,
  goalBlocksFromDepartmentHours,
  getDepartmentRequiredMinutes,
  getGoalDisplayDepartments,
  getGoalBlocksForDate,
  getGoalDepartmentLabel,
} from "@/lib/shift/goal";
import { getGoalMemosForDate } from "@/lib/shift/goalMemos";
import { getShiftStatusRingColor, isAttendanceStatus } from "@/lib/shift/status";
import {
  buildGoalBlockIconDisplays,
  buildGoalBlockIconKey,
  buildInitialGoalIconFuel,
  goalDepartmentsMatch,
  resolveVariantFromFuel,
  shouldShowGoalIconInSection,
  transferGoalIconFuel,
  type GoalBlockIconKind,
} from "@/lib/shift/goalBlockIcons";
import { canOperateDepartment, getManagedDepartmentsForAdmin, listOperableDepartmentNames } from "@/lib/shift/adminDepartments";
import {
  getAdminShiftStatus,
  hasStaffPendingAdjustment,
  isAdminResubmissionPending,
  isDepartmentCalendarDatePublished,
  resolveAdminShiftDisplay,
} from "@/lib/shift/publish-state";
import { buildWeeklyStaffSummary } from "@/lib/shift/summary";
import { formatConfirmedWithDiff, formatMinutes, formatShiftSummary, formatTimeRange, normalizeDisplayTime, toMinutes } from "@/lib/shift/time";
import type { ConfirmedShift, DesiredShift, Staff } from "@/lib/shift/types";

/** 在宅用: 時間帯の円弧だけを点線で描く（終了以降は描画しない） */
function buildRemoteRingDashArray(spanPct: number): string {
  const span = Math.max(0, Math.min(1, spanPct));
  if (span <= 0) return "0 1";

  const dash = 0.03;
  const gap = 0.022;
  const parts: number[] = [];
  let covered = 0;
  let drawDash = true;

  while (covered < span - 0.0001) {
    const remaining = span - covered;
    const size = Math.min(drawDash ? dash : gap, remaining);
    parts.push(size);
    covered += size;
    drawDash = !drawDash;
  }

  const used = parts.reduce((total, value) => total + value, 0);
  const remainder = Math.max(0, 1 - used);

  // stroke-dasharray は dash/gap 交互。次が dash だと余りが線になるので 0 を挟む
  if (drawDash) {
    parts.push(0, remainder);
  } else {
    parts.push(remainder);
  }

  return parts.join(" ");
}

type CalendarIconEntry = {
  staff: Staff;
  currentStatus: ConfirmedShift["status"];
  pendingResubmission: boolean;
  iconChar: string;
  statusColor: string;
  spanPct: number;
  startPct: number;
  isRemote: boolean;
  progressDasharray: string;
  title: string;
};

function buildCalendarIconEntry(
  staff: Staff,
  currentStatus: ConfirmedShift["status"],
  shift: ReturnType<typeof resolveAdminShiftDisplay> | null,
  pendingResubmission: boolean
): CalendarIconEntry {
  const startPct = shift
    ? Math.max(0, Math.min(1, (Math.max(toMinutes(shift.startTime), 10 * 60) - 10 * 60) / (8 * 60)))
    : 0;
  const endPct = shift
    ? Math.max(0, Math.min(1, (Math.min(toMinutes(shift.endTime), 18 * 60) - 10 * 60) / (8 * 60)))
    : 0;
  const spanPct = Math.max(0, endPct - startPct);
  const isRemote = currentStatus === "remote";
  return {
    staff,
    currentStatus,
    pendingResubmission,
    iconChar: getStaffDisplayInitial(staff),
    statusColor: getShiftStatusRingColor(currentStatus),
    spanPct,
    startPct,
    isRemote,
    progressDasharray: isRemote ? buildRemoteRingDashArray(spanPct) : `${spanPct} ${1 - spanPct}`,
    title: `${getStaffDisplayName(staff)}さん${isRemote ? "（在宅）" : ""}`,
  };
}

type CalendarDayData = {
  departmentRows: Array<{
    department: string;
    entries: CalendarIconEntry[];
  }>;
  dayMemos: ReturnType<typeof getGoalMemosForDate>;
  dayRequiredNote: string;
};

const AdminCalendarDayCell = memo(function AdminCalendarDayCell({
  date,
  weekIndex,
  currentWeekIndex,
  selected,
  dayData,
  publishedByDateDept,
  onSelectDate,
  onEditRequired,
}: {
  date: string;
  weekIndex: number;
  currentWeekIndex: number;
  selected: boolean;
  dayData: CalendarDayData;
  publishedByDateDept: Map<string, boolean>;
  onSelectDate: (date: string) => void;
  onEditRequired: (date: string) => void;
}) {
  const { departmentRows, dayMemos, dayRequiredNote } = dayData;
  return (
    <div
      className={`day-cell${selected ? " selected" : ""}${weekIndex < currentWeekIndex ? " past" : ""}`}
      onClick={() => onSelectDate(date)}
    >
      <div className="day-cell-top">
        <div className="day-cell-date-line">
          <div className="day-num">{formatDateShort(date)}</div>
          {dayMemos.length > 0 ? (
            <div className="day-cell-memos">
              {dayMemos.map((memo) => (
                <span key={memo.id} className="day-cell-memo" title={memo.body}>
                  {memo.body}
                </span>
              ))}
            </div>
          ) : null}
          {dayRequiredNote ? (
            <span className="day-cell-required-note" title={dayRequiredNote}>
              {dayRequiredNote}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className="btn day-cell-edit-btn"
          aria-label="目安時間を編集"
          onClick={(e) => {
            e.stopPropagation();
            onEditRequired(date);
          }}
        >
          <Icons.Pencil size={10} strokeWidth={2.2} />
        </button>
      </div>
      <div className="day-meta day-status-strip">
        {departmentRows.map(({ department, entries }, index) => {
          const isPublished = publishedByDateDept.get(`${date}:${department}`) ?? false;
          return (
            <div
              key={department}
              className={`day-status-row department-row${isPublished ? " published" : ""}`}
              style={{ borderBottom: index < departmentRows.length - 1 ? "1px solid var(--line)" : undefined }}
            >
              <div className="day-status-row-icons">
                {entries.map((entry) => (
                  <span
                    key={entry.staff.id}
                    className={`day-status-icon-cell${entry.pendingResubmission ? " pending" : ""}`}
                  >
                    <span
                      className={`day-status-icon ${entry.currentStatus}`}
                      title={entry.title}
                    >
                      <svg className="day-status-ring" viewBox="0 0 20 20" aria-hidden="true">
                        <circle cx="10" cy="10" r="7.5" fill="none" stroke="#e5e7eb" strokeWidth="2" />
                        {entry.spanPct > 0 ? (
                          <circle
                            className="day-status-ring-progress"
                            cx="10"
                            cy="10"
                            r="7.5"
                            fill="none"
                            stroke={entry.statusColor}
                            strokeWidth={entry.isRemote ? 1.6 : 2}
                            strokeLinecap={entry.isRemote ? "butt" : "round"}
                            pathLength={1}
                            strokeDasharray={entry.progressDasharray}
                            strokeDashoffset={-entry.startPct}
                            transform="rotate(-90 10 10)"
                          />
                        ) : null}
                      </svg>
                      <span className="day-status-initial">{entry.iconChar}</span>
                    </span>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

type AdminGanttRowProps = {
  staff: Staff;
  desiredShift: DesiredShift | undefined;
  confirmedShift: ConfirmedShift | undefined;
  currentStatus: ConfirmedShift["status"];
  dragPreview: { startTime: string; endTime: string } | null;
  canOperate: boolean;
  weekConfirmedMinutes: number;
  ganttDate: string;
  onStatusChange: (
    staffId: string,
    date: string,
    nextStatus: ConfirmedShift["status"],
    desiredShift: DesiredShift | undefined,
    confirmedShift: ConfirmedShift | undefined
  ) => void;
  onDragHandleDown: (
    desiredId: string,
    edge: "start" | "end",
    track: HTMLDivElement,
    barStartTime: string,
    barEndTime: string
  ) => void;
};

const AdminGanttRow = memo(function AdminGanttRow({
  staff,
  desiredShift,
  confirmedShift,
  currentStatus,
  dragPreview,
  canOperate,
  weekConfirmedMinutes,
  ganttDate,
  onStatusChange,
  onDragHandleDown,
}: AdminGanttRowProps) {
  const editableDesired = desiredShift;
  const displayShift = resolveAdminShiftDisplay(confirmedShift, desiredShift, {
    currentStatus,
  });
  const canEditStatus = canOperate;
  const canEditTime = canOperate && currentStatus !== "unconfirmed" && Boolean(editableDesired);
  const barStartTime = dragPreview?.startTime ?? displayShift?.startTime ?? "10:00";
  const barEndTime = dragPreview?.endTime ?? displayShift?.endTime ?? "18:00";

  return (
    <div className="timeline-row timeline-row-gantt">
      <div className="timeline-worker-name">
        <select
          className={`status-select timeline-status-select ${currentStatus}`}
          value={currentStatus}
          onChange={(e) => {
            if (!canEditStatus) return;
            onStatusChange(
              staff.id,
              ganttDate,
              e.target.value as ConfirmedShift["status"],
              editableDesired,
              confirmedShift
            );
          }}
          disabled={!canEditStatus}
        >
          <option value="confirmed">出社</option>
          <option value="remote">在宅</option>
          <option value="adjusting">調整</option>
          <option value="unconfirmed">休み</option>
        </select>
        <div className="timeline-worker-meta">
          <span className="timeline-worker-name-row">
            <span>{getStaffDisplayName(staff)}</span>
            {(displayShift?.note)?.trim() ? (
              <span
                className="gantt-worker-note-alert"
                tabIndex={0}
                aria-label={`備考: ${(displayShift?.note || "").trim()}`}
              >
                <Icons.Alert size={18} strokeWidth={2.6} />
                <span className="gantt-worker-note-tooltip" role="tooltip">
                  {(displayShift?.note || "").trim()}
                </span>
              </span>
            ) : null}
          </span>
          <span className="timeline-week-hours">
            週合計 {formatMinutes(weekConfirmedMinutes)}
          </span>
        </div>
      </div>
      <div className="timeline-track timeline-track-gantt">
        <div className="timeline-grid-lines">
          {[10, 12, 14, 16, 18].map((hour) => (
            <span
              key={hour}
              className="timeline-grid-line"
              style={{ left: `${((hour - 10) / 9) * 100}%` }}
            />
          ))}
        </div>
        {displayShift ? (
          <div
            className={`gantt-bar ${currentStatus}`}
            style={{
              left: `${((Math.max(toMinutes(barStartTime), 10 * 60) - 10 * 60) / (9 * 60)) * 100}%`,
              width: `${Math.max(
                ((Math.min(toMinutes(barEndTime), 19 * 60) -
                  Math.max(toMinutes(barStartTime), 10 * 60)) /
                  (9 * 60)) *
                  100,
                4
              )}%`,
            }}
            title={`${getStaffDisplayName(staff)}さん ${formatTimeRange(barStartTime, barEndTime)}`}
          >
            {canEditTime ? (
              <>
                <span className="gantt-time-start">{" "}{normalizeDisplayTime(barStartTime)}</span>
                <span className="gantt-center-stack">
                  <span className="gantt-time-center">
                    {formatTimeRange(barStartTime, barEndTime)}
                  </span>
                  {displayShift.breakMinutes > 0 ? (
                    <span className="gantt-break">
                      <span className="gantt-break-mark">休</span>
                      <span>{formatMinutes(displayShift.breakMinutes)}</span>
                    </span>
                  ) : null}
                </span>
                <span className="gantt-time-end">{normalizeDisplayTime(barEndTime)}{" "}</span>
                <span
                  className="gantt-handle start"
                  onPointerDown={(e) => {
                    if (!editableDesired) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const track = e.currentTarget.closest(".timeline-track-gantt") as HTMLDivElement | null;
                    if (!track) return;
                    onDragHandleDown(editableDesired.id, "start", track, barStartTime, barEndTime);
                  }}
                />
                <span
                  className="gantt-handle end"
                  onPointerDown={(e) => {
                    if (!editableDesired) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const track = e.currentTarget.closest(".timeline-track-gantt") as HTMLDivElement | null;
                    if (!track) return;
                    onDragHandleDown(editableDesired.id, "end", track, barStartTime, barEndTime);
                  }}
                />
              </>
            ) : (
              <>
                <span className="gantt-time-start">{" "}{normalizeDisplayTime(displayShift.startTime)}</span>
                <span className="gantt-center-stack">
                  <span className="gantt-time-center">
                    {formatTimeRange(displayShift.startTime, displayShift.endTime)}
                  </span>
                </span>
                <span className="gantt-time-end">{normalizeDisplayTime(displayShift.endTime)}{" "}</span>
              </>
            )}
          </div>
        ) : (
          <div style={{ minHeight: 24 }} />
        )}
      </div>
    </div>
  );
});

export function AdminBoard() {
  const {
    state,
    isAdmin,
    currentUser,
    workers,
    setDesiredShiftStatus,
    setStaffDayStatus,
    updateDesiredShiftTimes,
    updateConfirmedShift,
    publishConfirmed,
    flushShiftPersist,
    beginShiftDrag,
    endShiftDrag,
    upsertRequired,
    setGoalBlocksForDate,
  } = useShift();

  const {
    todayKey,
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
    handleJumpBackTwoMonths,
    navigateToDate,
  } = useWorkCalendarNavigation();
  const [viewMode, setViewMode] = useState<"calendar" | "day" | "workers">("day");
  const statusRank = (status: ConfirmedShift["status"]) =>
    isAttendanceStatus(status) ? 0 : status === "adjusting" ? 1 : 2;
  const resolveShiftStatus = (
    confirmedShift: ConfirmedShift | undefined,
    desiredShift: (typeof state.desiredShifts)[number] | undefined,
    date: string
  ) => getAdminShiftStatus(confirmedShift, desiredShift);
  const isResubmissionPending = (
    confirmedShift: ConfirmedShift | undefined,
    desiredShift: (typeof state.desiredShifts)[number] | undefined
  ) => isAdminResubmissionPending(confirmedShift, desiredShift);
  const [selectedDate, setSelectedDate] = useState(defaultSelectedDateKey);
  const ganttDate = useDeferredValue(selectedDate);
  const handleSelectCalendarDate = useCallback((date: string) => {
    setSelectedDate(date);
    setViewMode("day");
  }, []);
  const [selectedWorkerId, setSelectedWorkerId] = useState(state.staffList.find((s) => s.role === "worker")?.id ?? "");
  const [selectedWeekIndex, setSelectedWeekIndex] = useState(0);
  const [requiredEditor, setRequiredEditor] = useState<{
    date: string;
    departmentHours: Record<string, string>;
    note: string;
  } | null>(null);
  const [publishModalDepartment, setPublishModalDepartment] = useState<string | null>(null);
  const [csvExportOpen, setCsvExportOpen] = useState(false);
  const [csvDepartments, setCsvDepartments] = useState<string[]>([]);
  const [csvWeekMondays, setCsvWeekMondays] = useState<string[]>([]);
  const [goalIconFuel, setGoalIconFuel] = useState<Record<string, number>>({});
  const [draggingHeartKey, setDraggingHeartKey] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const dragRef = useRef<{
    desiredId: string;
    edge: "start" | "end";
    rect: DOMRect;
    baseStart: number;
    baseEnd: number;
  } | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const pendingGanttPreviewRef = useRef<{ desiredId: string; startTime: string; endTime: string } | null>(
    null
  );
  const [ganttDragPreview, setGanttDragPreview] = useState<{
    desiredId: string;
    startTime: string;
    endTime: string;
  } | null>(null);
  useEffect(() => {
    const matchIndex = weekGroups.findIndex((group) => group.includes(selectedDate));
    setSelectedWeekIndex(matchIndex >= 0 ? matchIndex : 0);
  }, [selectedDate, weekGroups]);
  useEffect(() => {
    if (selectedWorkerId && state.staffList.some((staff) => staff.id === selectedWorkerId)) {
      return;
    }
    const firstWorker = state.staffList.find((staff) => staff.role === "worker");
    if (firstWorker) {
      setSelectedWorkerId(firstWorker.id);
    }
  }, [selectedWorkerId, state.staffList]);

  const activeWorkers = state.staffList.filter((s) => s.role === "worker" && s.status === "active");
  const shiftsForGanttDate = useMemo(() => {
    const desired = new Map<string, DesiredShift>();
    const confirmed = new Map<string, ConfirmedShift>();
    for (const shift of state.desiredShifts) {
      if (shift.date === ganttDate) desired.set(shift.staffId, shift);
    }
    for (const shift of state.confirmedShifts) {
      if (shift.date === ganttDate) confirmed.set(shift.staffId, shift);
    }
    return { desired, confirmed };
  }, [ganttDate, state.confirmedShifts, state.desiredShifts]);
  const dailyRoster = useMemo(
    () =>
      activeWorkers
        .map((staff) => {
          const desiredShift = shiftsForGanttDate.desired.get(staff.id);
          const confirmedShift = shiftsForGanttDate.confirmed.get(staff.id);
          const currentStatus = getAdminShiftStatus(confirmedShift, desiredShift);
          return { staff, desiredShift, confirmedShift, currentStatus };
        })
        .sort((a, b) => {
          const statusDiff = statusRank(a.currentStatus) - statusRank(b.currentStatus);
          if (statusDiff !== 0) return statusDiff;
          return getStaffDisplayName(a.staff).localeCompare(getStaffDisplayName(b.staff));
        }),
    [activeWorkers, shiftsForGanttDate]
  );


  const timelineMarks = [
    { label: "10:00", hour: 10 },
    { label: "12:00", hour: 12 },
    { label: "14:00", hour: 14 },
    { label: "16:00", hour: 16 },
    { label: "18:00", hour: 18 },
  ];

  const required = state.requiredShifts.find((s) => s.date === ganttDate);
  const weeklySummaries = useMemo(
    () =>
      viewMode === "workers"
        ? buildWeeklyStaffSummary(state.staffList, state.desiredShifts, state.confirmedShifts)
        : [],
    [viewMode, state.staffList, state.desiredShifts, state.confirmedShifts]
  );
  const selectedWeekDates = weekGroups[selectedWeekIndex] ?? [];
  const weeklyViewDesired = useMemo(
    () => state.desiredShifts.filter((shift) => selectedWeekDates.includes(shift.date)),
    [selectedWeekDates, state.desiredShifts]
  );
  const weeklyViewConfirmed = useMemo(
    () => state.confirmedShifts.filter((shift) => selectedWeekDates.includes(shift.date) && Boolean(shift.publishedAt)),
    [selectedWeekDates, state.confirmedShifts]
  );
  const selectedWeekSummaries = useMemo(
    () => buildWeeklyStaffSummary(state.staffList, weeklyViewDesired, weeklyViewConfirmed),
    [state.staffList, weeklyViewConfirmed, weeklyViewDesired]
  );
  const selectedWeekTitle = selectedWeekDates[0]
    ? `${formatDateShort(selectedWeekDates[0])}～${formatDateShort(selectedWeekDates[selectedWeekDates.length - 1])}`
    : "";
  const selectedWeekLabel = selectedWeekTitle;
  const selectedWeekSummaryMap = useMemo(
    () => new Map(selectedWeekSummaries.map((summary) => [summary.staffId, summary])),
    [selectedWeekSummaries]
  );
  const selectedGoalBlocks = useMemo(
    () => getGoalBlocksForDate(state, ganttDate),
    [state.goalBlocksByDate, ganttDate]
  );
  const goalBlockIconDisplays = useMemo(
    () =>
      buildGoalBlockIconDisplays({
        date: ganttDate,
        goalBlocks: selectedGoalBlocks,
        staffList: state.staffList,
        desiredShifts: state.desiredShifts,
        confirmedShifts: state.confirmedShifts,
      }),
    [ganttDate, selectedGoalBlocks, state.confirmedShifts, state.desiredShifts, state.staffList]
  );
  const initialGoalIconFuel = useMemo(
    () => buildInitialGoalIconFuel(ganttDate, goalBlockIconDisplays),
    [ganttDate, goalBlockIconDisplays]
  );

  useEffect(() => {
    setGoalIconFuel(initialGoalIconFuel);
    setDraggingHeartKey(null);
    setDropTargetKey(null);
  }, [initialGoalIconFuel]);

  const goalIconKindByKey = useMemo(() => {
    const kinds: Record<string, GoalBlockIconKind> = {};
    goalBlockIconDisplays.forEach((block, blockIndex) => {
      block.forEach((icon, slotIndex) => {
        kinds[buildGoalBlockIconKey(ganttDate, blockIndex, slotIndex, icon.department)] = icon.kind;
      });
    });
    return kinds;
  }, [goalBlockIconDisplays, ganttDate]);

  const findGoalIconByKey = (iconKey: string) => {
    for (let blockIndex = 0; blockIndex < goalBlockIconDisplays.length; blockIndex += 1) {
      const block = goalBlockIconDisplays[blockIndex];
      for (let slotIndex = 0; slotIndex < block.length; slotIndex += 1) {
        const icon = block[slotIndex];
        if (buildGoalBlockIconKey(ganttDate, blockIndex, slotIndex, icon.department) === iconKey) {
          return icon;
        }
      }
    }
    return null;
  };

  const handleGoalIconDrop = (heartKey: string, shortageKey: string) => {
    const heartIcon = findGoalIconByKey(heartKey);
    const shortageIcon = findGoalIconByKey(shortageKey);
    if (!heartIcon || !shortageIcon) return;
    if (heartIcon.kind !== "excess" || shortageIcon.kind !== "shortage") return;
    if (!goalDepartmentsMatch(heartIcon.department, shortageIcon.department)) return;

    setGoalIconFuel((prev) => {
      const next = transferGoalIconFuel({
        fuelByKey: prev,
        kindByKey: goalIconKindByKey,
        heartKey,
        shortageKey,
      });
      return next ?? prev;
    });
    setDraggingHeartKey(null);
    setDropTargetKey(null);
  };

  // 全部署を表示（本部除く）。編集・確定は managedTeams のみ
  const masterDepartments = useMemo(
    () => listOperableDepartmentNames(state.departments),
    [state.departments]
  );

  const operableDepartments = useMemo(
    () => getManagedDepartmentsForAdmin(currentUser, masterDepartments),
    [currentUser, masterDepartments]
  );

  const operableDepartmentSet = useMemo(() => new Set(operableDepartments), [operableDepartments]);

  const calendarDates = useMemo(() => weekGroups.flat(), [weekGroups]);
  const calendarDayData = useMemo(() => {
    const desiredByKey = new Map<string, (typeof state.desiredShifts)[number]>();
    const confirmedByKey = new Map<string, (typeof state.confirmedShifts)[number]>();
    for (const shift of state.desiredShifts) {
      desiredByKey.set(`${shift.date}:${shift.staffId}`, shift);
    }
    for (const shift of state.confirmedShifts) {
      confirmedByKey.set(`${shift.date}:${shift.staffId}`, shift);
    }

    const requiredNoteByDate = new Map<string, string>();
    for (const shift of state.requiredShifts) {
      const note = shift.note?.trim();
      if (note) requiredNoteByDate.set(shift.date, note);
    }

    const departmentNames = getGoalDisplayDepartments(masterDepartments);
    const knownDepartments = new Set(departmentNames);
    const publishedByDateDept = new Map<string, boolean>();
    const days = new Map<string, CalendarDayData>();

    for (const date of calendarDates) {
      const dayRoster = activeWorkers
        .map((staff) => {
          const desiredShift = desiredByKey.get(`${date}:${staff.id}`);
          const confirmedShift = confirmedByKey.get(`${date}:${staff.id}`);
          const currentStatus = getAdminShiftStatus(confirmedShift, desiredShift);
          const pendingResubmission = isAdminResubmissionPending(confirmedShift, desiredShift);
          const shift = resolveAdminShiftDisplay(confirmedShift, desiredShift, { currentStatus }) ?? null;
          return { staff, currentStatus, shift, pendingResubmission };
        })
        .sort((a, b) => getStaffDisplayName(a.staff).localeCompare(getStaffDisplayName(b.staff)));

      const mapEntries = (
        rows: typeof dayRoster
      ): CalendarIconEntry[] =>
        rows.map(({ staff, currentStatus, shift, pendingResubmission }) =>
          buildCalendarIconEntry(staff, currentStatus, shift, pendingResubmission)
        );

      const departmentRows = [
        ...departmentNames.map((department) => ({
          department,
          entries: mapEntries(dayRoster.filter(({ staff }) => staff.team === department)),
        })),
        ...(dayRoster.some(({ staff }) => !knownDepartments.has(staff.team))
          ? [
              {
                department: "未設定",
                entries: mapEntries(dayRoster.filter(({ staff }) => !knownDepartments.has(staff.team))),
              },
            ]
          : []),
      ];

      for (const department of departmentNames) {
        publishedByDateDept.set(
          `${date}:${department}`,
          isDepartmentCalendarDatePublished(
            date,
            department,
            state.period,
            state.staffList,
            state.confirmedShifts,
            { knownDepartments }
          )
        );
      }
      if (dayRoster.some(({ staff }) => !knownDepartments.has(staff.team))) {
        publishedByDateDept.set(
          `${date}:未設定`,
          isDepartmentCalendarDatePublished(
            date,
            "未設定",
            state.period,
            state.staffList,
            state.confirmedShifts,
            { knownDepartments }
          )
        );
      }

      days.set(date, {
        departmentRows,
        dayMemos: getGoalMemosForDate(state.goalMemos, date),
        dayRequiredNote: requiredNoteByDate.get(date) ?? "",
      });
    }

    return { days, publishedByDateDept };
  }, [
    activeWorkers,
    calendarDates,
    masterDepartments,
    state.confirmedShifts,
    state.desiredShifts,
    state.goalMemos,
    state.period,
    state.requiredShifts,
    state.staffList,
  ]);

  const csvDepartmentOptions = useMemo(
    () => getGoalDisplayDepartments(masterDepartments),
    [masterDepartments]
  );

  const csvWeekOptions = useMemo(() => listWorkWeekMondays({ pastWeeks: 2, futureWeeks: 8 }), []);

  function openCsvExportModal() {
    setCsvWeekMondays(getNextTwoWorkWeekMondays());
    setCsvDepartments(csvDepartmentOptions);
    setCsvExportOpen(true);
  }

  function toggleCsvDepartment(department: string) {
    setCsvDepartments((prev) =>
      prev.includes(department) ? prev.filter((d) => d !== department) : [...prev, department]
    );
  }

  function toggleCsvWeek(monday: string) {
    setCsvWeekMondays((prev) =>
      prev.includes(monday) ? prev.filter((d) => d !== monday) : [...prev, monday].sort()
    );
  }

  function applyCsvNextTwoWeeks() {
    setCsvWeekMondays(getNextTwoWorkWeekMondays());
  }

  const csvDateKeys = useMemo(() => getWorkWeekDateKeysFromMondays(csvWeekMondays), [csvWeekMondays]);

  function handleExportCsv() {
    if (csvDateKeys.length === 0 || csvDepartments.length === 0) return;
    const csv = buildShiftExportCsv({
      shifts: state.confirmedShifts,
      staffList: state.staffList,
      dateKeys: csvDateKeys,
      departments: csvDepartments,
    });
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = getShiftExportCsvFilename(csvDateKeys[0], csvDepartments);
    link.click();
    URL.revokeObjectURL(url);
    setCsvExportOpen(false);
  }

  const departmentPublishGroups = useMemo(
    () =>
      masterDepartments.map((department) => {
        const summaries = selectedWeekSummaries.filter(
          (summary) => state.staffList.find((staff) => staff.id === summary.staffId)?.team === department
        );
        const issues = selectedWeekDates.flatMap((date) =>
          activeWorkers.flatMap((staff) => {
            if (staff.team !== department) return [];
            const desiredShift = state.desiredShifts.find(
              (shift) => shift.date === date && shift.staffId === staff.id
            );
            const confirmedShift = state.confirmedShifts.find(
              (shift) => shift.date === date && shift.staffId === staff.id
            );
            const currentStatus = resolveShiftStatus(confirmedShift, desiredShift, date);
            return currentStatus === "adjusting"
              ? [{ date, name: getStaffDisplayName(staff) }]
              : [];
          })
        );
        return { department, issues, summaries };
      }),
    [activeWorkers, masterDepartments, selectedWeekDates, selectedWeekSummaries, state.confirmedShifts, state.desiredShifts, state.staffList]
  );
  async function handlePublishDepartment(department: string) {
    if (!selectedWeekDates[0]) return;
    if (!canOperateDepartment(currentUser, department, masterDepartments)) return;
    publishConfirmed("week", selectedWeekDates[0], department);
    const result = await flushShiftPersist();
    if (!result.ok) {
      window.alert(`確定の保存に失敗しました: ${result.message}`);
      return;
    }
    setPublishModalDepartment(null);
  }

  function renderShiftConfirmContent(
    department: string,
    issues: { date: string; name: string }[],
    summaries: ReturnType<typeof buildWeeklyStaffSummary>,
    options?: { showDepartment?: boolean; showIssueStatus?: boolean }
  ) {
    const canPublish = issues.length === 0;
    const showDepartment = options?.showDepartment ?? false;
    const showIssueStatus = options?.showIssueStatus ?? false;
    return (
      <>
        <div className="department-section-subhead">
          <strong>シフト確定</strong>
          <span className="muted">{selectedWeekLabel}</span>
        </div>
        {showDepartment ? (
          <p className="muted publish-confirm-department" style={{ margin: 0 }}>
            {department}
          </p>
        ) : null}
        {showIssueStatus ? (
          canPublish ? (
            <p className="muted" style={{ margin: 0 }}>
              調整中なし
            </p>
          ) : (
            <div className="list">
              {issues.map((issue) => (
                <div key={`${department}-${issue.date}-${issue.name}`} className="list-item">
                  <span>{formatDateShort(issue.date)}</span>
                  <span>{issue.name}</span>
                </div>
              ))}
            </div>
          )
        ) : null}
        {summaries.length > 0 ? (
          <div className="week-summary-table">
            <div className="week-summary-head">
              <span>氏名</span>
              <span>月</span>
              <span>火</span>
              <span>水</span>
              <span>木</span>
              <span>金</span>
              <span>確定</span>
            </div>
            {summaries.map((summary) => {
              const staff = state.staffList.find((s) => s.id === summary.staffId);
              const weekCells = selectedWeekDates.map((date) => {
                const confirmedShift = state.confirmedShifts.find(
                  (shift) => shift.staffId === summary.staffId && shift.date === date
                );
                const desiredShift = state.desiredShifts.find(
                  (shift) => shift.staffId === summary.staffId && shift.date === date
                );
                const currentStatus = resolveShiftStatus(confirmedShift, desiredShift, date);
                const cellShift = resolveAdminShiftDisplay(confirmedShift, desiredShift, { currentStatus });
                if (!cellShift || currentStatus === "unconfirmed") {
                  return { value: "0", isAdjusting: false };
                }
                return {
                  value: formatMinutes(cellShift.actualMinutes).replace(/h$/, ""),
                  isAdjusting: currentStatus === "adjusting",
                };
              });
              return (
                <div key={summary.staffId} className="week-summary-row">
                  <strong>{getStaffDisplayName(staff)}</strong>
                  {weekCells.map((cell, index) => (
                    <span
                      key={`${summary.staffId}-${selectedWeekDates[index]}`}
                      className={`week-summary-cell${cell.isAdjusting ? " adjusting" : ""}`}
                      {...(cell.isAdjusting
                        ? {
                            role: "button" as const,
                            tabIndex: 0,
                            onClick: () => handleSelectDateFromSummary(selectedWeekDates[index]),
                            onKeyDown: (e: React.KeyboardEvent) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleSelectDateFromSummary(selectedWeekDates[index]);
                              }
                            },
                          }
                        : {})}
                    >
                      {cell.value}
                    </span>
                  ))}
                  <span>{formatMinutes(summary.confirmedMinutes).replace(/h$/, "")}</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </>
    );
  }
  const ganttDepartmentGroups = useMemo(() => {
    const departments = getGoalDisplayDepartments(masterDepartments);
    const groups = departments.map((department) => ({
      department,
      entries: dailyRoster.filter(({ staff }) => staff.team === department),
    }));
    const knownTeams = new Set(departments);
    const unmatched = dailyRoster.filter(({ staff }) => !knownTeams.has(staff.team));
    if (unmatched.length > 0) {
      groups.push({ department: "未設定", entries: unmatched });
    }
    return groups.filter((group) => group.entries.length > 0);
  }, [dailyRoster, masterDepartments]);
  const departmentSections = useMemo(() => {
    const ganttMap = new Map(ganttDepartmentGroups.map(({ department, entries }) => [department, entries]));
    const publishMap = new Map(
      departmentPublishGroups.map(({ department, issues, summaries }) => [department, { issues, summaries }])
    );
    const orderedDepartments = getGoalDisplayDepartments(masterDepartments);

    return orderedDepartments.map((department) => ({
      department,
      entries: ganttMap.get(department) ?? [],
      issues: publishMap.get(department)?.issues ?? [],
      summaries: publishMap.get(department)?.summaries ?? [],
    }));
  }, [departmentPublishGroups, ganttDepartmentGroups, masterDepartments]);
  const publishModalSection = publishModalDepartment
    ? departmentSections.find((section) => section.department === publishModalDepartment)
    : null;
  const departmentDaySummaries = useMemo(
    () => {
      const requiredByDepartment = getDepartmentRequiredMinutes(selectedGoalBlocks);
      return buildDepartmentDaySummaries({
        date: ganttDate,
        departments: masterDepartments,
        goalBlocks: selectedGoalBlocks,
        staffList: state.staffList,
        desiredShifts: state.desiredShifts,
        confirmedShifts: state.confirmedShifts,
        requiredByDepartment,
      });
    },
    [masterDepartments, ganttDate, selectedGoalBlocks, state.confirmedShifts, state.desiredShifts, state.staffList]
  );
  const handleEditRequiredHours = useCallback(
    (date: string) => {
      const departments = getGoalDisplayDepartments(masterDepartments);
      const goalBlocks = getGoalBlocksForDate(state, date);
      const requiredByDepartment = getDepartmentRequiredMinutes(goalBlocks);
      const departmentHours = Object.fromEntries(
        departments.map((department) => [
          department,
          departmentMinutesToHoursInput(requiredByDepartment[department] ?? 0),
        ])
      );
      const saved = state.requiredShifts.find((s) => s.date === date);
      const memoText = getGoalMemosForDate(state.goalMemos, date)
        .map((memo) => memo.body.trim())
        .filter(Boolean)
        .join("\n");
      setRequiredEditor({
        date,
        departmentHours,
        note: saved?.note?.trim() ? saved.note : memoText,
      });
    },
    [masterDepartments, state]
  );
  const formatDateWithWeekday = (date: string) => {
    const d = new Date(`${date}T00:00:00+09:00`);
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    return `${d.getMonth() + 1}/${d.getDate()}（${weekdays[d.getDay()]}）`;
  };
  const minuteToTime = (minutes: number) => {
    const hour = Math.floor(minutes / 60);
    const min = minutes % 60;
    return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  };

  const handleGanttRowStatusChange = useCallback(
    (
      staffId: string,
      date: string,
      nextStatus: ConfirmedShift["status"],
      desiredShift: DesiredShift | undefined,
      confirmedShift: ConfirmedShift | undefined
    ) => {
      if (desiredShift) {
        setDesiredShiftStatus(desiredShift.id, nextStatus);
        return;
      }
      if (confirmedShift) {
        updateConfirmedShift(confirmedShift.id, { status: nextStatus });
        return;
      }
      setStaffDayStatus(staffId, date, nextStatus);
    },
    [setDesiredShiftStatus, setStaffDayStatus, updateConfirmedShift]
  );

  const handleGanttDragHandleDown = useCallback(
    (
      desiredId: string,
      edge: "start" | "end",
      track: HTMLDivElement,
      barStartTime: string,
      barEndTime: string
    ) => {
      beginShiftDrag();
      setGanttDragPreview(null);
      pendingGanttPreviewRef.current = null;
      dragRef.current = {
        desiredId,
        edge,
        rect: track.getBoundingClientRect(),
        baseStart: toMinutes(barStartTime),
        baseEnd: toMinutes(barEndTime),
      };
    },
    [beginShiftDrag]
  );

  useEffect(() => {
    const flushPendingGanttPreview = () => {
      dragFrameRef.current = null;
      const pending = pendingGanttPreviewRef.current;
      if (!pending) return;
      setGanttDragPreview(pending);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const { desiredId, edge, rect, baseStart, baseEnd } = drag;
      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const snapped = 15 * Math.round((10 * 60 + ratio * 9 * 60) / 15);
      if (edge === "start") {
        const nextStart = Math.min(snapped, baseEnd - 15);
        pendingGanttPreviewRef.current = {
          desiredId,
          startTime: minuteToTime(nextStart),
          endTime: minuteToTime(baseEnd),
        };
      } else {
        const nextEnd = Math.max(snapped, baseStart + 15);
        pendingGanttPreviewRef.current = {
          desiredId,
          startTime: minuteToTime(baseStart),
          endTime: minuteToTime(nextEnd),
        };
      }
      if (dragFrameRef.current !== null) return;
      dragFrameRef.current = window.requestAnimationFrame(flushPendingGanttPreview);
    };

    const handlePointerUp = () => {
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current);
        flushPendingGanttPreview();
      }
      const preview = pendingGanttPreviewRef.current;
      if (dragRef.current && preview) {
        updateDesiredShiftTimes(preview.desiredId, preview.startTime, preview.endTime);
      }
      if (dragRef.current) {
        endShiftDrag();
        void flushShiftPersist();
      }
      dragRef.current = null;
      pendingGanttPreviewRef.current = null;
      setGanttDragPreview(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current);
      }
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [updateDesiredShiftTimes, flushShiftPersist, endShiftDrag]);

  const handleSaveRequired = () => {
    if (!requiredEditor) return;
    const departmentHours: Record<string, number> = {};
    for (const [department, hoursText] of Object.entries(requiredEditor.departmentHours)) {
      const hours = Number(hoursText);
      if (Number.isFinite(hours) && hours >= 0) {
        departmentHours[department] = hours;
      }
    }
    const nextGoalBlocks = goalBlocksFromDepartmentHours(departmentHours, masterDepartments);
    setGoalBlocksForDate(requiredEditor.date, nextGoalBlocks);
    upsertRequired(requiredEditor.date, requiredEditor.note);
    setRequiredEditor(null);
  };

  const handleGoToday = () => {
    goToTodayWeek((dateKey) => {
      setSelectedDate(dateKey);
      setViewMode("day");
    });
  };

  const handleSelectDateFromSummary = (dateKey: string) => {
    setSelectedDate(dateKey);
    setViewMode("day");
    setPublishModalDepartment(null);
    navigateToDate(dateKey);
    requestAnimationFrame(() => {
      calendarScrollRef.current?.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  if (!isAdmin) {
    return (
      <section className="panel">
        <h1>シフト調整</h1>
        <p>管理者ユーザーに切り替えてください。</p>
      </section>
    );
  }

  const calendarPanel = (
      <div className="stack">
        <div className="actions admin-board-header" style={{ justifyContent: "space-between", marginTop: 0 }}>
          <h2 className="page-title-with-icon" style={{ margin: 0 }}>
            <Icons.Shift size={22} className="page-title-icon" />
            シフト調整
          </h2>
          <div className="actions" style={{ marginTop: 0 }}>
            <Link href="/admin/goal" className="btn">
              <Icons.Settings size={16} className="btn-icon" />
              目安設定
            </Link>
            <button type="button" className="btn primary btn-action-green" onClick={openCsvExportModal}>
              <Icons.Download size={16} className="btn-icon" />
              CSV出力
            </button>
          </div>
        </div>
        <div className="grid-2 board-grid-narrow">
        <section className="panel">
          <div className="calendar-scroll admin-calendar" ref={calendarScrollRef}>
            <div className="calendar-header-sticky">
              <CalendarNavToolbar
                calendarMonth={calendarMonth}
                monthPickerOpen={monthPickerOpen}
                setMonthPickerOpen={setMonthPickerOpen}
                onGoToday={handleGoToday}
                onSelectMonth={handleSelectMonth}
                onChangeYear={handleChangeYear}
                onJumpBackTwoMonths={handleJumpBackTwoMonths}
              />
            <div className="calendar calendar-weekday-header work-calendar-with-weeks">
              {["月", "火", "水", "木", "金"].map((label) => (
                <div key={label} className="calendar-head">
                  {label}
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
                    const dayData = calendarDayData.days.get(date);
                    if (!dayData) return null;
                    return (
                      <AdminCalendarDayCell
                        key={date}
                        date={date}
                        weekIndex={weekIndex}
                        currentWeekIndex={currentWeekIndex}
                        selected={selectedDate === date}
                        dayData={dayData}
                        publishedByDateDept={calendarDayData.publishedByDateDept}
                        onSelectDate={handleSelectCalendarDate}
                        onEditRequired={handleEditRequiredHours}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </section>
        </div>
      </div>
    );

  const csvExportModal = csvExportOpen ? (
    <div className="modal-backdrop" onClick={() => setCsvExportOpen(false)}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>CSV出力</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          週（月〜金）と所属を選んで、確定シフトを出力します。
        </p>
        <div className="csv-week-section">
          <div className="csv-week-section-head">
            <span className="csv-section-label">対象週</span>
            <button type="button" className="btn ghost-sm csv-period-preset" onClick={applyCsvNextTwoWeeks}>
              来週から2週間
            </button>
          </div>
          <div className="csv-week-checklist">
            <label className="csv-dept-check">
              <input
                type="checkbox"
                checked={csvWeekOptions.length > 0 && csvWeekMondays.length === csvWeekOptions.length}
                onChange={(e) => setCsvWeekMondays(e.target.checked ? csvWeekOptions : [])}
              />
              <span>すべて選択</span>
            </label>
            {csvWeekOptions.map((monday) => (
              <label key={monday} className="csv-dept-check">
                <input
                  type="checkbox"
                  checked={csvWeekMondays.includes(monday)}
                  onChange={() => toggleCsvWeek(monday)}
                />
                <span>{formatWorkWeekLabel(monday)}</span>
              </label>
            ))}
          </div>
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
            {csvWeekMondays.length > 0
              ? `選択中: ${csvWeekMondays.map(formatWorkWeekLabel).join("、")}（${csvDateKeys.length}日）`
              : "週を選択してください"}
          </p>
        </div>
        <div className="csv-section-label" style={{ marginTop: 12 }}>
          所属
        </div>
        <div className="csv-dept-checklist">
          <label className="csv-dept-check">
            <input
              type="checkbox"
              checked={csvDepartmentOptions.length > 0 && csvDepartments.length === csvDepartmentOptions.length}
              onChange={(e) => setCsvDepartments(e.target.checked ? csvDepartmentOptions : [])}
            />
            <span>すべて選択</span>
          </label>
          {csvDepartmentOptions.map((department) => (
            <label key={department} className="csv-dept-check">
              <input
                type="checkbox"
                checked={csvDepartments.includes(department)}
                onChange={() => toggleCsvDepartment(department)}
              />
              <span>{department}</span>
            </label>
          ))}
        </div>
        <p className="muted" style={{ marginBottom: 0, fontSize: 12 }}>
          形式: 氏名,Googleアドレス,日付,開始時間,終了時間,備考
        </p>
        <div className="actions" style={{ justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn primary"
            onClick={handleExportCsv}
            disabled={csvDepartments.length === 0 || csvDateKeys.length === 0}
          >
            出力
          </button>
          <button type="button" className="btn" onClick={() => setCsvExportOpen(false)}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (viewMode === "calendar") {
    return (
      <div className="admin-board-page">
        {calendarPanel}
        {csvExportModal}
      </div>
    );
  }

  if (viewMode === "workers") {
    const selectedSummary = weeklySummaries.find((summary) => summary.staffId === selectedWorkerId);
    const selectedStaff = state.staffList.find((staff) => staff.id === selectedWorkerId);
    return (
      <div className="admin-board-page">
      <div className="stack">
        <section className="panel">
          <div className="actions" style={{ marginTop: 0 }}>
            <button type="button" className="btn" onClick={() => setViewMode("calendar")}>
              カレンダーへ戻る
            </button>
          </div>
        </section>
        <section className="panel">
          <h2 style={{ marginTop: 0 }}>{getStaffDisplayName(selectedStaff)}さん</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="person-icon" style={{ width: 30, height: 30 }}>
              {getStaffDisplayInitial(selectedStaff)}
            </span>
            <strong>{formatMinutes((selectedSummary?.desiredMinutes ?? 0) + (selectedSummary?.confirmedMinutes ?? 0))}</strong>
          </div>
        </section>
      </div>
      </div>
    );
  }

  return (
    <div className="admin-board-page">
    <div className="stack">
      {calendarPanel}
      <section className="panel stack">
        <div className="gantt-headline">
          <h2 className="page-title-with-icon" style={{ marginTop: 0 }}>
            <Icons.Calendar size={18} className="page-title-icon" />
            {formatDateWithWeekday(ganttDate)}
          </h2>
          <div className="stack" style={{ gap: 4 }}>
            <div className="gantt-headline-departments">
              {departmentDaySummaries.map(({ department, requiredMinutes, displayLabel, displayMinutes }) => (
                <div key={department} className="gantt-headline-department" title={department}>
                  <span className="person-icon goal-person-icon">
                    {getGoalDepartmentLabel(department)}
                  </span>
                  <div className="gantt-headline-department-table">
                    <div className="gantt-headline-department-col">
                      <span className="gantt-headline-department-label">必要</span>
                      <span className="gantt-headline-department-value">{formatMinutes(requiredMinutes)}</span>
                    </div>
                    <div className="gantt-headline-department-col">
                      <span className="gantt-headline-department-label">{displayLabel}</span>
                      <strong
                        className={`gantt-headline-department-value${displayMinutes < requiredMinutes ? " shortage" : ""}`}
                      >
                        {formatConfirmedWithDiff(requiredMinutes, displayMinutes)}
                      </strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {required?.note ? (
              <span className="gantt-headline-note">備考: {required.note}</span>
            ) : null}
          </div>
        </div>
      </section>

      <div className={`department-sections-grid${ganttDate !== selectedDate ? " gantt-loading" : ""}`}>
        {departmentSections.length === 0 ? (
          <section className="panel stack">
            <p style={{ margin: 0 }}>表示する所属がありません。</p>
          </section>
        ) : (
          departmentSections.map(({ department, entries, issues, summaries }) => {
            const canOperate = operableDepartmentSet.has(department);
            return (
            <section
              key={department}
              className={`department-section-card${canOperate ? "" : " department-section-readonly"}`}
            >
              <div className="department-section-header">
                <div className="department-section-title-text">
                  <strong>{department}</strong>
                  <span className="muted">{formatDateWithWeekday(ganttDate)}</span>
                  {!canOperate ? <span className="badge">閲覧のみ</span> : null}
                </div>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => setPublishModalDepartment(department)}
                  disabled={!canOperate || issues.length > 0}
                  title={!canOperate ? "この所属の確定権限がありません" : undefined}
                >
                  確定
                </button>
              </div>

              <div className="department-section-body">
                <div className="department-section-pane department-section-column-gantt">
                  <div className="day-timeline">
                    <div className="timeline-header">
                      <div className="timeline-corner" />
                      <div className="timeline-axis">
                        {timelineMarks.map((mark) => (
                          <span
                            key={mark.label}
                            className="timeline-axis-label"
                            style={{ left: `${((mark.hour - 10) / 9) * 100}%` }}
                          >
                            <span>{mark.label}</span>
                            <span className="timeline-axis-tick" />
                          </span>
                        ))}
                        {timelineMarks.slice(0, -1).map((mark, index) => (
                          <span
                            key={`icons-${mark.label}`}
                            className="timeline-axis-icons-slot"
                            style={{
                              left: `${(((mark.hour + timelineMarks[index + 1].hour) / 2 - 10) / 9) * 100}%`,
                            }}
                          >
                            {goalBlockIconDisplays[index]
                              .map((icon, slotIndex) => ({ icon, slotIndex }))
                              .filter(({ icon }) =>
                                shouldShowGoalIconInSection(icon.department, icon.kind, department)
                              )
                              .map(({ icon, slotIndex }) => {
                                const iconKey = buildGoalBlockIconKey(
                                  ganttDate,
                                  index,
                                  slotIndex,
                                  icon.department
                                );
                                const fuelMinutes = goalIconFuel[iconKey] ?? icon.fuelMinutes;
                                const variant = resolveVariantFromFuel(icon.kind, fuelMinutes);
                                if (variant === "hidden" || fuelMinutes <= 0) return null;

                                const isHeart = icon.kind === "excess";
                                const canDragIcon = canOperate && isHeart;
                                const isDropTarget =
                                  canOperate &&
                                  dropTargetKey === iconKey &&
                                  icon.kind === "shortage" &&
                                  Boolean(draggingHeartKey);
                                const fuelLabel =
                                  icon.kind === "excess"
                                    ? `余り${fuelMinutes}分`
                                    : `不足${fuelMinutes}分`;

                                return (
                                  <span
                                    key={iconKey}
                                    draggable={canDragIcon}
                                    className={[
                                      "person-icon",
                                      "goal-person-icon",
                                      `goal-person-icon-${variant}`,
                                      canDragIcon ? "goal-person-icon-draggable" : "",
                                      canDragIcon && draggingHeartKey === iconKey
                                        ? "goal-person-icon-dragging"
                                        : "",
                                      isDropTarget ? "goal-person-icon-drop-target" : "",
                                    ]
                                      .filter(Boolean)
                                      .join(" ")}
                                    title={`${icon.department} ${fuelLabel}`}
                                    onDragStart={(e) => {
                                      if (!canDragIcon || fuelMinutes <= 0) {
                                        e.preventDefault();
                                        return;
                                      }
                                      e.dataTransfer.setData("text/plain", iconKey);
                                      e.dataTransfer.effectAllowed = "move";
                                      setDraggingHeartKey(iconKey);
                                    }}
                                    onDragEnd={() => {
                                      setDraggingHeartKey(null);
                                      setDropTargetKey(null);
                                    }}
                                    onDragOver={(e) => {
                                      if (!canOperate || icon.kind !== "shortage" || !draggingHeartKey) return;
                                      const heartIcon = findGoalIconByKey(draggingHeartKey);
                                      if (!heartIcon || !goalDepartmentsMatch(heartIcon.department, icon.department)) {
                                        return;
                                      }
                                      e.preventDefault();
                                      e.dataTransfer.dropEffect = "move";
                                      setDropTargetKey(iconKey);
                                    }}
                                    onDragLeave={() => {
                                      if (dropTargetKey === iconKey) {
                                        setDropTargetKey(null);
                                      }
                                    }}
                                    onDrop={(e) => {
                                      if (!canOperate || icon.kind !== "shortage" || !draggingHeartKey) return;
                                      e.preventDefault();
                                      handleGoalIconDrop(draggingHeartKey, iconKey);
                                    }}
                                  >
                                    {getGoalDepartmentLabel(icon.department)}
                                  </span>
                                );
                              })}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="timeline-gantt">
                      {entries.length === 0 ? (
                        <div className="muted">この日のシフトはありません。</div>
                      ) : (
                        entries.map(({ staff, desiredShift, confirmedShift, currentStatus }) => (
                          <AdminGanttRow
                            key={staff.id}
                            staff={staff}
                            desiredShift={desiredShift}
                            confirmedShift={confirmedShift}
                            currentStatus={currentStatus}
                            dragPreview={
                              ganttDragPreview && desiredShift?.id === ganttDragPreview.desiredId
                                ? ganttDragPreview
                                : null
                            }
                            canOperate={canOperate}
                            weekConfirmedMinutes={
                              selectedWeekSummaryMap.get(staff.id)?.confirmedMinutes ?? 0
                            }
                            ganttDate={ganttDate}
                            onStatusChange={handleGanttRowStatusChange}
                            onDragHandleDown={handleGanttDragHandleDown}
                          />
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="department-section-pane department-section-column-confirm">
                  {renderShiftConfirmContent(department, issues, summaries)}
                </div>
              </div>
            </section>
          );
        })
        )}
      </div>
      {publishModalSection && (
        <div className="modal-backdrop" onClick={() => setPublishModalDepartment(null)}>
          <div className="modal-panel publish-confirm-modal" onClick={(e) => e.stopPropagation()}>
            {renderShiftConfirmContent(
              publishModalSection.department,
              publishModalSection.issues,
              publishModalSection.summaries,
              { showDepartment: true, showIssueStatus: true }
            )}
            <div className="actions publish-confirm-actions">
              <button
                type="button"
                className="btn primary"
                onClick={() => handlePublishDepartment(publishModalSection.department)}
                disabled={
                  publishModalSection.issues.length > 0 ||
                  !operableDepartmentSet.has(publishModalSection.department)
                }
              >
                確定
              </button>
              <button type="button" className="btn" onClick={() => setPublishModalDepartment(null)}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
      {requiredEditor && (
          <div className="modal-backdrop" onClick={() => setRequiredEditor(null)}>
            <div className="modal-panel required-dept-modal" onClick={(e) => e.stopPropagation()}>
              <h3 style={{ marginTop: 0 }}>必要勤務時間を入力してください</h3>
              <div className="form-grid required-dept-form">
                <div className="required-dept-grid">
                {getGoalDisplayDepartments(masterDepartments).map((department) => {
                  const canEditHours = operableDepartmentSet.has(department);
                  return (
                  <label key={department} className="required-dept-row">
                    <span className="required-dept-name">
                      {department}
                      {!canEditHours ? <span className="muted">（閲覧）</span> : null}
                    </span>
                    <span className="required-dept-input-wrap">
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={requiredEditor.departmentHours[department] ?? ""}
                        disabled={!canEditHours}
                        onChange={(e) =>
                          setRequiredEditor((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  departmentHours: {
                                    ...prev.departmentHours,
                                    [department]: e.target.value,
                                  },
                                }
                              : prev
                          )
                        }
                      />
                      <span className="required-dept-unit">h</span>
                    </span>
                  </label>
                  );
                })}
                </div>
                <label>
                  備考
                  <textarea
                    rows={4}
                    value={requiredEditor.note}
                    onChange={(e) => setRequiredEditor((prev) => (prev ? { ...prev, note: e.target.value } : prev))}
                    placeholder="例: 仕込み多め、イベント対応など"
                  />
                </label>
              </div>
              <div className="actions" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="btn primary" onClick={handleSaveRequired}>
                  保存
                </button>
                <button type="button" className="btn" onClick={() => setRequiredEditor(null)}>
                  キャンセル
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {csvExportModal}
    </div>
  );
}
