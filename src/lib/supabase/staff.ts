import type { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import type { AdminPermission, EmploymentStatus, SalaryRaise, Staff, StaffRole } from "@/lib/shift/types";

type SupabaseClient = ReturnType<typeof createClient>;
type StaffProfileRow = Database["public"]["Tables"]["staff_profiles"]["Row"];
type DepartmentRow = Database["public"]["Tables"]["departments"]["Row"];
type SalaryRaiseRow = Database["public"]["Tables"]["salary_raises"]["Row"];

type ProfileWithRaises = StaffProfileRow & {
  salary_raises?: SalaryRaiseRow[] | null;
  departments?: Pick<DepartmentRow, "id" | "name"> | null;
};

function mapSalaryRaises(rows: SalaryRaiseRow[] | null | undefined): SalaryRaise[] {
  if (!rows) return [];
  return rows.map((row) => ({
    id: row.id,
    effectiveDate: row.effective_date,
    hourlyWage: row.hourly_wage,
    note: row.note ?? "",
  }));
}

export function mapStaffProfile(
  row: ProfileWithRaises,
  departmentNameById: Record<string, string>,
  managedTeams: string[] = []
): Staff {
  const team =
    row.departments?.name ||
    (row.department_id ? departmentNameById[row.department_id] : "") ||
    "";

  return {
    id: row.id,
    name: row.last_name,
    firstName: row.first_name ?? "",
    displayGivenName: row.display_given_name,
    iconLabel: row.icon_label ?? "",
    team,
    managedTeams: row.role === "admin" ? managedTeams : [],
    password: "",
    role: row.role as StaffRole,
    adminPermission: row.admin_permission as AdminPermission,
    status: row.status as EmploymentStatus,
    weeklyContractHours: Number(row.weekly_contract_hours) || 0,
    socialInsurance: Boolean(row.social_insurance),
    hireDate: row.hire_date ?? "",
    contractStartDate: row.contract_start_date ?? "",
    contractEndDate: row.contract_end_date ?? "",
    contractRenewalMonths: row.contract_renewal_months || 3,
    hourlyWage: row.hourly_wage || 0,
    salaryHistory: mapSalaryRaises(row.salary_raises),
    email: row.email ?? "",
    googleEmail: row.google_email ?? "",
    note: row.note ?? "",
  };
}

export type StaffBootstrap = {
  userId: string;
  departments: string[];
  staffList: Staff[];
};

type StaffBootstrapServiceClient = {
  from: SupabaseClient["from"];
};

type DepartmentBootstrapRow = Pick<DepartmentRow, "id" | "name" | "sort_order">;

/** service role 経由で staff / departments 一覧を取得 */
export async function loadStaffBootstrapFromService(
  service: StaffBootstrapServiceClient,
  authUserId: string,
  authEmail: string,
  preloadedDepartments?: DepartmentBootstrapRow[]
): Promise<StaffBootstrap | null> {
  const departmentResult = preloadedDepartments
    ? { data: preloadedDepartments, error: null as null }
    : await service
        .from("departments")
        .select("id, name, sort_order")
        .order("sort_order", { ascending: true });
  if (departmentResult.error) {
    throw new Error(departmentResult.error.message);
  }

  const profileResult = await service.from("staff_profiles").select("*, salary_raises(*)");
  if (profileResult.error) {
    throw new Error(profileResult.error.message);
  }

  const managedResult = await service.from("staff_managed_departments").select("staff_id, department_id");
  if (managedResult.error) {
    console.warn("staff_managed_departments fetch failed", managedResult.error.message);
  }

  const departmentRows = departmentResult.data ?? [];
  const departmentNameById = Object.fromEntries(departmentRows.map((d) => [d.id, d.name]));
  const managedTeamsByStaffId = new Map<string, string[]>();
  for (const row of managedResult.data ?? []) {
    const name = departmentNameById[row.department_id];
    if (!name) continue;
    const list = managedTeamsByStaffId.get(row.staff_id) ?? [];
    list.push(name);
    managedTeamsByStaffId.set(row.staff_id, list);
  }

  const rows = profileResult.data ?? [];
  const normalizedEmail = authEmail.trim().toLowerCase();
  let rawCurrent = rows.find((row) => row.id === authUserId);
  if (!rawCurrent && normalizedEmail) {
    rawCurrent = rows.find((row) => (row.email ?? "").toLowerCase() === normalizedEmail);
  }
  if (!rawCurrent) return null;

  const staffList = rows.map((row) =>
    mapStaffProfile(row as ProfileWithRaises, departmentNameById, managedTeamsByStaffId.get(row.id) ?? [])
  );
  const current = mapStaffProfile(
    rawCurrent as ProfileWithRaises,
    departmentNameById,
    managedTeamsByStaffId.get(rawCurrent.id) ?? []
  );

  return {
    userId: current.id,
    departments: departmentRows.map((d) => d.name).filter((name) => name !== "本部"),
    staffList,
  };
}

/** ログイン中ユーザー向けに departments / staff_profiles を取得 */
export async function fetchStaffBootstrap(
  supabase: SupabaseClient,
  options?: { attempts?: number; signOutOnAuthFailure?: boolean }
): Promise<StaffBootstrap | null> {
  const attempts = Math.max(1, options?.attempts ?? 2);
  const signOutOnAuthFailure = options?.signOutOnAuthFailure ?? false;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }

    const response = await fetch("/api/bootstrap/staff", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 401 || response.status === 403) {
      if (signOutOnAuthFailure && attempt === attempts - 1) {
        await supabase.auth.signOut({ scope: "local" });
      }
      continue;
    }
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { ok?: boolean; bootstrap?: StaffBootstrap; message?: string };
    if (payload.ok && payload.bootstrap?.userId) {
      return payload.bootstrap;
    }
    return null;
  }

  return null;
}

export type StaffPersistPatch = Partial<{
  name: string;
  firstName: string;
  displayGivenName: boolean;
  iconLabel: string;
  team: string;
  managedTeams: string[];
  status: EmploymentStatus;
  weeklyContractHours: number;
  socialInsurance: boolean;
  role: StaffRole;
  adminPermission: AdminPermission;
  hireDate: string;
  contractStartDate: string;
  contractEndDate: string;
  contractRenewalMonths: number;
  hourlyWage: number;
  email: string;
  googleEmail: string;
  note: string;
}>;

function emptyToNull(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** staff_profiles を部分更新（マネージャー RLS） */
export async function persistStaffUpdate(
  supabase: SupabaseClient,
  staffId: string,
  patch: StaffPersistPatch
): Promise<{ ok: true } | { ok: false; message: string }> {
  const update: Database["public"]["Tables"]["staff_profiles"]["Update"] = {};

  if (patch.name !== undefined) update.last_name = patch.name.trim();
  if (patch.firstName !== undefined) update.first_name = patch.firstName.trim();
  if (patch.displayGivenName !== undefined) update.display_given_name = patch.displayGivenName;
  if (patch.iconLabel !== undefined) update.icon_label = patch.iconLabel;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.weeklyContractHours !== undefined) update.weekly_contract_hours = patch.weeklyContractHours;
  if (patch.socialInsurance !== undefined) update.social_insurance = patch.socialInsurance;
  if (patch.role !== undefined) update.role = patch.role;
  if (patch.adminPermission !== undefined) update.admin_permission = patch.adminPermission;
  if (patch.hireDate !== undefined) update.hire_date = emptyToNull(patch.hireDate);
  if (patch.contractStartDate !== undefined) update.contract_start_date = emptyToNull(patch.contractStartDate);
  if (patch.contractEndDate !== undefined) update.contract_end_date = emptyToNull(patch.contractEndDate);
  if (patch.contractRenewalMonths !== undefined) {
    update.contract_renewal_months = Math.max(1, patch.contractRenewalMonths);
  }
  if (patch.hourlyWage !== undefined) update.hourly_wage = patch.hourlyWage;
  if (patch.email !== undefined) update.email = patch.email.trim().toLowerCase();
  if (patch.googleEmail !== undefined) update.google_email = patch.googleEmail.trim();
  if (patch.note !== undefined) update.note = patch.note;

  if (patch.team !== undefined) {
    const team = patch.team.trim();
    if (!team) {
      update.department_id = null;
    } else {
      const { data: department, error: deptError } = await supabase
        .from("departments")
        .select("id")
        .eq("name", team)
        .maybeSingle();
      if (deptError) {
        return { ok: false, message: deptError.message };
      }
      if (!department) {
        return { ok: false, message: `所属「${team}」が見つかりません。先にチームを追加してください。` };
      }
      update.department_id = department.id;
    }
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from("staff_profiles").update(update).eq("id", staffId);
    if (error) {
      return { ok: false, message: error.message };
    }
  }

  if (patch.managedTeams !== undefined) {
    const managedResult = await persistStaffManagedDepartments(supabase, staffId, patch.managedTeams);
    if (!managedResult.ok) return managedResult;
  }

  return { ok: true };
}

export async function persistStaffManagedDepartments(
  supabase: SupabaseClient,
  staffId: string,
  managedTeams: string[]
): Promise<{ ok: true } | { ok: false; message: string }> {
  const uniqueNames = [...new Set(managedTeams.map((name) => name.trim()).filter(Boolean))];
  const departmentIds: string[] = [];

  for (const name of uniqueNames) {
    const { data, error } = await supabase.from("departments").select("id").eq("name", name).maybeSingle();
    if (error) return { ok: false, message: error.message };
    if (!data) return { ok: false, message: `所属「${name}」が見つかりません。` };
    departmentIds.push(data.id);
  }

  const { error: deleteError } = await supabase
    .from("staff_managed_departments")
    .delete()
    .eq("staff_id", staffId);
  if (deleteError) {
    if (deleteError.message.includes("staff_managed_departments")) {
      return {
        ok: false,
        message:
          "所属権限テーブル（staff_managed_departments）が未作成です。Supabase SQL Editor で 20260812220000_admin_managed_departments.sql を実行してください。",
      };
    }
    return { ok: false, message: deleteError.message };
  }

  if (departmentIds.length === 0) return { ok: true };

  const { error: insertError } = await supabase.from("staff_managed_departments").insert(
    departmentIds.map((department_id) => ({ staff_id: staffId, department_id }))
  );
  if (insertError) {
    if (insertError.message.includes("staff_managed_departments")) {
      return {
        ok: false,
        message:
          "所属権限テーブル（staff_managed_departments）が未作成です。Supabase SQL Editor で 20260812220000_admin_managed_departments.sql を実行してください。",
      };
    }
    return { ok: false, message: insertError.message };
  }
  return { ok: true };
}

export async function persistDepartmentAdd(
  supabase: SupabaseClient,
  name: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.from("departments").insert({
    name,
    is_fixed: false,
    sort_order: 99,
  });
  if (error) {
    // 既に同名がある場合は成功扱い
    if (error.code === "23505") return { ok: true };
    return { ok: false, message: error.message };
  }
  return { ok: true };
}

export async function persistDepartmentRename(
  supabase: SupabaseClient,
  oldName: string,
  nextName: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from("departments")
    .update({ name: nextName })
    .eq("name", oldName)
    .select("id");
  if (error) {
    return { ok: false, message: error.message };
  }
  if (!data?.length) {
    return { ok: false, message: `所属「${oldName}」が見つかりません。` };
  }
  return { ok: true };
}

export async function persistDepartmentDelete(
  supabase: SupabaseClient,
  name: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: row, error: findError } = await supabase
    .from("departments")
    .select("id, is_fixed")
    .eq("name", name)
    .maybeSingle();
  if (findError) {
    return { ok: false, message: findError.message };
  }
  if (!row) {
    return { ok: false, message: `所属「${name}」が見つかりません。` };
  }
  if (row.is_fixed) {
    return { ok: false, message: "固定の所属は削除できません。" };
  }
  const { error } = await supabase.from("departments").delete().eq("id", row.id);
  if (error) {
    return { ok: false, message: error.message };
  }
  return { ok: true };
}

export async function persistSalaryRaise(
  supabase: SupabaseClient,
  staffId: string,
  input: { effectiveDate: string; hourlyWage: number; note: string }
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from("salary_raises")
    .insert({
      staff_id: staffId,
      effective_date: input.effectiveDate,
      hourly_wage: input.hourlyWage,
      note: input.note,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, message: error?.message || "昇給の保存に失敗しました。" };
  }

  const { error: wageError } = await supabase
    .from("staff_profiles")
    .update({ hourly_wage: input.hourlyWage })
    .eq("id", staffId);
  if (wageError) {
    return { ok: false, message: wageError.message };
  }
  return { ok: true, id: data.id };
}

export async function persistSalaryRaiseUpdate(
  supabase: SupabaseClient,
  staffId: string,
  raiseId: string,
  input: { effectiveDate: string; hourlyWage: number; note: string }
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const effectiveDate = input.effectiveDate.trim();
  const hourlyWage = input.hourlyWage;
  const note = input.note.trim();

  // 表示用の仮ID（初任給の合成行）は実レコードとして新規作成
  if (raiseId.startsWith("initial-")) {
    return persistSalaryRaise(supabase, staffId, { effectiveDate, hourlyWage, note });
  }

  const { error } = await supabase
    .from("salary_raises")
    .update({
      effective_date: effectiveDate,
      hourly_wage: hourlyWage,
      note,
    })
    .eq("id", raiseId)
    .eq("staff_id", staffId);

  if (error) {
    return { ok: false, message: error.message || "昇給履歴の更新に失敗しました。" };
  }

  const { data: rows, error: listError } = await supabase
    .from("salary_raises")
    .select("hourly_wage, effective_date")
    .eq("staff_id", staffId)
    .order("effective_date", { ascending: false })
    .limit(1);

  if (listError) {
    return { ok: false, message: listError.message };
  }

  const latestWage = rows?.[0]?.hourly_wage;
  if (typeof latestWage === "number") {
    const { error: wageError } = await supabase
      .from("staff_profiles")
      .update({ hourly_wage: latestWage })
      .eq("id", staffId);
    if (wageError) {
      return { ok: false, message: wageError.message };
    }
  }

  return { ok: true, id: raiseId };
}

export async function persistStaffDelete(
  supabase: SupabaseClient,
  staffId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  // 参照制約がある場合は退職扱いにフォールバック
  const { error: deleteError } = await supabase.from("staff_profiles").delete().eq("id", staffId);
  if (!deleteError) {
    return { ok: true };
  }
  const { error: inactiveError } = await supabase
    .from("staff_profiles")
    .update({ status: "inactive" })
    .eq("id", staffId);
  if (inactiveError) {
    return { ok: false, message: inactiveError.message || deleteError.message };
  }
  return { ok: true };
}
