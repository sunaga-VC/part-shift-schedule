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
  departmentNameById: Record<string, string>
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
  };
}

export type StaffBootstrap = {
  userId: string;
  departments: string[];
  staffList: Staff[];
};

/** ログイン中ユーザー向けに departments / staff_profiles を取得 */
export async function fetchStaffBootstrap(supabase: SupabaseClient): Promise<StaffBootstrap | null> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return null;

  const { data: departments, error: deptError } = await supabase
    .from("departments")
    .select("id, name, sort_order")
    .order("sort_order", { ascending: true });

  if (deptError) {
    console.error("departments fetch failed", deptError);
  }

  const departmentRows = departments ?? [];
  const departmentNameById = Object.fromEntries(departmentRows.map((d) => [d.id, d.name]));

  const { data: profiles, error: profileError } = await supabase
    .from("staff_profiles")
    .select("*, salary_raises(*), departments(id, name)")
    .order("last_name", { ascending: true });

  if (profileError) {
    console.error("staff_profiles fetch failed", profileError);
    // 最低限自分だけでも取る
    const { data: self } = await supabase
      .from("staff_profiles")
      .select("*, salary_raises(*), departments(id, name)")
      .eq("id", user.id)
      .maybeSingle();
    if (!self) return null;
    return {
      userId: user.id,
      departments: departmentRows.map((d) => d.name),
      staffList: [mapStaffProfile(self as unknown as ProfileWithRaises, departmentNameById)],
    };
  }

  const staffList = (profiles as unknown as ProfileWithRaises[]).map((row) =>
    mapStaffProfile(row, departmentNameById)
  );

  // 自分が一覧に無い場合は追加
  if (!staffList.some((s) => s.id === user.id)) {
    const { data: self } = await supabase
      .from("staff_profiles")
      .select("*, salary_raises(*), departments(id, name)")
      .eq("id", user.id)
      .maybeSingle();
    if (self) {
      staffList.unshift(mapStaffProfile(self as unknown as ProfileWithRaises, departmentNameById));
    }
  }

  return {
    userId: user.id,
    departments: departmentRows.map((d) => d.name),
    staffList,
  };
}
