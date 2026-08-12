"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getWeekDates, nowIso, toDateKey } from "@/lib/shift/dates";
import {
  buildGoalRequiredMinutesByDepartment,
  normalizeGoalBlocks,
  DEFAULT_GOAL_DEPARTMENT,
  isFixedDepartmentName,
} from "@/lib/shift/goal";
import { cloneGoalBlocks, getEffectiveGoalBlocks, getRepeatTargetDates, type GoalRepeatRule } from "@/lib/shift/goalRepeat";
import {
  canManageAdminAccounts,
  canManageMaster as hasMasterPermission,
  normalizeAdminPermission,
} from "@/lib/shift/permissions";
import { createInitialState } from "@/lib/shift/seed";
import { isAttendanceStatus } from "@/lib/shift/status";
import { DEFAULT_CONTRACT_RENEWAL_MONTHS } from "@/lib/shift/staffEmployment";
import { calcActualMinutes, calcBreakMinutes, isValidTimeRange } from "@/lib/shift/time";
import { createClient } from "@/lib/supabase/client";
import {
  fetchStaffBootstrap,
  persistSalaryRaise,
  persistSalaryRaiseUpdate,
  persistStaffDelete,
  persistStaffUpdate,
  type StaffPersistPatch,
} from "@/lib/supabase/staff";
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
  | "managedTeams"
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
  | "note"
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
    managedTeams:
      staff.role === "admin"
        ? Array.isArray(staff.managedTeams)
          ? staff.managedTeams.filter((team) => Boolean(team?.trim()) && team !== "本部")
          : []
        : [],
    adminPermission: normalizeAdminPermission(staff.role, staff.adminPermission),
    socialInsurance: Boolean(staff.socialInsurance),
    googleEmail: staff.googleEmail ?? "",
    email: staff.email ?? "",
    note: staff.note ?? "",
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
  currentUser: Staff | undefined;
  isAdmin: boolean;
  /** マスタ管理を利用できる（マネージャー / アルバイト管理者） */
  canManageMaster: boolean;
  /** 管理者アカウントを管理できる（マネージャーのみ） */
  canManageAdminAccounts: boolean;
  workers: Staff[];
  setCurrentUserId: (id: string) => void;
  updatePeriod: (patch: Partial<ShiftPeriod>) => void;
  updateGoalBlockCount: (date: string, blockIndex: number, delta: number) => void;
  updateGoalBlockDepartment: (date: string, blockIndex: number, iconIndex: number, department: string) => void;
  setGoalBlocksForDate: (date: string, blocks: [string[], string[], string[], string[]]) => void;
  applyGoalBlocksRepeat: (sourceDate: string, rule: GoalRepeatRule) => number;
  updateStaff: (staffId: string, patch: Partial<StaffEditableFields>) => void;
  changeStaffPassword: (
    staffId: string,
    password: string
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  createStaff: (
    input: StaffEditableFields
  ) => Promise<{ ok: true; id: string } | { ok: false; message: string }>;
  refreshStaffFromSupabase: () => Promise<void>;
  addSalaryRaise: (
    staffId: string,
    input: { effectiveDate: string; hourlyWage: number; note: string }
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  updateSalaryRaise: (
    staffId: string,
    raiseId: string,
    input: { effectiveDate: string; hourlyWage: number; note: string }
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  deleteStaff: (staffId: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  addDepartment: (name: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  updateDepartment: (
    oldName: string,
    nextName: string
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  deleteDepartment: (name: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  upsertDesiredShift: (input: WishInput) => { ok: true } | { ok: false; message: string };
  deleteDesiredShift: (date: string) => { ok: true } | { ok: false; message: string };
  updateDesiredShiftTimes: (
    desiredId: string,
    startTime: string,
    endTime: string
  ) => { ok: true } | { ok: false; message: string };
  addConfirmedFromDesired: (desiredId: string) => void;
  setDesiredShiftStatus: (desiredId: string, status: ConfirmedShift["status"]) => void;
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

async function detectSupabaseSession(): Promise<boolean> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return Boolean(user);
  } catch {
    return false;
  }
}

export function ShiftProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(createInitialState);
  const [ready, setReady] = useState(false);
  const [usingSupabaseAuth, setUsingSupabaseAuth] = useState(false);
  const usingSupabaseAuthRef = useRef(false);
  const staffPersistTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const staffPersistPatches = useRef<Record<string, StaffPersistPatch>>({});

  const flushStaffPersists = useCallback(async () => {
    const entries = Object.entries(staffPersistPatches.current);
    for (const [staffId, timer] of Object.entries(staffPersistTimers.current)) {
      clearTimeout(timer);
      delete staffPersistTimers.current[staffId];
    }
    staffPersistPatches.current = {};
    if (!usingSupabaseAuthRef.current || entries.length === 0) return;
    try {
      const supabase = createClient();
      await Promise.all(
        entries.map(async ([staffId, patch]) => {
          const result = await persistStaffUpdate(supabase, staffId, patch);
          if (!result.ok) {
            console.error("staff_profiles update failed", result.message);
          }
        })
      );
    } catch (error) {
      console.error("staff_profiles flush failed", error);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let authSubscription: { unsubscribe: () => void } | null = null;

    async function applyAuthUser(userId: string | null) {
      const local = loadState();

      if (!userId) {
        usingSupabaseAuthRef.current = false;
        if (!cancelled) {
          setUsingSupabaseAuth(false);
          // 前ユーザーの表示が残らないようにスタッフ情報は捨てる
          setState({
            ...local,
            staffList: [],
            departments: local.departments ?? [],
            currentUserId: "",
          });
          setReady(true);
        }
        return;
      }

      try {
        const supabase = createClient();
        usingSupabaseAuthRef.current = true;
        if (!cancelled) {
          setUsingSupabaseAuth(true);
          setReady(false);
        }

        const bootstrap = await fetchStaffBootstrap(supabase);
        if (cancelled) return;

        const staffList = bootstrap?.staffList ?? [];

        setState({
          ...local,
          staffList,
          departments: bootstrap?.departments ?? [],
          // Auth の user id を必ず正とする（前ユーザーの currentUserId を引きずらない）
          currentUserId: userId,
        });
      } catch (error) {
        console.warn("Supabase staff bootstrap skipped", error);
        if (!cancelled) {
          setState({
            ...local,
            staffList: [],
            departments: [],
            currentUserId: userId,
          });
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    async function boot() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        await applyAuthUser(user?.id ?? null);

        const { data } = supabase.auth.onAuthStateChange((event, session) => {
          // 初回は getUser 側で処理済み。以降のログイン/ログアウトで必ず差し替える
          if (event === "INITIAL_SESSION") return;
          if (
            event === "SIGNED_IN" ||
            event === "SIGNED_OUT" ||
            event === "TOKEN_REFRESHED" ||
            event === "USER_UPDATED"
          ) {
            void applyAuthUser(session?.user?.id ?? null);
          }
        });
        authSubscription = data.subscription;
      } catch (error) {
        console.warn("Supabase auth boot failed", error);
        if (!cancelled) {
          setUsingSupabaseAuth(false);
          setState(loadState());
          setReady(true);
        }
      }
    }

    void boot();
    return () => {
      cancelled = true;
      authSubscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    // シフト等はローカル保存。Supabase 利用時はスタッフ/所属を localStorage に残さない
    const toStore = usingSupabaseAuth
      ? {
          ...state,
          staffList: [],
          departments: [],
        }
      : state;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  }, [state, ready, usingSupabaseAuth]);

  useEffect(() => {
    const onHide = () => {
      void flushStaffPersists();
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onHide);
      void flushStaffPersists();
    };
  }, [flushStaffPersists]);

  const currentUser = useMemo((): Staff | undefined => {
    const matched = state.staffList.find((s) => s.id === state.currentUserId);
    if (matched) return matched;
    // Supabase ログイン中は別ユーザーへフォールバックしない（前の管理者名が残るのを防ぐ）
    if (usingSupabaseAuth) return undefined;
    return state.staffList[0];
  }, [state.currentUserId, state.staffList, usingSupabaseAuth]);

  const isAdmin = currentUser?.role === "admin";
  const canManageMaster = Boolean(isAdmin && hasMasterPermission(currentUser?.adminPermission));
  const canManageAdmins = Boolean(isAdmin && canManageAdminAccounts(currentUser?.adminPermission));
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
    setState((prev) => {
      const target = prev.staffList.find((staff) => staff.id === staffId);
      const actor = prev.staffList.find((staff) => staff.id === prev.currentUserId);
      if (
        target?.role === "admin" &&
        actor?.role === "admin" &&
        !canManageAdminAccounts(actor.adminPermission)
      ) {
        window.alert("管理者アカウントの変更はマネージャーのみ可能です。");
        return prev;
      }
      if (
        (patch.role === "admin" || patch.adminPermission !== undefined) &&
        actor?.role === "admin" &&
        !canManageAdminAccounts(actor.adminPermission)
      ) {
        window.alert("管理者権限の変更はマネージャーのみ可能です。");
        return prev;
      }

      return {
        ...prev,
        staffList: prev.staffList.map((staff) =>
          staff.id === staffId ? normalizeStaff({ ...staff, ...patch }) : staff
        ),
        // Supabase 利用時は departments テーブルの内容だけを正とする（所属名の勝手な追加はしない）
        departments:
          !usingSupabaseAuthRef.current && patch.team && !prev.departments.includes(patch.team)
            ? [...prev.departments, patch.team]
            : prev.departments,
      };
    });

    if (!usingSupabaseAuthRef.current) return;

    const { password: _password, salaryHistory: _salaryHistory, ...persistable } = patch;
    if (Object.keys(persistable).length === 0) return;

    staffPersistPatches.current[staffId] = {
      ...staffPersistPatches.current[staffId],
      ...persistable,
    };
    if (staffPersistTimers.current[staffId]) {
      clearTimeout(staffPersistTimers.current[staffId]);
    }
    staffPersistTimers.current[staffId] = setTimeout(() => {
      const merged = staffPersistPatches.current[staffId];
      delete staffPersistPatches.current[staffId];
      delete staffPersistTimers.current[staffId];
      if (!merged) return;
      void (async () => {
        try {
          const { email: nextEmail, ...profilePatch } = merged;
          if (typeof nextEmail === "string") {
            const email = nextEmail.trim().toLowerCase();
            if (email) {
              const response = await fetch("/api/staff", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: staffId, email }),
              });
              const payload = (await response.json()) as { ok: boolean; message?: string };
              if (!payload.ok) {
                window.alert(payload.message || "メールアドレスの更新に失敗しました。");
                return;
              }
            }
          }

          if (Object.keys(profilePatch).length === 0) return;

          const supabase = createClient();
          const result = await persistStaffUpdate(supabase, staffId, profilePatch);
          if (!result.ok) {
            console.error("staff_profiles update failed", result.message);
            window.alert(`スタッフ情報の保存に失敗しました: ${result.message}`);
          }
        } catch (error) {
          console.error("staff_profiles update failed", error);
          window.alert("スタッフ情報の保存に失敗しました。");
        }
      })();
    }, 300);
  }, []);

  const changeStaffPassword = useCallback(async (staffId: string, nextPassword: string) => {
    const password = nextPassword.trim();
    if (!password) {
      return { ok: false as const, message: "新しいパスワードを入力してください。" };
    }
    if (password.length < 6) {
      return { ok: false as const, message: "パスワードは6文字以上にしてください。" };
    }

    const target = state.staffList.find((staff) => staff.id === staffId);
    const actor = state.staffList.find((staff) => staff.id === state.currentUserId);
    if (
      target?.role === "admin" &&
      actor?.role === "admin" &&
      !canManageAdminAccounts(actor.adminPermission)
    ) {
      return { ok: false as const, message: "管理者アカウントのパスワード変更はマネージャーのみ可能です。" };
    }

    if (usingSupabaseAuthRef.current || (await detectSupabaseSession())) {
      usingSupabaseAuthRef.current = true;
      setUsingSupabaseAuth(true);
      try {
        const response = await fetch("/api/staff", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: staffId, password }),
        });
        const payload = (await response.json()) as { ok: boolean; message?: string };
        if (!payload.ok) {
          return { ok: false as const, message: payload.message || "パスワードの更新に失敗しました。" };
        }
        setState((prev) => ({
          ...prev,
          staffList: prev.staffList.map((staff) =>
            staff.id === staffId ? normalizeStaff({ ...staff, password: "" }) : staff
          ),
        }));
        return { ok: true as const };
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : "パスワードの更新に失敗しました。",
        };
      }
    }

    setState((prev) => ({
      ...prev,
      staffList: prev.staffList.map((staff) =>
        staff.id === staffId ? normalizeStaff({ ...staff, password }) : staff
      ),
    }));
    return { ok: true as const };
  }, [state.currentUserId, state.staffList]);

  const addSalaryRaise = useCallback(
    async (staffId: string, input: { effectiveDate: string; hourlyWage: number; note: string }) => {
      const effectiveDate = input.effectiveDate.trim();
      const hourlyWage = Number(input.hourlyWage);
      if (!effectiveDate) return { ok: false as const, message: "適用日を入力してください" };
      if (!Number.isFinite(hourlyWage) || hourlyWage < 0) {
        return { ok: false as const, message: "時給を正しく入力してください" };
      }

      const note = input.note.trim();

      if (usingSupabaseAuthRef.current || (await detectSupabaseSession())) {
        usingSupabaseAuthRef.current = true;
        setUsingSupabaseAuth(true);
        try {
          const supabase = createClient();
          const result = await persistSalaryRaise(supabase, staffId, {
            effectiveDate,
            hourlyWage,
            note,
          });
          if (!result.ok) {
            return { ok: false as const, message: result.message };
          }
          const entry: SalaryRaise = {
            id: result.id,
            effectiveDate,
            hourlyWage,
            note,
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
        } catch (error) {
          return {
            ok: false as const,
            message: error instanceof Error ? error.message : "昇給の保存に失敗しました。",
          };
        }
      }

      const entry: SalaryRaise = {
        id: `raise-${staffId}-${Date.now()}`,
        effectiveDate,
        hourlyWage,
        note,
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

  const updateSalaryRaise = useCallback(
    async (
      staffId: string,
      raiseId: string,
      input: { effectiveDate: string; hourlyWage: number; note: string }
    ) => {
      const effectiveDate = input.effectiveDate.trim();
      const hourlyWage = Number(input.hourlyWage);
      if (!effectiveDate) return { ok: false as const, message: "適用日を入力してください" };
      if (!Number.isFinite(hourlyWage) || hourlyWage < 0) {
        return { ok: false as const, message: "時給を正しく入力してください" };
      }
      const note = input.note.trim();

      if (usingSupabaseAuthRef.current || (await detectSupabaseSession())) {
        usingSupabaseAuthRef.current = true;
        setUsingSupabaseAuth(true);
        try {
          const supabase = createClient();
          const result = await persistSalaryRaiseUpdate(supabase, staffId, raiseId, {
            effectiveDate,
            hourlyWage,
            note,
          });
          if (!result.ok) {
            return { ok: false as const, message: result.message };
          }
          setState((prev) => ({
            ...prev,
            staffList: prev.staffList.map((staff) => {
              if (staff.id !== staffId) return staff;
              const isSynthetic = raiseId.startsWith("initial-");
              const nextHistory = isSynthetic
                ? [
                    { id: result.id, effectiveDate, hourlyWage, note },
                    ...(staff.salaryHistory ?? []).filter((entry) => entry.id !== raiseId),
                  ]
                : (staff.salaryHistory ?? []).map((entry) =>
                    entry.id === raiseId ? { ...entry, effectiveDate, hourlyWage, note } : entry
                  );
              const latest = [...nextHistory].sort((a, b) =>
                b.effectiveDate.localeCompare(a.effectiveDate)
              )[0];
              return normalizeStaff({
                ...staff,
                hourlyWage: latest?.hourlyWage ?? hourlyWage,
                salaryHistory: nextHistory,
              });
            }),
          }));
          return { ok: true as const };
        } catch (error) {
          return {
            ok: false as const,
            message: error instanceof Error ? error.message : "昇給履歴の更新に失敗しました。",
          };
        }
      }

      setState((prev) => ({
        ...prev,
        staffList: prev.staffList.map((staff) => {
          if (staff.id !== staffId) return staff;
          const isSynthetic = raiseId.startsWith("initial-");
          const nextId = isSynthetic ? `raise-${staffId}-${Date.now()}` : raiseId;
          const nextHistory = isSynthetic
            ? [
                { id: nextId, effectiveDate, hourlyWage, note },
                ...(staff.salaryHistory ?? []).filter((entry) => entry.id !== raiseId),
              ]
            : (staff.salaryHistory ?? []).map((entry) =>
                entry.id === raiseId ? { ...entry, effectiveDate, hourlyWage, note } : entry
              );
          const latest = [...nextHistory].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
          return normalizeStaff({
            ...staff,
            hourlyWage: latest?.hourlyWage ?? hourlyWage,
            salaryHistory: nextHistory,
          });
        }),
      }));
      return { ok: true as const };
    },
    []
  );

  const addDepartment = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false as const, message: "所属名を入力してください" };
    if (isFixedDepartmentName(trimmed)) {
      return { ok: false as const, message: `${trimmed}は固定の所属です` };
    }

    if (usingSupabaseAuthRef.current || (await detectSupabaseSession())) {
      usingSupabaseAuthRef.current = true;
      setUsingSupabaseAuth(true);
      try {
        const response = await fetch("/api/departments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        });
        const payload = (await response.json()) as { ok: boolean; message?: string };
        if (!payload.ok) {
          return { ok: false as const, message: payload.message || "所属の追加に失敗しました。" };
        }
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : "所属の追加に失敗しました。",
        };
      }
    }

    setState((prev) =>
      prev.departments.includes(trimmed) ? prev : { ...prev, departments: [...prev.departments, trimmed] }
    );
    return { ok: true as const };
  }, []);

  const updateDepartment = useCallback(async (oldName: string, nextName: string) => {
    if (isFixedDepartmentName(oldName)) {
      return { ok: false as const, message: `${oldName}は変更できません` };
    }
    const trimmed = nextName.trim();
    if (!trimmed) return { ok: false as const, message: "所属名を入力してください" };
    if (isFixedDepartmentName(trimmed)) {
      return { ok: false as const, message: `${trimmed}という名前には変更できません` };
    }
    if (oldName === trimmed) return { ok: true as const };

    if (usingSupabaseAuthRef.current || (await detectSupabaseSession())) {
      usingSupabaseAuthRef.current = true;
      setUsingSupabaseAuth(true);
      try {
        const response = await fetch("/api/departments", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldName, nextName: trimmed }),
        });
        const payload = (await response.json()) as { ok: boolean; message?: string };
        if (!payload.ok) {
          return { ok: false as const, message: payload.message || "所属名の変更に失敗しました。" };
        }
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : "所属名の変更に失敗しました。",
        };
      }
    }

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
    return { ok: true as const };
  }, []);

  const deleteDepartment = useCallback(async (name: string) => {
    if (isFixedDepartmentName(name)) {
      return { ok: false as const, message: `${name}は削除できません` };
    }

    if (usingSupabaseAuthRef.current || (await detectSupabaseSession())) {
      usingSupabaseAuthRef.current = true;
      setUsingSupabaseAuth(true);
      try {
        const response = await fetch("/api/departments", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const payload = (await response.json()) as { ok: boolean; message?: string };
        if (!payload.ok) {
          return { ok: false as const, message: payload.message || "所属の削除に失敗しました。" };
        }
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : "所属の削除に失敗しました。",
        };
      }
    }

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
    return { ok: true as const };
  }, []);

  const createStaff = useCallback(async (input: StaffEditableFields) => {
    const email = (input.email ?? "").trim().toLowerCase();
    if (!email) {
      return { ok: false as const, message: "ログイン用メールアドレスを入力してください。" };
    }
    if (!input.password?.trim()) {
      return { ok: false as const, message: "パスワードを入力してください。" };
    }

    const actor = currentUser;
    if (input.role === "admin" && !canManageAdminAccounts(actor?.adminPermission)) {
      return { ok: false as const, message: "管理者アカウントの作成はマネージャーのみ可能です。" };
    }
    if (input.role === "admin" && !(input.managedTeams?.length > 0)) {
      return { ok: false as const, message: "管理者には操作できる所属を1つ以上選択してください。" };
    }
    if (input.role === "worker" && !input.team?.trim()) {
      return { ok: false as const, message: "所属は必須です。" };
    }

    const loggedIn = usingSupabaseAuthRef.current || (await detectSupabaseSession());
    if (loggedIn) {
      usingSupabaseAuthRef.current = true;
      setUsingSupabaseAuth(true);
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
            managedTeams: input.managedTeams,
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
            note: input.note ?? "",
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
            departments: bootstrap.departments.length > 0 ? bootstrap.departments : prev.departments,
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
    const contractStartDate = input.contractStartDate ?? "";
    const hourlyWage = Number.isFinite(input.hourlyWage) ? input.hourlyWage : 0;
    const initialEffectiveDate = hireDate || contractStartDate || toDateKey(new Date());
    const salaryHistory =
      input.salaryHistory && input.salaryHistory.length > 0
        ? input.salaryHistory
        : hourlyWage > 0
          ? [
              {
                id: `raise-${id}-init`,
                effectiveDate: initialEffectiveDate,
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
          managedTeams: input.role === "admin" ? input.managedTeams ?? [] : [],
          adminPermission: normalizeAdminPermission(input.role, input.adminPermission),
          team: input.role === "admin" ? input.managedTeams?.[0] ?? input.team ?? "" : input.team,
          hireDate,
          contractStartDate,
          contractEndDate: input.contractEndDate ?? "",
          contractRenewalMonths: input.contractRenewalMonths ?? DEFAULT_CONTRACT_RENEWAL_MONTHS,
          hourlyWage,
          socialInsurance: Boolean(input.socialInsurance),
          googleEmail: input.googleEmail ?? "",
          note: input.note ?? "",
          salaryHistory,
        }),
      ],
      departments: prev.departments.includes(input.team) ? prev.departments : [...prev.departments, input.team],
    }));
    return { ok: true as const, id };
  }, [currentUser]);

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

  const deleteStaff = useCallback(async (staffId: string) => {
    const target = state.staffList.find((staff) => staff.id === staffId);
    if (target?.role === "admin" && !canManageAdminAccounts(currentUser?.adminPermission)) {
      return { ok: false as const, message: "管理者アカウントの削除はマネージャーのみ可能です。" };
    }

    if (usingSupabaseAuthRef.current || (await detectSupabaseSession())) {
      usingSupabaseAuthRef.current = true;
      setUsingSupabaseAuth(true);
      try {
        const supabase = createClient();
        const result = await persistStaffDelete(supabase, staffId);
        if (!result.ok) {
          return { ok: false as const, message: result.message };
        }
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : "スタッフの削除に失敗しました。",
        };
      }
    }

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
    return { ok: true as const };
  }, [currentUser, state.staffList]);

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
            isAttendanceStatus(s.status)
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
            isAttendanceStatus(s.status)
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
      const shouldMarkAdjusting = existingConfirmed ? isAttendanceStatus(existingConfirmed.status) : false;

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

  const setDesiredShiftStatus = useCallback((desiredId: string, status: ConfirmedShift["status"]) => {
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
          isAttendanceStatus(status)
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
          const nextStatus: ConfirmedShift["status"] = desired
            ? existing && isAttendanceStatus(existing.status)
              ? existing.status
              : "confirmed"
            : "unconfirmed";
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
        if (!isAttendanceStatus(s.status) && s.status !== "unconfirmed") return s;
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
      if (!canManageMaster) {
        return { ok: false as const, message: "メッセージの送信はマネージャーまたはアルバイト管理者のみ可能です。" };
      }
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
    [canManageMaster]
  );

  const deleteHomeMessage = useCallback(
    (messageId: string) => {
      if (!canManageMaster) return;
      setState((prev) => ({
        ...prev,
        homeMessages: (prev.homeMessages ?? []).filter((m) => m.id !== messageId),
      }));
    },
    [canManageMaster]
  );

  const resetDemoData = useCallback(() => {
    const next = createInitialState();
    setState(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const value: ShiftContextValue = {
    ready,
    usingSupabaseAuth,
    state,
    currentUser,
    isAdmin,
    canManageMaster,
    canManageAdminAccounts: canManageAdmins,
    workers,
    setCurrentUserId,
    updatePeriod,
    updateGoalBlockCount,
    updateGoalBlockDepartment,
    setGoalBlocksForDate,
    applyGoalBlocksRepeat,
    updateStaff,
    changeStaffPassword,
    createStaff,
    refreshStaffFromSupabase,
    addSalaryRaise,
    updateSalaryRaise,
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
