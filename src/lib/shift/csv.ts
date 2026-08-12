import { getStaffFullName } from "@/lib/shift/display";
import { isAttendanceStatus } from "@/lib/shift/status";
import type { ConfirmedShift, Staff } from "@/lib/shift/types";

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** 日付を YYYY/MM/DD に変換 */
function formatCsvDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-");
  if (!year || !month || !day) return dateKey;
  return `${year}/${month}/${day}`;
}

function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n");
}

export type BuildShiftCsvInput = {
  shifts: ConfirmedShift[];
  staffList: Staff[];
  dateKeys: string[];
  /** 指定所属のみ */
  departments: string[];
};

/**
 * フォーマット:
 * 氏名,Googleアドレス,日付,開始時間,終了時間,備考
 */
export function buildShiftExportCsv({ shifts, staffList, dateKeys, departments }: BuildShiftCsvInput): string {
  const dateSet = new Set(dateKeys);
  const departmentSet = new Set(departments);

  const filtered = shifts.filter((shift) => {
    if (!dateSet.has(shift.date)) return false;
    if (!isAttendanceStatus(shift.status)) return false;
    const staff = staffList.find((s) => s.id === shift.staffId);
    if (!staff || staff.role !== "worker") return false;
    if (!departmentSet.has(staff.team)) return false;
    return true;
  });

  const header = ["氏名", "Googleアドレス", "日付", "開始時間", "終了時間", "備考"];

  const rows = filtered
    .sort((a, b) => {
      const aStaff = staffList.find((s) => s.id === a.staffId);
      const bStaff = staffList.find((s) => s.id === b.staffId);
      const nameCmp = getStaffFullName(aStaff).localeCompare(getStaffFullName(bStaff), "ja");
      if (nameCmp !== 0) return nameCmp;
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.startTime.localeCompare(b.startTime);
    })
    .map((shift) => {
      const staff = staffList.find((s) => s.id === shift.staffId);
      return [
        getStaffFullName(staff),
        staff?.googleEmail ?? "",
        formatCsvDate(shift.date),
        shift.startTime,
        shift.endTime,
        shift.note || "",
      ];
    });

  return toCsv([header, ...rows]);
}

export function getShiftExportCsvFilename(dateKey: string, departments: string[]): string {
  const label =
    departments.length === 0
      ? "none"
      : departments.length === 1
        ? departments[0].replace(/[\\/:*?"<>|]/g, "_")
        : `${departments.length}depts`;
  return `shifts_${dateKey}_${label}.csv`;
}
