import { calcActualMinutes, calcBreakMinutes } from "./time";
import type { AppState, ConfirmedShift, DesiredShift, RequiredShiftCount, ShiftPeriod, Staff } from "./types";

function worker(
  partial: Omit<
    Staff,
    | "displayGivenName"
    | "iconLabel"
    | "role"
    | "adminPermission"
    | "contractRenewalMonths"
    | "salaryHistory"
    | "socialInsurance"
    | "googleEmail"
    | "email"
  > &
    Partial<
      Pick<
        Staff,
        | "displayGivenName"
        | "iconLabel"
        | "contractRenewalMonths"
        | "salaryHistory"
        | "socialInsurance"
        | "googleEmail"
        | "email"
      >
    >
): Staff {
  const hourlyWage = partial.hourlyWage;
  return {
    displayGivenName: false,
    iconLabel: "",
    role: "worker",
    adminPermission: "general",
    socialInsurance: false,
    googleEmail: "",
    email: "",
    contractRenewalMonths: 3,
    salaryHistory:
      partial.salaryHistory ??
      (hourlyWage > 0
        ? [
            {
              id: `raise-${partial.id}-init`,
              effectiveDate: partial.hireDate || partial.contractStartDate || "2026-01-01",
              hourlyWage,
              note: "初任給",
            },
          ]
        : []),
    ...partial,
  };
}

export const staffList: Staff[] = [
  worker({
    id: "staff-001",
    name: "田中",
    firstName: "太郎",
    team: "第1チーム",
    password: "pass001",
    status: "active",
    weeklyContractHours: 20,
    googleEmail: "tanaka@example.com",
    hireDate: "2025-11-01",
    contractStartDate: "2026-05-01",
    contractEndDate: "2026-07-31",
    hourlyWage: 1200,
  }),
  worker({
    id: "staff-002",
    name: "佐藤",
    firstName: "花子",
    team: "第1チーム",
    password: "pass002",
    status: "active",
    weeklyContractHours: 24,
    socialInsurance: true,
    googleEmail: "sato@example.com",
    hireDate: "2025-06-15",
    contractStartDate: "2026-06-15",
    contractEndDate: "2026-09-14",
    hourlyWage: 1250,
    salaryHistory: [
      { id: "raise-002-2", effectiveDate: "2026-06-15", hourlyWage: 1250, note: "契約更新時昇給" },
      { id: "raise-002-1", effectiveDate: "2025-06-15", hourlyWage: 1100, note: "初任給" },
    ],
  }),
  worker({
    id: "staff-003",
    name: "鈴木",
    firstName: "一郎",
    team: "第2チーム",
    password: "pass003",
    status: "active",
    weeklyContractHours: 18,
    googleEmail: "suzuki@example.com",
    hireDate: "2026-02-01",
    contractStartDate: "2026-05-01",
    contractEndDate: "2026-08-20",
    hourlyWage: 1150,
  }),
  worker({
    id: "staff-004",
    name: "高橋",
    firstName: "美咲",
    team: "第2チーム",
    password: "pass004",
    status: "active",
    weeklyContractHours: 20,
    googleEmail: "takahashi@example.com",
    hireDate: "2024-10-01",
    contractStartDate: "2026-07-01",
    contractEndDate: "2026-09-30",
    hourlyWage: 1300,
    salaryHistory: [
      { id: "raise-004-3", effectiveDate: "2026-07-01", hourlyWage: 1300, note: "3か月更新" },
      { id: "raise-004-2", effectiveDate: "2026-04-01", hourlyWage: 1250, note: "更新" },
      { id: "raise-004-1", effectiveDate: "2024-10-01", hourlyWage: 1100, note: "初任給" },
    ],
  }),
  worker({
    id: "staff-005",
    name: "山田",
    firstName: "健",
    team: "第3チーム",
    password: "pass005",
    status: "active",
    weeklyContractHours: 16,
    hireDate: "2026-01-10",
    contractStartDate: "2026-07-10",
    contractEndDate: "2026-10-09",
    hourlyWage: 1100,
  }),
  worker({
    id: "staff-006",
    name: "伊藤",
    firstName: "真央",
    team: "第3チーム",
    password: "pass006",
    status: "inactive",
    weeklyContractHours: 16,
    hireDate: "2025-03-01",
    contractStartDate: "2025-12-01",
    contractEndDate: "2026-02-28",
    hourlyWage: 1100,
  }),
  {
    id: "staff-900",
    name: "管理者",
    firstName: "",
    displayGivenName: false,
    iconLabel: "",
    team: "本部",
    password: "admin",
    role: "admin",
    adminPermission: "manager",
    status: "active",
    weeklyContractHours: 40,
    socialInsurance: false,
    hireDate: "",
    contractStartDate: "",
    contractEndDate: "",
    contractRenewalMonths: 3,
    hourlyWage: 0,
    salaryHistory: [],
    email: "",
    googleEmail: "",
  },
  {
    id: "staff-901",
    name: "一般管理者",
    firstName: "",
    displayGivenName: false,
    iconLabel: "",
    team: "本部",
    password: "general",
    role: "admin",
    adminPermission: "general",
    status: "active",
    weeklyContractHours: 40,
    socialInsurance: false,
    hireDate: "",
    contractStartDate: "",
    contractEndDate: "",
    contractRenewalMonths: 3,
    hourlyWage: 0,
    salaryHistory: [],
    email: "",
    googleEmail: "",
  },
];

export const defaultDepartments = ["第1チーム", "第2チーム", "第3チーム", "本部"];

export const defaultPeriod: ShiftPeriod = {
  id: "period-2026-08-10",
  adjustmentStatus: "editing",
  publishedWeekStartDate: null,
  publishedAt: null,
  createdAt: "2026-08-01T00:00:00+09:00",
  updatedAt: "2026-08-06T09:00:00+09:00",
};

function makeDesired(
  id: string,
  staffId: string,
  date: string,
  startTime: string,
  endTime: string,
  note: string
): DesiredShift {
  const breakMinutes = calcBreakMinutes(startTime, endTime);
  return {
    id,
    staffId,
    periodId: defaultPeriod.id,
    date,
    startTime,
    endTime,
    breakMinutes,
    actualMinutes: calcActualMinutes(startTime, endTime, breakMinutes),
    note,
    createdAt: "2026-08-06T09:00:00+09:00",
    updatedAt: "2026-08-06T09:00:00+09:00",
  };
}

const initialDesired: DesiredShift[] = [
  makeDesired("wish-001", "staff-001", "2026-08-10", "09:00", "17:00", "16時まででも対応可能"),
  makeDesired("wish-002", "staff-002", "2026-08-10", "10:00", "15:00", "午前中は別業務あり"),
  makeDesired("wish-003", "staff-003", "2026-08-10", "09:00", "18:00", "フルで対応可能"),
  makeDesired("wish-004", "staff-004", "2026-08-10", "13:00", "18:00", "午後のみ可"),
  makeDesired("wish-005", "staff-005", "2026-08-10", "09:00", "17:00", "通常通り"),
  makeDesired("wish-006", "staff-001", "2026-08-11", "09:00", "16:00", "短縮希望"),
  makeDesired("wish-007", "staff-002", "2026-08-11", "11:00", "19:00", "夕方まで可能"),
];

const initialConfirmed: ConfirmedShift[] = [
  {
    id: "confirm-001",
    staffId: "staff-004",
    periodId: defaultPeriod.id,
    date: "2026-08-12",
    status: "unconfirmed",
    startTime: "13:00",
    endTime: "18:00",
    breakMinutes: 0,
    actualMinutes: 300,
    note: "調整前の配置",
    adminNote: "要確認",
    publishedAt: null,
    createdAt: "2026-08-06T10:00:00+09:00",
    updatedAt: "2026-08-06T10:00:00+09:00",
  },
];

function makeRequired(date: string, people: number): RequiredShiftCount {
  return {
    id: `required-${date}`,
    periodId: defaultPeriod.id,
    date,
    requiredPeople: people,
    requiredMinutes: people * 8 * 60,
    departmentRequiredMinutes: {},
    note: "",
    createdAt: "2026-08-01T00:00:00+09:00",
    updatedAt: "2026-08-01T00:00:00+09:00",
  };
}

const initialRequired: RequiredShiftCount[] = [
  makeRequired("2026-08-10", 6),
  makeRequired("2026-08-11", 4),
  makeRequired("2026-08-12", 5),
  makeRequired("2026-08-13", 5),
  makeRequired("2026-08-14", 4),
  makeRequired("2026-08-15", 3),
  makeRequired("2026-08-16", 3),
];

export function createInitialState(): AppState {
  return {
    staffList,
    departments: defaultDepartments,
    period: defaultPeriod,
    goalBlocksByDate: {},
    desiredShifts: initialDesired,
    confirmedShifts: initialConfirmed,
    requiredShifts: initialRequired,
    homeMessages: [
      {
        id: "msg-demo-001",
        body: "来週の希望登録をお願いします。締め切りは金曜18時です。",
        createdAt: "2026-08-10T10:00:00.000Z",
        createdByStaffId: "staff-900",
        audience: "all",
        team: "",
      },
    ],
    currentUserId: "staff-001",
  };
}
