export type StaffRole = "worker" | "admin";

/** 管理者権限。マネージャーのみマスタ管理を利用できる */
export type AdminPermission = "manager" | "general";

export type EmploymentStatus = "active" | "inactive";

export type ShiftPeriodStatus = "draft" | "editing" | "adjusting" | "published";

export interface SalaryRaise {
  id: string;
  effectiveDate: string;
  hourlyWage: number;
  note: string;
}

export interface Staff {
  id: string;
  name: string;
  firstName: string;
  displayGivenName: boolean;
  iconLabel: string;
  team: string;
  password: string;
  role: StaffRole;
  /** 管理者向け権限。アルバイトでは参照しない */
  adminPermission: AdminPermission;
  status: EmploymentStatus;
  weeklyContractHours: number;
  /** 社保加入ありの場合、契約h表示の代わりに「社保あり」 */
  socialInsurance: boolean;
  /** 入社日 YYYY-MM-DD */
  hireDate: string;
  /** 現行契約開始日 */
  contractStartDate: string;
  /** 現行契約終了日（更新期限） */
  contractEndDate: string;
  /** 契約更新間隔（か月）。デフォルト3 */
  contractRenewalMonths: number;
  /** 現行時給（円） */
  hourlyWage: number;
  /** 昇給履歴（新しい順でも古い順でも可。表示時に整列） */
  salaryHistory: SalaryRaise[];
  /** ログイン用メールアドレス（Supabase Auth） */
  email: string;
  /** Googleカレンダー連携用メールアドレス */
  googleEmail: string;
}

export interface ShiftPeriod {
  id: string;
  adjustmentStatus: ShiftPeriodStatus;
  publishedWeekStartDate: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DesiredShift {
  id: string;
  staffId: string;
  periodId: string;
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  actualMinutes: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConfirmedShift {
  id: string;
  staffId: string;
  periodId: string;
  date: string;
  status: "adjusting" | "unconfirmed" | "confirmed";
  startTime: string;
  endTime: string;
  breakMinutes: number;
  actualMinutes: number;
  note: string;
  adminNote: string;
  /** null = 未公開 */
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequiredShiftCount {
  id: string;
  periodId: string;
  date: string;
  requiredPeople: number;
  requiredMinutes: number;
  departmentRequiredMinutes: Record<string, number>;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShiftDaySummary {
  date: string;
  desiredCount: number;
  desiredMinutes: number;
  confirmedCount: number;
  confirmedMinutes: number;
  requiredPeople: number;
  requiredMinutes: number;
  peopleShortage: number;
  minutesShortage: number;
  isAdjusted: boolean;
}

export interface StaffWeeklySummary {
  staffId: string;
  desiredMinutes: number;
  confirmedMinutes: number;
  hasDesiredShift: boolean;
  overContract: boolean;
}

/** 管理者からアルバイトホームへ届けるメッセージ */
export interface HomeMessage {
  id: string;
  body: string;
  createdAt: string;
  createdByStaffId: string;
  /** all = 全アルバイト、team = 指定所属のみ */
  audience: "all" | "team";
  team: string;
}

export interface AppState {
  staffList: Staff[];
  departments: string[];
  period: ShiftPeriod;
  goalBlocksByDate: Record<string, [string[], string[], string[], string[]]>;
  desiredShifts: DesiredShift[];
  confirmedShifts: ConfirmedShift[];
  requiredShifts: RequiredShiftCount[];
  homeMessages: HomeMessage[];
  currentUserId: string;
}
