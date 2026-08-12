import type { AdminPermission, Staff, StaffRole } from "@/lib/shift/types";

/** マスタ管理（スタッフ・所属・メッセージ等）。マネージャー / アルバイト管理者 */
export function canManageMaster(permission: AdminPermission | undefined | null): boolean {
  return permission === "manager" || permission === "part_time_admin";
}

/** 管理者アカウントの閲覧・作成・編集・削除。マネージャーのみ */
export function canManageAdminAccounts(permission: AdminPermission | undefined | null): boolean {
  return permission === "manager";
}

export function adminPermissionLabel(permission: AdminPermission): string {
  if (permission === "manager") return "マネージャー";
  if (permission === "part_time_admin") return "アルバイト管理者";
  return "一般";
}

export function normalizeAdminPermission(
  role: StaffRole,
  permission: AdminPermission | string | undefined | null
): AdminPermission {
  if (role !== "admin") return "general";
  if (permission === "general") return "general";
  if (permission === "part_time_admin") return "part_time_admin";
  return "manager";
}

export function isAdminStaff(staff: Pick<Staff, "role"> | undefined | null): boolean {
  return staff?.role === "admin";
}
