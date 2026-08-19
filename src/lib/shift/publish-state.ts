import { getMondayOfWeek, getWeekDates } from "@/lib/shift/dates";
import { isAttendanceStatus } from "@/lib/shift/status";
import type { ConfirmedShift, DesiredShift, ShiftPeriod, Staff } from "@/lib/shift/types";

export function isPublishedWeekDate(period: ShiftPeriod, date: string): boolean {
  if (!period.publishedWeekStartDate) return false;
  return getWeekDates(period.publishedWeekStartDate).includes(date);
}

/** 所属単位で、その日を含む週（月〜金）が確定済みか */
export function isDepartmentWeekPublished(
  department: string,
  date: string,
  staffList: Pick<Staff, "id" | "role" | "status" | "team">[],
  confirmedShifts: ConfirmedShift[],
  options?: { knownDepartments?: ReadonlySet<string> }
): boolean {
  const weekDates = getWeekDates(getMondayOfWeek(date));
  const deptWorkers = staffList.filter((staff) => {
    if (staff.role !== "worker" || staff.status !== "active") return false;
    if (department === "未設定") {
      return options?.knownDepartments ? !options.knownDepartments.has(staff.team) : false;
    }
    return staff.team === department;
  });
  if (deptWorkers.length === 0) return false;

  return weekDates.every((weekDate) =>
    deptWorkers.every((worker) =>
      confirmedShifts.some(
        (shift) => shift.staffId === worker.id && shift.date === weekDate && Boolean(shift.publishedAt)
      )
    )
  );
}

export function isRestConfirmedShift(confirmed: ConfirmedShift): boolean {
  if (confirmed.status === "adjusting") return false;
  return (
    confirmed.status === "unconfirmed" ||
    (confirmed.startTime === "09:00" && confirmed.endTime === "09:01")
  );
}

/** 公開済みの確定シフトか（当該日の confirmed が公開されているか） */
export function isWorkerPublishedShift(
  period: ShiftPeriod,
  confirmed: ConfirmedShift | undefined,
  date: string,
  workerPublishedDates?: readonly string[]
): boolean {
  void period;
  void date;
  if (workerPublishedDates?.includes(date)) return true;
  return Boolean(confirmed?.publishedAt);
}

function getDeptWorkerIds(
  workerTeam: string,
  staffList: Pick<Staff, "id" | "role" | "status" | "team">[],
  knownDepartments?: ReadonlySet<string>
): Set<string> {
  const workers = staffList.filter((staff) => staff.role === "worker" && staff.status === "active");
  if (workerTeam === "未設定") {
    return new Set(
      workers.filter((staff) => (knownDepartments ? !knownDepartments.has(staff.team) : false)).map((s) => s.id)
    );
  }
  if (!workerTeam) return new Set();
  return new Set(workers.filter((staff) => staff.team === workerTeam).map((staff) => staff.id));
}

/**
 * 確定週のセル背景用（所属単位）: 所属内に公開済み確定が1日でもあれば、その週（月〜金）すべて。
 */
export function computeDepartmentPublishedDates(
  period: ShiftPeriod,
  staffList: Pick<Staff, "id" | "role" | "status" | "team">[],
  confirmedShifts: ConfirmedShift[],
  department: string,
  options?: { knownDepartments?: ReadonlySet<string> }
): string[] {
  const deptWorkerIds = getDeptWorkerIds(department, staffList, options?.knownDepartments);
  const weekStarts = new Set<string>();

  for (const shift of confirmedShifts) {
    if (!shift.publishedAt) continue;
    if (!deptWorkerIds.has(shift.staffId)) continue;
    weekStarts.add(getMondayOfWeek(shift.date));
  }

  if (period.publishedWeekStartDate) {
    const weekDates = new Set(getWeekDates(period.publishedWeekStartDate));
    for (const shift of confirmedShifts) {
      if (!shift.publishedAt) continue;
      if (!weekDates.has(shift.date)) continue;
      if (!deptWorkerIds.has(shift.staffId)) continue;
      weekStarts.add(period.publishedWeekStartDate);
      break;
    }
  }

  const dates = new Set<string>();
  for (const weekStart of weekStarts) {
    for (const date of getWeekDates(weekStart)) {
      dates.add(date);
    }
  }
  return Array.from(dates).sort();
}

/** 管理者画面: 所属行の確定週セル背景 */
export function isDepartmentCalendarDatePublished(
  date: string,
  department: string,
  period: ShiftPeriod,
  staffList: Pick<Staff, "id" | "role" | "status" | "team">[],
  confirmedShifts: ConfirmedShift[],
  options?: { knownDepartments?: ReadonlySet<string> }
): boolean {
  return computeDepartmentPublishedDates(
    period,
    staffList,
    confirmedShifts,
    department,
    options
  ).includes(date);
}

/**
 * 確定週のセル背景用: 所属内に公開済み確定が1日でもあれば、その週（月〜金）すべてを返す。
 * 同じ所属のアルバイト全員が同じ週を緑表示する。
 */
export function computeWorkerPublishedDates(
  period: ShiftPeriod,
  staffList: Pick<Staff, "id" | "role" | "status" | "team">[],
  confirmedShifts: ConfirmedShift[],
  staffId: string,
  workerTeam: string,
  options?: { knownDepartments?: ReadonlySet<string> }
): string[] {
  const dates = new Set(computeDepartmentPublishedDates(period, staffList, confirmedShifts, workerTeam, options));

  for (const shift of confirmedShifts) {
    if (!shift.publishedAt || shift.staffId !== staffId) continue;
    for (const date of getWeekDates(getMondayOfWeek(shift.date))) {
      dates.add(date);
    }
  }

  return Array.from(dates).sort();
}

/** アルバイトカレンダーのセル背景（確定週）— workerPublishedDates を優先 */
export function isWorkerCalendarDatePublished(
  date: string,
  workerPublishedDates: readonly string[] | undefined,
  period: ShiftPeriod,
  staffList: Pick<Staff, "id" | "role" | "status" | "team">[],
  confirmedShifts: ConfirmedShift[],
  workerTeam: string,
  staffId: string,
  options?: { knownDepartments?: ReadonlySet<string> }
): boolean {
  if (workerPublishedDates?.includes(date)) return true;
  return computeWorkerPublishedDates(period, staffList, confirmedShifts, staffId, workerTeam, options).includes(
    date
  );
}

/** 確定公開後に、アルバイト本人が希望を変更したか */
export function hasWishChangedAfterPublish(
  confirmed: ConfirmedShift | undefined,
  desired: DesiredShift | undefined
): boolean {
  if (!confirmed?.publishedAt) return false;
  if (!desired) {
    if (isRestConfirmedShift(confirmed)) return false;
    return isAttendanceStatus(confirmed.status);
  }
  if (desired.updatedAt <= confirmed.publishedAt) return false;
  if (isRestConfirmedShift(confirmed)) return true;
  return (
    desired.startTime !== confirmed.startTime ||
    desired.endTime !== confirmed.endTime ||
    (desired.note ?? "") !== (confirmed.note ?? "")
  );
}

/**
 * 確定後に「もう一度確定」が必要か（管理者の赤セル）。
 * ステータスとは独立し、確定ボタンで publishedAt が更新されるまで true。
 */
export function needsRepublishAfterConfirm(
  confirmed: ConfirmedShift | undefined,
  desired: DesiredShift | undefined
): boolean {
  if (!confirmed?.publishedAt) return false;
  if (confirmed.updatedAt > confirmed.publishedAt) return true;
  return hasWishChangedAfterPublish(confirmed, desired);
}

/**
 * アルバイトの希望が、管理者の確認・確定に未反映か。
 * - 希望のみ（初回提出）→ true（管理者画面では「調整」で入る）
 * - 確定公開後の再提出 → true
 * - 確定前: 管理者がステータスを反映済みで希望に追従していない → false
 */
export function hasUnreviewedWorkerWish(
  confirmed: ConfirmedShift | undefined,
  desired: DesiredShift | undefined
): boolean {
  if (!desired) {
    if (confirmed?.publishedAt) {
      return hasWishChangedAfterPublish(confirmed, undefined);
    }
    return false;
  }
  if (!confirmed) return true;
  if (confirmed.publishedAt) {
    return hasWishChangedAfterPublish(confirmed, desired);
  }
  if (confirmed.status === "adjusting") return true;
  return desired.updatedAt > confirmed.updatedAt;
}

/** 確定週で、公開済み内容に対する再提出・未反映希望があるか（アルバイト赤表示・管理者赤セル） */
export function hasStaffPendingAdjustment(
  period: ShiftPeriod,
  confirmed: ConfirmedShift | undefined,
  desired: DesiredShift | undefined,
  date: string,
  workerPublishedDates?: readonly string[]
): boolean {
  void period;
  const wasPublishedForDisplay =
    Boolean(confirmed?.publishedAt) || Boolean(workerPublishedDates?.includes(date));
  if (!wasPublishedForDisplay) return false;
  if (confirmed?.publishedAt) {
    return needsRepublishAfterConfirm(confirmed, desired);
  }
  return hasUnreviewedWorkerWish(confirmed, desired);
}

/** 管理者カレンダー: 確定後の再確定待ち（赤セル表示） */
export function isAdminResubmissionPending(
  confirmed: ConfirmedShift | undefined,
  desired: DesiredShift | undefined
): boolean {
  return needsRepublishAfterConfirm(confirmed, desired);
}

export type WorkerShiftDisplay =
  | { kind: "rest"; pending: false }
  | { kind: "confirmed"; shift: ConfirmedShift; pending: false }
  | { kind: "wish"; shift: DesiredShift; pending: boolean }
  | { kind: "empty"; pending: boolean };

/** アルバイト画面: 確定反映済みは青、未反映の希望は赤 */
export function resolveWorkerShiftDisplay(
  period: ShiftPeriod,
  confirmed: ConfirmedShift | undefined,
  desired: DesiredShift | undefined,
  date: string,
  workerPublishedDates?: readonly string[]
): WorkerShiftDisplay {
  void period;
  void workerPublishedDates;
  void date;
  const shiftPublished = Boolean(confirmed?.publishedAt);
  const pendingAfterPublish =
    shiftPublished && hasWishChangedAfterPublish(confirmed, desired);
  const unreviewed = hasUnreviewedWorkerWish(confirmed, desired);

  if (pendingAfterPublish) {
    if (desired) return { kind: "wish", shift: desired, pending: true };
    return { kind: "empty", pending: true };
  }

  if (unreviewed) {
    if (desired) return { kind: "wish", shift: desired, pending: false };
    return { kind: "empty", pending: false };
  }

  if (shiftPublished) {
    if (!confirmed || isRestConfirmedShift(confirmed)) {
      return { kind: "rest", pending: false };
    }
    return { kind: "confirmed", shift: confirmed, pending: false };
  }

  if (desired) return { kind: "wish", shift: desired, pending: false };
  return { kind: "empty", pending: false };
}

/**
 * 管理者画面のステータス表示・編集用。
 * - 初回提出など未確定の希望 → 調整
 * - 確定後の編集 → 管理者が選んだステータス（弧の色）。赤セルは needsRepublishAfterConfirm
 */
export function getAdminShiftStatus(
  confirmed: ConfirmedShift | undefined,
  desired: DesiredShift | undefined
): ConfirmedShift["status"] {
  if (!confirmed && !desired) return "unconfirmed";

  if (confirmed?.publishedAt && needsRepublishAfterConfirm(confirmed, desired)) {
    if (desired && hasWishChangedAfterPublish(confirmed, desired)) {
      if (isAttendanceStatus(confirmed.status)) return confirmed.status;
      return "adjusting";
    }
    if (isAttendanceStatus(confirmed.status)) return confirmed.status;
    if (isRestConfirmedShift(confirmed)) return "unconfirmed";
    return "adjusting";
  }

  if (hasUnreviewedWorkerWish(confirmed, desired)) {
    return "adjusting";
  }

  if (!confirmed) return "unconfirmed";
  if (isRestConfirmedShift(confirmed)) return "unconfirmed";
  return confirmed.status;
}

/** @deprecated getAdminShiftStatus を使用 */
export function getStaffShiftStatus(
  confirmed: ConfirmedShift | undefined,
  desired: DesiredShift | undefined
): ConfirmedShift["status"] {
  return getAdminShiftStatus(confirmed, desired);
}

/** @deprecated getAdminShiftStatus を使用 */
export function getEffectiveStaffShiftStatus(
  period: ShiftPeriod,
  confirmed: ConfirmedShift | undefined,
  desired: DesiredShift | undefined,
  date: string
): ConfirmedShift["status"] {
  return getAdminShiftStatus(confirmed, desired);
}

/** 管理者画面で表示・集計に使うシフト（再提出・調整中は希望を優先） */
export function resolveAdminShiftDisplay(
  confirmed: ConfirmedShift | undefined,
  desired: DesiredShift | undefined,
  options?: { currentStatus?: ConfirmedShift["status"] }
): ConfirmedShift | DesiredShift | undefined {
  const status = options?.currentStatus ?? getAdminShiftStatus(confirmed, desired);
  if (status === "unconfirmed") return undefined;
  if (status === "adjusting") return desired;
  if (!confirmed || isRestConfirmedShift(confirmed)) return undefined;
  return confirmed;
}

export { isAttendanceStatus };
