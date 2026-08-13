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
  return (
    confirmed.status === "unconfirmed" ||
    (confirmed.startTime === "09:00" && confirmed.endTime === "09:01")
  );
}

/** 公開済みの確定シフトか（週単位の公開も含む） */
export function isWorkerPublishedShift(
  period: ShiftPeriod,
  confirmed: ConfirmedShift | undefined,
  date: string,
  workerPublishedDates?: readonly string[]
): boolean {
  if (workerPublishedDates?.includes(date)) return true;
  return Boolean(confirmed?.publishedAt) || isPublishedWeekDate(period, date);
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
  const weekStarts = new Set<string>();
  const deptWorkerIds = getDeptWorkerIds(department, staffList, options?.knownDepartments);

  for (const shift of confirmedShifts) {
    if (!shift.publishedAt) continue;
    if (!deptWorkerIds.has(shift.staffId)) continue;
    weekStarts.add(getMondayOfWeek(shift.date));
  }

  if (period.publishedWeekStartDate) {
    const weekDates = getWeekDates(period.publishedWeekStartDate);
    const publishedInWeek = confirmedShifts.some(
      (shift) =>
        Boolean(shift.publishedAt) &&
        weekDates.includes(shift.date) &&
        deptWorkerIds.has(shift.staffId)
    );
    if (publishedInWeek) {
      weekStarts.add(period.publishedWeekStartDate);
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
  const dates = new Set(
    computeDepartmentPublishedDates(period, staffList, confirmedShifts, workerTeam, options)
  );

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
  if (confirmed.status === "unconfirmed") return false;
  if (!desired) {
    if (isRestConfirmedShift(confirmed)) return false;
    return isAttendanceStatus(confirmed.status);
  }
  // 管理者が確定時刻を調整しただけでは調整中にしない（公開後の希望更新のみ）
  if (desired.updatedAt <= confirmed.publishedAt) return false;
  return (
    desired.startTime !== confirmed.startTime ||
    desired.endTime !== confirmed.endTime ||
    (desired.note ?? "") !== (confirmed.note ?? "")
  );
}

/** 公開済み確定後の再提出・再調整が必要か */
export function hasStaffPendingAdjustment(
  period: ShiftPeriod,
  confirmed: ConfirmedShift | undefined,
  desired: DesiredShift | undefined,
  date: string,
  workerPublishedDates?: readonly string[]
): boolean {
  if (!isWorkerPublishedShift(period, confirmed, date, workerPublishedDates)) return false;
  return hasWishChangedAfterPublish(confirmed, desired);
}

export type WorkerShiftDisplay =
  | { kind: "rest"; pending: false }
  | { kind: "confirmed"; shift: ConfirmedShift; pending: false }
  | { kind: "wish"; shift: DesiredShift; pending: boolean }
  | { kind: "empty"; pending: boolean };

/** アルバイト画面: 確定公開後は確定シフトを優先表示 */
export function resolveWorkerShiftDisplay(
  period: ShiftPeriod,
  confirmed: ConfirmedShift | undefined,
  desired: DesiredShift | undefined,
  date: string,
  workerPublishedDates?: readonly string[]
): WorkerShiftDisplay {
  const pending = hasStaffPendingAdjustment(period, confirmed, desired, date, workerPublishedDates);
  const published = isWorkerPublishedShift(period, confirmed, date, workerPublishedDates);

  if (pending) {
    if (desired) return { kind: "wish", shift: desired, pending: true };
    return { kind: "empty", pending: true };
  }

  if (published && !pending) {
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
 * - 希望あり → 週確定（publishedAt）前後を問わず「調整」（確定ボタンで反映されるまで）
 * - 公開後に希望が確定内容と異なる → 調整
 * - 希望なし・休み確定 → 休み
 */
export function getAdminShiftStatus(
  confirmed: ConfirmedShift | undefined,
  desired: DesiredShift | undefined
): ConfirmedShift["status"] {
  if (!confirmed && !desired) return "unconfirmed";

  if (desired) {
    if (!confirmed?.publishedAt) return "adjusting";
    if (hasWishChangedAfterPublish(confirmed, desired)) return "adjusting";
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
