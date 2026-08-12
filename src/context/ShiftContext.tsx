"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getWeekDates, nowIso, toDateKey } from "@/lib/shift/dates";
import { buildGoalRequiredMinutesByDepartment, normalizeGoalBlocks, DEFAULT_GOAL_DEPARTMENT } from "@/lib/shift/goal";
import { cloneGoalBlocks, getEffectiveGoalBlocks, getRepeatTargetDates, type GoalRepeatRule } from "@/lib/shift/goalRepeat";
import { createInitialState } from "@/lib/shift/seed";
import { DEFAULT_CONTRACT_RENEWAL_MONTHS } from "@/lib/shift/staffEmployment";
import { calcActualMinutes, calcBreakMinutes, isValidTimeRange } from "@/lib/shift/time";
import { createClient } from "@/lib/supabase/client";
import { fetchStaffBootstrap } from "@/lib/supabase/staff";
import type {
  AppState,
  ConfirmedShift,
  DesiredShift,
  HomeMessage,
  RequiredShiftCount,
  SalaryRaise,
  ShiftPeriod,
  Staff,
} from "@/lib/shift/types";

const STORAGE_KEY = "shift-app-state-v1";

type StaffEditableFields = Pick<
  Staff,
  | "name"
  | "firstName"
  | "displayGivenName"
  | "iconLabel"
  | "password"
  | "team"
  | "status"
  | "weeklyContractHours"
  | "socialInsurance"
  | "role"
  | "adminPermission"
  | "hireDate"
  | "contractStartDate"
  | "contractEndDate"
  | "contractRenewalMonths"
  | "hourlyWage"
  | "salaryHistory"
  | "email"
  | "googleEmail"
>;

function normalizeStaff(staff: Staff): Staff {
  const hourlyWage = Number.isFinite(staff.hourlyWage) ? staff.hourlyWage : 0;
  const salaryHistory = Array.isArray(staff.salaryHistory)
    ? staff.salaryHistory.map((entry) => ({
        id: entry.id || `raise-${staff.id}-${entry.effectiveDate}`,
        effectiveDate: entry.effectiveDate ?? "",
        hourlyWage: Number.isFinite(entry.hourlyWage) ? entry.hourlyWage : 0,
        note: entry.note ?? "",
      }))
    : [];
  return {
    ...staff,
    firstName: staff.firstName ?? "",
    displayGivenName: staff.displayGivenName ?? false,
    iconLabel: staff.iconLabel ?? "",
    password: staff.password ?? "",
    adminPermission:
      staff.role === "admin"
        ? staff.adminPermission === "general"
          ? "general"
          : "manager"
        : "general",
    socialInsurance: Boolean(staff.socialInsurance),
    googleEmail: staff.googleEmail ?? "",
    email: staff.email ?? "",
    hireDate: staff.hireDate ?? "",
    contractStartDate: staff.contractStartDate ?? "",
    contractEndDate: staff.contractEndDate ?? "",
    contractRenewalMonths: Number.isFinite(staff.contractRenewalMonths)
      ? Math.max(1, staff.contractRenewalMonths)
      : DEFAULT_CONTRACT_RENEWAL_MONTHS,
    hourlyWage,
    salaryHistory,
  };
}

function normalizeDesiredShift(shift: DesiredShift): DesiredShift {
  const breakMinutes = calcBreakMinutes(shift.startTime, shift.endTime);
  return {
    ...shift,
    breakMinutes,
    actualMinutes: calcActualMinutes(shift.startTime, shift.endTime, breakMinutes),
  };
}

function normalizeConfirmedShift(shift: ConfirmedShift): ConfirmedShift {
  const breakMinutes = calcBreakMinutes(shift.startTime, shift.endTime);
  return {
    ...shift,
    breakMinutes,
    actualMinutes: calcActualMinutes(shift.startTime, shift.endTime, breakMinutes),
  };
}

type WishInput = {
  date: string;
  startTime: string;
  endTime: string;
  note: string;
};

type ShiftStatus = "confirmed" | "unconfirmed";

type ShiftContextValue = {
  ready: boolean;
  /** Supabase Auth でログイン中（デモ切替を出さない） */
  usingSupabaseAuth: boolean;
  state: AppState;
  currentUser: Staff;
  isAdmin: boolean;
  /** マスタ管理を利用できる（管理者かつマネージャー） */
  canManageMaster: boolean;
  workers: Staff[];
  setCurrentUserId: (id: string) => void;
  updatePeriod: (patch: Partial<ShiftPeriod>) => void;
  updateGoalBlockCount: (date: string, blockIndex: number, delta: number) => void;
  updateGoalBlockDepartment: (date: string, blockIndex: number, iconIndex: number, department: string) => void;
  setGoalBlocksForDate: (date: string, blocks: [string[], string[], string[], string[]]) => void;
  applyGoalBlocksRepeat: (sourceDate: string, rule: GoalRepeatRule) => number;
  updateStaff: (staffId: string, patch: Partial<StaffEditableFields>) => void;
  createStaff: (
    input: StaffEditableFields
  ) => Promise<{ ok: true; id: string } | { ok: false; message: string }>;
  refreshStaffFromSupabase: () => Promise<void>;
  addSalaryRaise: (
    staffId: string,
    input: { effectiveDate: string; hourlyWage: number; note: string }
  ) => { ok: true } | { ok: false; message: string };
  deleteStaff: (staffId: string) => void;
  addDepartment: (name: string) => { ok: true } | { ok: false; message: string };
  updateDepartment: (oldName: string, nextName: string) => void;
  deleteDepartment: (name: string) => void;
  upsertDesiredShift: (input: WishInput) => { ok: true } | { ok: false; message: string };
  deleteDesiredShift: (date: string) => { ok: true } | { ok: false; message: string };
  updateDesiredShiftTimes: (
    desiredId: string,
    startTime: string,
    endTime: string
  ) => { ok: true } | { ok: false; message: string };
  addConfirmedFromDesired: (desiredId: string) => void;
  setDesiredShiftStatus: (desiredId: string, status: "adjusting" | "unconfirmed" | "confirmed") => void;
  updateConfirmedShift: (
    id: string,
    patch: Partial<Pick<ConfirmedShift, "startTime" | "endTime" | "adminNote" | "note" | "status">>
  ) => void;
  removeConfirmedShift: (id: string) => void;
  publishConfirmed: (mode: "week" | "day", date?: string, department?: string | "all") => void;
  unpublishConfirmed: (mode: "week" | "day", date?: string, department?: string | "all") => void;
  upsertRequired: (date: string, note: string) => void;
  createHomeMessage: (input: {
    body: string;
    audience: "all" | "team";
    team?: string;
  }) => { ok: true } | { ok: false; message: string };
  deleteHomeMessage: (messageId: string) => void;
  resetDemoData: () => void;
};

const ShiftContext = createContext<ShiftContextValue | null>(null);

function loadState(): AppState {
  if (typeof window === "undefined") return createInitialState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed?.period?.id || !Array.isArray(parsed.desiredShifts)) {
      return createInitialState();
    }
    const parsedGoalBlocks = parsed.goalBlocksByDate ?? {};
    return {
      ...createInitialState(),
      ...parsed,
      staffList: Array.isArray(parsed.staffList) ? parsed.staffList.map(normalizeStaff) : createInitialState().staffList,
      goalBlocksByDate:
        parsedGoalBlocks && typeof parsedGoalBlocks === "object"
          ? Object.fromEntries(
              Object.entries(parsedGoalBlocks).map(([date, blocks]) => [date, normalizeGoalBlocks(blocks)])
            )
          : {},
      departments:
        Array.isArray(parsed.departments) && parsed.departments.length > 0
          ? parsed.departments
          : Array.from(
              new Set((Array.isArray(parsed.staffList) ? parsed.staffList : createInitialState().staffList).map((s) => s.team))
            ),
      period: {
        ...createInitialState().period,
        ...parsed.period,
        publishedWeekStartDate: parsed.period.publishedWeekStartDate ?? null,
      },
      desiredShifts: Array.isArray(parsed.desiredShifts)
        ? parsed.desiredShifts.map(normalizeDesiredShift)
        : createInitialState().desiredShifts,
      confirmedShifts: Array.isArray(parsed.confirmedShifts)
        ? parsed.confirmedShifts.map((shift) =>
            parsed.period.adjustmentStatus === "published"
              ? normalizeConfirmedShift(shift)
              : { ...normalizeConfirmedShift(shift), publishedAt: null }
          )
        : createInitialState().confirmedShifts,
      requiredShifts: Array.isArray(parsed.requiredShifts)
        ? parsed.requiredShifts.map((item) => ({
            ...item,
            departmentRequiredMinutes: item.departmentRequiredMinutes ?? {},
            note: item.note ?? "",
          }))
        : createInitialState().requiredShifts,
      homeMessages: Array.isArray(parsed.homeMessages)
        ? parsed.homeMessages
            .filter((m): m is HomeMessage => Boolean(m && typeof m === "object" && typeof m.id === "string"))
            .map((m) => ({
              id: m.id,
              body: String(m.body ?? ""),
              createdAt: String(m.createdAt ?? ""),
              createdByStaffId: String(m.createdByStaffId ?? ""),
              audience: m.audience === "team" ? "team" : "all",
              team: String(m.team ?? ""),
            }))
        : createInitialState().homeMessages,
    };
  } catch {
    return createInitialState();
  }
}

export function ShiftProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(createInitialState);
  const [ready, setReady] = useState(false);
  const [usingSupabaseAuth, setUsingSupabaseAuth] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const local = loadState();
      if (!cancelled) setState(local);

      try {
        const supabase = createClient();
        const bootstrap = await fetchStaffBootstrap(supabase);
        if (!cancelled && bootstrap && bootstrap.staffList.length > 0) {
          setUsingSupabaseAuth(true);
          setState((prev) => ({
            ...prev,
            staffList: bootstrap.staffList,
            departments:
              bootstrap.departments.length > 0 ? bootstrap.departments : prev.departments,
            currentUserId: bootstrap.userId,
          }));
        }
      } catch (error) {
        console.warn("Supabase staff bootstrap skipped", error);
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    // Auth 同期後もシフト等のローカルデータは保存する
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, ready]);

  const currentUser = useMemo(() => {
    return state.staffList.find((s) => s.id === state.currentUserId) ?? state.staffList[0];
  }, [state.currentUserId, state.staffList]);

  const isAdmin = currentUser?.role === "admin";
  const canManageMaster = Boolean(isAdmin && currentUser?.adminPermission === "manager");
  const workers = useMemo(
    () => state.staffList.filter((s) => s.role === "worker" && s.status === "active"),
    [state.staffList]
  );

  const setCurrentUserId = useCallback(
    (id: string) => {
      if (usingSupabaseAuth) return;
      setState((prev) => ({ ...prev, currentUserId: id }));
    },
    [usingSupabaseAuth]
  );

  const updatePeriod = useCallback((patch: Partial<ShiftPeriod>) => {
    setState((prev) => ({
      ...prev,
      period: { ...prev.period, ...patch, updatedAt: nowIso() },
    }));
  }, []);

  const updateGoalBlockCount = useCallback((date: string, blockIndex: number, delta: number) => {
    setState((prev) => {
      const current = normalizeGoalBlocks(prev.goalBlocksByDate[date]);
      const next = current.map((slots) => [...slots]) as ReturnType<typeof normalizeGoalBlocks>;
      const target = [...next[blockIndex]];
      if (delta > 0) {
        target.push(DEFAULT_GOAL_DEPARTMENT);
      } else if (target.length > 0) {
        target.pop();
      }
      next[blockIndex] = target;
      return {
        ...prev,
        goalBlocksByDate: {
          ...prev.goalBlocksByDate,
          [date]: next,
        },
      };
    });
  }, []);

  const updateGoalBlockDepartment = useCallback(
    (date: string, blockIndex: number, iconIndex: number, department: string) => {
      setState((prev) => {
        const current = normalizeGoalBlocks(prev.goalBlocksByDate[date]);
        const next = current.map((slots) => [...slots]) as ReturnType<typeof normalizeGoalBlocks>;
        if (iconIndex < 0 || iconIndex >= next[blockIndex].length) return prev;
        next[blockIndex][iconIndex] = department;
        return {
          ...prev,
          goalBlocksByDate: {
            ...prev.goalBlocksByDate,
            [date]: next,
          },
        };
      });
    },
    []
  );

  const setGoalBlocksForDate = useCallback((date: string, blocks: ReturnType<typeof normalizeGoalBlocks>) => {
    setState((prev) => ({
      ...prev,
      goalBlocksByDate: {
        ...prev.goalBlocksByDate,
        [date]: normalizeGoalBlocks(blocks),
      },
    }));
  }, []);

  const applyGoalBlocksRepeat = useCallback((sourceDate: string, rule: GoalRepeatRule) => {
    const targetDates = getRepeatTargetDates(sourceDate, rule);
    if (targetDates.length === 0) return 0;

    setState((prev) => {
      const sourceBlocks = getEffectiveGoalBlocks(prev, sourceDate);
      const nextGoalBlocksByDate = { ...prev.goalBlocksByDate };

      for (const date of targetDates) {
        nextGoalBlocksByDate[date] = cloneGoalBlocks(sourceBlocks);
      }

      return {
        ...prev,
        goalBlocksByDate: nextGoalBlocksByDate,
      };
    });

    return targetDates.length;
  }, []);

  const updateStaff = useCallback((staffId: string, patch: Partial<StaffEditableFields>) => {
    setState((prev) => ({
      ...prev,
      staffList: prev.staffList.map((staff) => (staff.id === staffId ? normalizeStaff({ ...staff, ...patch }) : staff)),
      departments:
        patch.team && !prev.departments.includes(patch.team)
          ? [...prev.departments, patch.team]
          : prev.departments,
    }));
  }, []);

  const addSalaryRaise = useCallback(
    (staffId: string, input: { effectiveDate: string; hourlyWage: number; note: string }) => {
      const effectiveDate = input.effectiveDate.trim();
      const hourlyWage = Number(input.hourlyWage);
      if (!effectiveDate) return { ok: false as const, message: "適用日を入力してください" };
      if (!Number.isFinite(hourlyWage) || hourlyWage < 0) {
        return { ok: false as const, message: "時給を正しく入力してください" };
      }

      const entry: SalaryRaise = {
        id: `raise-${staffId}-${Date.now()}`,
        effectiveDate,
        hourlyWage,
        note: input.note.trim(),
      };

      setState((prev) => ({
        ...prev,
        staffList: prev.staffList.map((staff) => {
          if (staff.id !== staffId) return staff;
          return normalizeStaff({
            ...staff,
            hourlyWage,
            salaryHistory: [entry, ...(staff.salaryHistory ?? [])],
          });
        }),
      }));
      return { ok: true as const };
    },
    []
  );

  const addDepartment = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false as const, message: "所属名を入力してください" };
    if (trimmed === DEFAULT_GOAL_DEPARTMENT) {
      return { ok: false as const, message: "リクルーティングは固定の所属です" };
    }
    setState((prev) =>
      prev.departments.includes(trimmed) ? prev : { ...prev, departments: [...prev.departments, trimmed] }
    );
    return { ok: true as const };
  }, []);

  const updateDepartment = useCallback((oldName: string, nextName: string) => {
    if (oldName === DEFAULT_GOAL_DEPARTMENT) return;
    const trimmed = nextName.trim();
    if (!trimmed || oldName === trimmed) return;
    setState((prev) => ({
      ...prev,
      staffList: prev.staffList.map((staff) => (staff.team === oldName ? { ...staff, team: trimmed } : staff)),
      departments: prev.departments.map((department) => (department === oldName ? trimmed : department)),
      goalBlocksByDate: Object.fromEntries(
        Object.entries(prev.goalBlocksByDate).map(([date, blocks]) => [
          date,
          normalizeGoalBlocks(
            normalizeGoalBlocks(blocks).map((slots) =>
              slots.map((department) => (department === oldName ? trimmed : department))
            )
          ),
        ])
      ) as AppState["goalBlocksByDate"],
    }));
  }, []);

  const deleteDepartment = useCallback((name: string) => {
    if (name === DEFAULT_GOAL_DEPARTMENT) return;
    setState((prev) => ({
      ...prev,
      departments: prev.departments.filter((department) => department !== name),
      goalBlocksByDate: Object.fromEntries(
        Object.entries(prev.goalBlocksByDate).map(([date, blocks]) => [
          date,
          normalizeGoalBlocks(
            normalizeGoalBlocks(blocks).map((slots) =>
              slots.map((department) => (department === name ? DEFAULT_GOAL_DEPARTMENT : department))
            )
          ),
        ])
      ) as AppState["goalBlocksByDate"],
    }));
  }, []);

  const createStaff = useCallback(
    async (input: StaffEditableFields) => {
      const email = (input.email ?? "").trim().toLowerCase();
      if (!email) {
        return { ok: false as const, message: "ログイン用メールアドレスを入力してください。" };
      }
      if (!input.password?.trim()) {
        return { ok: false as const, message: "パスワードを入力してください。" };
      }

      if (usingSupabaseAuth) {
        try {
          const response = await fetch("/api/staff", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: input.name,
              firstName: input.firstName,
              email,
              password: input.password,
              team: input.team,
              role: input.role,
              adminPermission: input.adminPermission,
              status: input.status,
              weeklyContractHours: input.weeklyContractHours,
              socialInsurance: input.socialInsurance,
              googleEmail: input.googleEmail,
              hireDate: input.hireDate,
              contractStartDate: input.contractStartDate,
              contractEndDate: input.contractEndDate,
              contractRenewalMonths: input.contractRenewalMonths,
              hourlyWage: input.hourlyWage,
              displayGivenName: input.displayGivenName,
            }),
          });
          const payload = (await response.json()) as { ok: boolean; id?: string; message?: string };
          if (!payload.ok || !payload.id) {
            return { ok: false as const, message: payload.message || "スタッフ作成に失敗しました。" };
          }
          const supabase = createClient();
          const bootstrap = await fetchStaffBootstrap(supabase);
          if (bootstrap) {
            setState((prev) => ({
              ...prev,
              staffList: bootstrap.staffList,
              departments:
                bootstrap.departments.length > 0 ? bootstrap.departments : prev.departments,
              currentUserId: bootstrap.userId,
            }));
          }
          return { ok: true as const, id: payload.id };
        } catch (error) {
          return {
            ok: false as const,
            message: error instanceof Error ? error.message : "スタッフ作成に失敗しました。",
          };
        }
      }

      const id = `staff-${Date.now()}`;
      const hireDate = input.hireDate ?? "";
      const hourlyWage = Number.isFinite(input.hourlyWage) ? input.hourlyWage : 0;
      const salaryHistory =
        input.salaryHistory && input.salaryHistory.length > 0
          ? input.salaryHistory
          : hourlyWage > 0 && hireDate
            ? [
                {
                  id: `raise-${id}-init`,
                  effectiveDate: hireDate,
                  hourlyWage,
                  note: "初任給",
                },
              ]
            : [];
      setState((prev) => ({
        ...prev,
        staffList: [
          ...prev.staffList,
          normalizeStaff({
            id,
            ...input,
            email,
            adminPermission:
              input.role === "admin"
                ? input.adminPermission === "general"
                  ? "general"
                  : "manager"
                : "general",
            hireDate,
            contractStartDate: input.contractStartDate ?? "",
            contractEndDate: input.contractEndDate ?? "",
            contractRenewalMonths: input.contractRenewalMonths ?? DEFAULT_CONTRACT_RENEWAL_MONTHS,
            hourlyWage,
            socialInsurance: Boolean(input.socialInsurance),
            googleEmail: input.googleEmail ?? "",
            salaryHistory,
          }),
        ],
        departments: prev.departments.includes(input.team) ? prev.departments : [...prev.departments, input.team],
      }));
      return { ok: true as const, id };
    },
    [usingSupabaseAuth]
  );

  const refreshStaffFromSupabase = useCallback(async () => {
    if (!usingSupabaseAuth) return;
    try {
      const supabase = createClient();
      const bootstrap = await fetchStaffBootstrap(supabase);
      if (!bootstrap) return;
      setState((prev) => ({
        ...prev,
        staffList: bootstrap.staffList,
        departments: bootstrap.departments.length > 0 ? bootstrap.departments : prev.departments,
        currentUserId: bootstrap.userId,
      }));
    } catch (error) {
      console.warn("refreshStaffFromSupabase failed", error);
    }
  }, [usingSupabaseAuth]);

  const deleteStaff = useCallback((staffId: string) => {
    setState((prev) => {
      const nextStaffList = prev.staffList.filter((staff) => staff.id !== staffId);
      const nextCurrentUserId =
        prev.currentUserId === staffId ? nextStaffList[0]?.id ?? prev.currentUserId : prev.currentUserId;
      return {
        ...prev,
        currentUserId: nextCurrentUserId,
        staffList: nextStaffList,
        desiredShifts: prev.desiredShifts.filter((shift) => shift.staffId !== staffId),
        confirmedShifts: prev.confirmedShifts.filter((shift) => shift.staffId !== staffId),
      };
    });
  }, []);

  const upsertDesiredShift = useCallback(
    (input: WishInput) => {
      if (!isValidTimeRange(input.startTime, input.endTime)) {
        return { ok: false as const, message: "終了時刻は開始時刻より後にしてください" };
      }
      const breakMinutes = calcBreakMinutes(input.startTime, input.endTime);
      const actualMinutes = calcActualMinutes(input.startTime, input.endTime, breakMinutes);
      const now = nowIso();

      setState((prev) => {
        const existing = prev.desiredShifts.find(
          (s) => s.staffId === prev.currentUserId && s.date === input.date
        );
        const confirmedShift = prev.confirmedShifts.find(
          (s) =>
            s.staffId === prev.currentUserId &&
            s.date === input.date &&
            s.status === "confirmed"
        );
        const shouldMarkAdjusting = Boolean(confirmedShift);

        if (existing) {
          return {
            ...prev,
            desiredShifts: prev.desiredShifts.map((s) =>
              s.id === existing.id
                ? {
                    ...s,
                    startTime: input.startTime,
                    endTime: input.endTime,
                    breakMinutes,
                    actualMinutes,
                    note: input.note,
                    updatedAt: now,
                  }
                : s
            ),
            confirmedShifts: shouldMarkAdjusting
              ? prev.confirmedShifts.map((s) =>
                  s.id === confirmedShift!.id
                    ? { ...s, status: "adjusting" as const, updatedAt: now }
                    : s
                )
              : prev.confirmedShifts,
            period: shouldMarkAdjusting
              ? { ...prev.period, adjustmentStatus: "adjusting" as const, updatedAt: now }
              : prev.period,
          };
        }
        const created: DesiredShift = {
          id: `wish-${prev.currentUserId}-${input.date}`,
          staffId: prev.currentUserId,
          periodId: prev.period.id,
          date: input.date,
          startTime: input.startTime,
          endTime: input.endTime,
          breakMinutes,
          actualMinutes,
          note: input.note,
          createdAt: now,
          updatedAt: now,
        };
        return {
          ...prev,
          desiredShifts: [...prev.desiredShifts, created],
          confirmedShifts: shouldMarkAdjusting
            ? prev.confirmedShifts.map((s) =>
                s.id === confirmedShift!.id
                  ? { ...s, status: "adjusting" as const, updatedAt: now }
                  : s
              )
            : prev.confirmedShifts,
          period: shouldMarkAdjusting
            ? { ...prev.period, adjustmentStatus: "adjusting" as const, updatedAt: now }
            : prev.period,
        };
      });

      return { ok: true as const };
    },
    [state.period]
  );

  const deleteDesiredShift = useCallback(
    (date: string) => {
      setState((prev) => {
        const now = nowIso();
        const confirmedShift = prev.confirmedShifts.find(
          (s) =>
            s.staffId === prev.currentUserId &&
            s.date === date &&
            s.status === "confirmed"
        );
        return {
          ...prev,
          desiredShifts: prev.desiredShifts.filter(
            (s) => !(s.staffId === prev.currentUserId && s.date === date)
          ),
          confirmedShifts: confirmedShift
            ? prev.confirmedShifts.map((s) =>
                s.id === confirmedShift.id
                  ? { ...s, status: "adjusting" as const, updatedAt: now }
                  : s
              )
            : prev.confirmedShifts,
          period: confirmedShift
            ? { ...prev.period, adjustmentStatus: "adjusting" as const, updatedAt: now }
            : prev.period,
        };
      });
      return { ok: true as const };
    },
    []
  );

  const updateDesiredShiftTimes = useCallback((desiredId: string, startTime: string, endTime: string) => {
    if (!isValidTimeRange(startTime, endTime)) {
      return { ok: false as const, message: "終了時刻は開始時刻より後にしてください" };
    }

    const breakMinutes = calcBreakMinutes(startTime, endTime);
    const actualMinutes = calcActualMinutes(startTime, endTime, breakMinutes);
    const now = nowIso();

    setState((prev) => {
      const desired = prev.desiredShifts.find((s) => s.id === desiredId);
      if (!desired) return prev;
      const existingConfirmed = prev.confirmedShifts.find(
        (s) => s.staffId === desired.staffId && s.date === desired.date
      );
      const shouldMarkAdjusting = existingConfirmed?.status === "confirmed";

      return {
        ...prev,
        desiredShifts: prev.desiredShifts.map((s) =>
          s.id === desiredId
            ? {
                ...s,
                startTime,
                endTime,
                breakMinutes,
                actualMinutes,
                updatedAt: now,
              }
            : s
        ),
        confirmedShifts: prev.confirmedShifts.map((s) =>
          s.staffId === desired.staffId && s.date === desired.date
            ? {
                ...s,
                startTime,
                endTime,
                breakMinutes,
                actualMinutes,
                status: shouldMarkAdjusting ? ("adjusting" as const) : s.status,
                updatedAt: now,
              }
            : s
        ),
        period: shouldMarkAdjusting || existingConfirmed
          ? { ...prev.period, adjustmentStatus: "adjusting", updatedAt: now }
          : prev.period,
      };
    });

    return { ok: true as const };
  }, []);

  const setDesiredShiftStatus = useCallback((desiredId: string, status: "adjusting" | "unconfirmed" | "confirmed") => {
    setState((prev) => {
      const desired = prev.desiredShifts.find((s) => s.id === desiredId);
      if (!desired) return prev;
      const existing = prev.confirmedShifts.find(
        (s) => s.staffId === desired.staffId && s.date === desired.date
      );
      const now = nowIso();

      if (status === "adjusting") {
        if (existing) {
          return {
            ...prev,
            confirmedShifts: prev.confirmedShifts.map((s) =>
              s.id === existing.id ? { ...s, status: "adjusting" as const, updatedAt: now } : s
            ),
            period: { ...prev.period, adjustmentStatus: "adjusting", updatedAt: now },
          };
        }
        return {
          ...prev,
          period: { ...prev.period, adjustmentStatus: "adjusting", updatedAt: now },
        };
      }

      if (existing) {
        const updatedConfirmed: ConfirmedShift =
          status === "confirmed"
            ? {
                ...existing,
                status,
                startTime: desired.startTime,
                endTime: desired.endTime,
                breakMinutes: desired.breakMinutes,
                actualMinutes: desired.actualMinutes,
                note: desired.note,
                updatedAt: now,
              }
            : { ...existing, status, updatedAt: now };
        return {
          ...prev,
          confirmedShifts: prev.confirmedShifts.map((s) =>
            s.id === existing.id ? updatedConfirmed : s
          ),
          period: { ...prev.period, adjustmentStatus: "adjusting", updatedAt: now },
        };
      }

      const created: ConfirmedShift = {
        id: `confirm-${desired.staffId}-${desired.date}`,
        staffId: desired.staffId,
        periodId: desired.periodId,
        date: desired.date,
        status,
        startTime: desired.startTime,
        endTime: desired.endTime,
        breakMinutes: desired.breakMinutes,
        actualMinutes: desired.actualMinutes,
        note: desired.note,
        adminNote: "",
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      return {
        ...prev,
        confirmedShifts: [...prev.confirmedShifts, created],
        period: { ...prev.period, adjustmentStatus: "adjusting", updatedAt: now },
      };
    });
  }, []);

  const addConfirmedFromDesired = useCallback((desiredId: string) => {
    setDesiredShiftStatus(desiredId, "confirmed");
  }, [setDesiredShiftStatus]);

  const updateConfirmedShift = useCallback(
    (
      id: string,
      patch: Partial<Pick<ConfirmedShift, "startTime" | "endTime" | "adminNote" | "note" | "status">>
    ) => {
      const now = nowIso();
      setState((prev) => ({
        ...prev,
        confirmedShifts: prev.confirmedShifts.map((s) => {
          if (s.id !== id) return s;
          const startTime = patch.startTime ?? s.startTime;
          const endTime = patch.endTime ?? s.endTime;
          const breakMinutes = calcBreakMinutes(startTime, endTime);
          return {
            ...s,
            ...patch,
            status: (patch.status ?? s.status) as ConfirmedShift["status"],
            startTime,
            endTime,
            breakMinutes,
            actualMinutes: calcActualMinutes(startTime, endTime, breakMinutes),
            updatedAt: now,
          };
        }),
        period: patch.status
          ? { ...prev.period, adjustmentStatus: "adjusting", updatedAt: now }
          : prev.period,
      }));
    },
    []
  );

  const removeConfirmedShift = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      confirmedShifts: prev.confirmedShifts.filter((s) => s.id !== id),
    }));
  }, []);

  const publishConfirmed = useCallback((mode: "week" | "day", date?: string, department?: string | "all") => {
    const now = nowIso();
    const targetDates = mode === "week" && date ? getWeekDates(date) : date ? [date] : [];
    setState((prev) => {
      const departmentFilter = department && department !== "all" ? department : null;
      const targetWorkers = prev.staffList.filter(
        (staff) => staff.role === "worker" && staff.status === "active" && (!departmentFilter || staff.team === departmentFilter)
      );
      const nextConfirmedMap = new Map(prev.confirmedShifts.map((shift) => [`${shift.staffId}-${shift.date}`, shift] as const));

      for (const staff of targetWorkers) {
        for (const dateKey of targetDates) {
          const desired = prev.desiredShifts.find((shift) => shift.staffId === staff.id && shift.date === dateKey);
          const existing = nextConfirmedMap.get(`${staff.id}-${dateKey}`);
          const nextStatus: ConfirmedShift["status"] = desired ? "confirmed" : "unconfirmed";
          const nextShift: ConfirmedShift = existing
            ? {
                ...existing,
                status: nextStatus,
                startTime: desired?.startTime ?? existing.startTime ?? "00:00",
                endTime: desired?.endTime ?? existing.endTime ?? "00:00",
                breakMinutes: desired?.breakMinutes ?? 0,
                actualMinutes: desired?.actualMinutes ?? 0,
                note: desired?.note ?? existing.note ?? "",
                publishedAt: now,
                updatedAt: now,
              }
            : {
                id: `confirm-${staff.id}-${dateKey}`,
                staffId: staff.id,
                periodId: prev.period.id,
                date: dateKey,
                status: nextStatus,
                startTime: desired?.startTime ?? "00:00",
                endTime: desired?.endTime ?? "00:00",
                breakMinutes: desired?.breakMinutes ?? 0,
                actualMinutes: desired?.actualMinutes ?? 0,
                note: desired?.note ?? "",
                adminNote: "",
                publishedAt: now,
                createdAt: now,
                updatedAt: now,
              };
          nextConfirmedMap.set(`${staff.id}-${dateKey}`, nextShift);
        }
      }

      return {
        ...prev,
        confirmedShifts: Array.from(nextConfirmedMap.values()),
        period: {
          ...prev.period,
          publishedWeekStartDate: mode === "week" ? date ?? prev.period.publishedWeekStartDate : prev.period.publishedWeekStartDate,
          publishedAt: mode === "week" ? now : prev.period.publishedAt,
          adjustmentStatus: "published",
          updatedAt: now,
        },
      };
    });
  }, []);

  const unpublishConfirmed = useCallback((mode: "week" | "day", date?: string, department?: string | "all") => {
    const targetDates = mode === "week" && date ? new Set(getWeekDates(date)) : null;
    setState((prev) => ({
      ...prev,
      confirmedShifts: prev.confirmedShifts.map((s) => {
        if (mode === "day" && s.date !== date) return s;
        if (targetDates && !targetDates.has(s.date)) return s;
        if (department && department !== "all") {
          const staff = prev.staffList.find((item) => item.id === s.staffId);
          if (!staff || staff.team !== department) return s;
        }
        if (s.status !== "confirmed" && s.status !== "unconfirmed") return s;
        return { ...s, publishedAt: null, updatedAt: nowIso() };
      }),
      period:
        mode === "week"
          ? { ...prev.period, publishedWeekStartDate: null, publishedAt: null, updatedAt: nowIso() }
          : prev.period,
    }));
  }, []);

  const upsertRequired = useCallback((date: string, note: string) => {
    setState((prev) => {
      const existing = prev.requiredShifts.find((s) => s.date === date);
      const goalBlocks = normalizeGoalBlocks(prev.goalBlocksByDate[date]);
      const requiredMinutes = Object.values(buildGoalRequiredMinutesByDepartment(goalBlocks)).reduce(
        (total, minutes) => total + minutes,
        0
      );
      const now = nowIso();
      if (existing) {
        return {
          ...prev,
          requiredShifts: prev.requiredShifts.map((s) =>
            s.date === date
              ? {
                  ...s,
                  requiredMinutes,
                  note,
                  updatedAt: now,
                }
              : s
          ),
        };
      }
      const created: RequiredShiftCount = {
        id: `required-${date}`,
        periodId: prev.period.id,
        date,
        requiredPeople: 0,
        requiredMinutes,
        departmentRequiredMinutes: {},
        note,
        createdAt: now,
        updatedAt: now,
      };
      return { ...prev, requiredShifts: [...prev.requiredShifts, created] };
    });
  }, []);

  const createHomeMessage = useCallback(
    (input: { body: string; audience: "all" | "team"; team?: string }) => {
      const body = input.body.trim();
      if (!body) return { ok: false as const, message: "メッセージを入力してください。" };
      if (input.audience === "team" && !input.team?.trim()) {
        return { ok: false as const, message: "所属を選択してください。" };
      }
      setState((prev) => {
        const message: HomeMessage = {
          id: `msg-${Date.now()}`,
          body,
          createdAt: nowIso(),
          createdByStaffId: prev.currentUserId,
          audience: input.audience,
          team: input.audience === "team" ? input.team!.trim() : "",
        };
        return { ...prev, homeMessages: [message, ...(prev.homeMessages ?? [])] };
      });
      return { ok: true as const };
    },
    []
  );

  const deleteHomeMessage = useCallback((messageId: string) => {
    setState((prev) => ({
      ...prev,
      homeMessages: (prev.homeMessages ?? []).filter((m) => m.id !== messageId),
    }));
  }, []);

  const resetDemoData = useCallback(() => {
    const next = createInitialState();
    setState(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const value: ShiftContextValue = {
    ready,
    usingSupabaseAuth,
    state,
    currentUser: currentUser ?? state.staffList[0],
    isAdmin,
    canManageMaster,
    workers,
    setCurrentUserId,
    updatePeriod,
    updateGoalBlockCount,
    updateGoalBlockDepartment,
    setGoalBlocksForDate,
    applyGoalBlocksRepeat,
    updateStaff,
    createStaff,
    refreshStaffFromSupabase,
    addSalaryRaise,
    deleteStaff,
    addDepartment,
    updateDepartment,
    deleteDepartment,
    upsertDesiredShift,
    deleteDesiredShift,
    addConfirmedFromDesired,
    setDesiredShiftStatus,
    updateDesiredShiftTimes,
    updateConfirmedShift,
    removeConfirmedShift,
    publishConfirmed,
    unpublishConfirmed,
    upsertRequired,
    createHomeMessage,
    deleteHomeMessage,
    resetDemoData,
  };

  return <ShiftContext.Provider value={value}>{children}</ShiftContext.Provider>;
}

export function useShift() {
  const ctx = useContext(ShiftContext);
  if (!ctx) throw new Error("useShift must be used within ShiftProvider");
  return ctx;
}
