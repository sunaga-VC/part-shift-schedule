import type { Staff } from "@/lib/shift/types";
import { isFixedDepartmentName } from "@/lib/shift/goal";

/** UI・権限判定から除外する旧「本部」 */
export function isHeadquartersDepartment(name: string): boolean {
  return name.trim() === "本部";
}

function compareDepartmentsForDisplay(a: string, b: string): number {
  const aFirst = isFixedDepartmentName(a) ? 0 : 1;
  const bFirst = isFixedDepartmentName(b) ? 0 : 1;
  if (aFirst !== bFirst) return aFirst - bFirst;
  return a.localeCompare(b, "ja");
}

/** シフト調整などで扱う所属一覧（本部を除く）。リクルーティングを先頭にする */
export function listOperableDepartmentNames(departments: string[]): string[] {
  return departments
    .filter((department) => Boolean(department?.trim()) && !isHeadquartersDepartment(department))
    .slice()
    .sort(compareDepartmentsForDisplay);
}

/**
 * 管理者が操作できる所属。
 * managedTeams に設定された所属のみ（未設定なら操作不可）。
 */
export function getManagedDepartmentsForAdmin(
  admin: Pick<Staff, "role" | "managedTeams"> | undefined | null,
  departments: string[]
): string[] {
  if (!admin || admin.role !== "admin") return [];
  const allowed = new Set(listOperableDepartmentNames(departments));
  return (admin.managedTeams ?? [])
    .filter((team) => allowed.has(team))
    .slice()
    .sort(compareDepartmentsForDisplay);
}

export function canOperateDepartment(
  admin: Pick<Staff, "role" | "managedTeams"> | undefined | null,
  department: string,
  departments: string[]
): boolean {
  if (!department || department === "未設定" || isHeadquartersDepartment(department)) return false;
  return getManagedDepartmentsForAdmin(admin, departments).includes(department);
}
