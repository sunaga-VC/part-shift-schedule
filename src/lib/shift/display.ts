import type { Staff } from "./types";

export function getStaffDisplayName(staff: Staff | null | undefined): string {
  if (!staff) return "?";
  return staff.displayGivenName ? staff.firstName || staff.name : staff.name;
}

/** CSV用の氏名（姓 名） */
export function getStaffFullName(staff: Staff | null | undefined): string {
  if (!staff) return "?";
  return [staff.name, staff.firstName].filter(Boolean).join(" ");
}

export function getStaffDisplayInitial(staff: Staff | null | undefined): string {
  return getStaffDisplayName(staff).slice(0, 1) || "?";
}
