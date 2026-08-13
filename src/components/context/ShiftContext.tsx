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
import { hasWishChangedAfterPublish } from "@/lib/shift/publish-state";
import { isAttendanceStatus, isPublishedConfirmedShift } from "@/lib/shift/status";
import { DEFAULT_CONTRACT_RENEWAL_MONTHS } from "@/lib/shift/staffEmployment";
import { calcActualMinutes, calcBreakMinutes, isValidTimeRange, normalizeDisplayTime } from "@/lib/shift/time";
import { createClient } from "@/lib/supabase/client";
import {
  createEmptyAppState,
  createEmptyShiftPersistenceFallback,
  type ShiftPersistenceSnapshot,
} from "@/lib/supabase/shiftPersistence";
import {
  fetchStaffBootstrap,
  type StaffPersistPatch,
} from "@/lib/supabase/staff";
import type {
  AppState,
  ConfirmedShift,
  DesiredShift,
  GoalMemo,
  HomeMessage,
  RequiredShiftCount,
  SalaryRaise,
  ShiftPeriod,
  Staff,
} from "@/lib/shift/types";
import { parseLoginEmail, normalizeEmailInput } from "@/lib/shift/email";


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

async function patchStaffLoginEmail(
  staffId: string,
  rawEmail: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const parsed = parseLoginEmail(rawEmail);
  if (!parsed.ok) {
    return { ok: false as const, message: parsed.message };
  }
  const response = await fetch("/api/staff", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: staffId, email: parsed.email }),
    credentials: "same-origin",
  });
  const payload = await readApiJson<{ ok: boolean; message?: string }>(
    response,
    "メールアドレスの更新に失敗しました。"
  );
  if (!payload.ok) {
    return { ok: false as const, message: payload.message || "メールアドレスの更新に失敗しました。" };
  }
  return { ok: true as const };
}

function normalizeDesiredShift(shift: DesiredShift): DesiredShift {
  const startTime = normalizeDisplayTime(shift.startTime);
  const endTime = normalizeDisplayTime(shift.endTime);
  const breakMinutes = calcBreakMinutes(startTime, endTime);
  return {
    ...shift,
    startTime,
    endTime,
    breakMinutes,
    actualMinutes: calcActualMinutes(startTime, endTime, breakMinutes),
  };
}

function normalizeConfirmedShift(shift: ConfirmedShift): ConfirmedShift {
  const startTime = normalizeDisplayTime(shift.startTime);
  const endTime = normalizeDisplayTime(shift.endTime);
  const breakMinutes = calcBreakMinutes(startTime, endTime);
  return {
    ...shift,
    startTime,
    endTime,
    breakMinutes,
    actualMinutes: calcActualMinutes(startTime, endTime, breakMinutes),
  };
}

type WishInput = {
  date: string;
  startTime: string;
  endTime: string;
  note: string;
};

type ShiftStatus = "confirmed" | "unconfirmed";

function formatShiftPersistError(message: string): string {
  if (message.includes("confirmed_shift_status") && message.includes("remote")) {
    return `${message}\n\n在宅（remote）用の DB マイグレーションが未適用です。Supabase SQL Editor では次の2つを別々に実行してください:\n1) supabase/migrations/20260812230000_add_remote_shift_status.sql\n2) supabase/migrations/20260812230001_confirmed_shifts_select_policy_remote.sql\n\nまたは SUPABASE_DB_URL を設定して npm run db:patch-schema を実行してください。`;
  }
  return message;
}

type ShiftContextValue = {
  ready: boolean;
  state: AppState;
  currentUser: Staff | undefined;
  isAdmin: boolean;
  /** マスタ管理を利用できる（マネージャー / アルバイト管理者） */
  canManageMaster: boolean;
  /** 管理者アカウントを管理できる（マネージャーのみ） */
  canManageAdminAccounts: boolean;
  workers: Staff[];
  updatePeriod: (patch: Partial<ShiftPeriod>) => void;
  updateGoalBlockCount: (date: string, blockIndex: number, delta: number) => void;
  updateGoalBlockDepartment: (date: string, blockIndex: number, iconIndex: number, department: string) => void;
  setGoalBlocksForDate: (date: string, blocks: [string[], string[], string[], string[]]) => void;
  applyGoalBlocksRepeat: (sourceDate: string, rule: GoalRepeatRule) => number;
  upsertGoalMemo: (memo: Omit<GoalMemo, "id"> & { id?: string }) => void;
  deleteGoalMemo: (memoId: string) => void;
  updateStaff: (staffId: string, patch: Partial<StaffEditableFields>) => void;
  /** 編集モーダル保存向け: Supabase に即時反映して一覧を再取得 */
  saveStaffProfile: (
    staffId: string,
    patch: Partial<StaffEditableFields>
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  changeStaffPassword: (
    staffId: string,
    password: string
  ) => Promise<{ ok: true; message?: string } | { ok: false; message: string }>;
  /** 保留中のスタッフ更新（メール等）を即時 DB 反映 */
  flushStaffPersistForStaff: (
    staffId: string
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
  /** Supabase 利用時: シフト変更を DB に即時反映 */
  flushShiftPersist: () => Promise<{ ok: true } | { ok: false; message: string }>;
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
  }) => Promise<{ ok: true } | { ok: false; message: string }>;
  deleteHomeMessage: (messageId: string) => Promise<void>;
};

const ShiftContext = createContext<ShiftContextValue | null>(null);

function buildShiftPersistenceSnapshot(state: AppState): ShiftPersistenceSnapshot {
  return {
    period: state.period,
    desiredShifts: state.desiredShifts,
    confirmedShifts: state.confirmedShifts,
    requiredShifts: state.requiredShifts,
    goalBlocksByDate: state.goalBlocksByDate,
    goalMemos: state.goalMemos,
    workerPublishedDates: state.workerPublishedDates,
  };
}

function buildShiftPersistenceSignature(snapshot: ShiftPersistenceSnapshot): string {
  const goalBlocksByDate = Object.fromEntries(
    Object.entries(snapshot.goalBlocksByDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, blocks]) => [date, normalizeGoalBlocks(blocks)])
  );
  return JSON.stringify({
    period: snapshot.period,
    desiredShifts: [...snapshot.desiredShifts].sort((a, b) => a.id.localeCompare(b.id)),
    confirmedShifts: [...snapshot.confirmedShifts].sort((a, b) => a.id.localeCompare(b.id)),
    requiredShifts: [...snapshot.requiredShifts].sort((a, b) => a.date.localeCompare(b.date)),
    goalBlocksByDate,
    goalMemos: [...snapshot.goalMemos].sort((a, b) => a.id.localeCompare(b.id)),
  });
}

async function fetchShiftSnapshotFromApi(): Promise<ShiftPersistenceSnapshot | null> {
  const response = await fetch("/api/shifts", { credentials: "same-origin" });
  if (!response.ok) {
    console.warn("GET /api/shifts failed", response.status);
    return null;
  }
  const payload = (await response.json()) as { ok?: boolean; snapshot?: ShiftPersistenceSnapshot; message?: string };
  if (!payload.ok) {
    console.warn("GET /api/shifts rejected", payload.message);
    return null;
  }
  return payload.snapshot ?? null;
}

async function fetchHomeMessagesFromApi(): Promise<HomeMessage[]> {
  const response = await fetch("/api/messages", { credentials: "same-origin" });
  if (!response.ok) return [];
  const payload = (await response.json()) as { ok?: boolean; messages?: HomeMessage[] };
  return payload.ok && Array.isArray(payload.messages) ? payload.messages : [];
}

async function reloadRemoteAppData(): Promise<{
  bootstrap: Awaited<ReturnType<typeof fetchStaffBootstrap>>;
  shiftSnapshot: ShiftPersistenceSnapshot;
  homeMessages: HomeMessage[];
}> {
  const supabase = createClient();
  const bootstrap = await fetchStaffBootstrap(supabase, { attempts: 4 });
  const [shiftSnapshot, homeMessages] = await Promise.all([
    fetchShiftSnapshotFromApi(),
    fetchHomeMessagesFromApi(),
  ]);
  return {
    bootstrap,
    shiftSnapshot: shiftSnapshot ?? createEmptyShiftPersistenceFallback(),
    homeMessages,
  };
}

async function readApiJson<T extends { ok?: boolean; message?: string }>(
  response: Response,
  fallbackMessage: string
): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (response.status === 401) {
      throw new Error("ログインセッションが切れました。再度ログインしてからお試しください。");
    }
    throw new Error(`${fallbackMessage}（サーバー応答 ${response.status}）`);
  }
  return (await response.json()) as T;
}

async function persistStaffPatchViaApi(
  staffId: string,
  patch: StaffPersistPatch
): Promise<{ ok: true } | { ok: false; message: string }> {
  const response = await fetch("/api/staff", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: staffId, patch }),
    credentials: "same-origin",
  });
  try {
    const payload = await readApiJson<{ ok: boolean; message?: string }>(
      response,
      "スタッフ情報の保存に失敗しました。"
    );
    return payload.ok
      ? { ok: true }
      : { ok: false, message: payload.message || "スタッフ情報の保存に失敗しました。" };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "スタッフ情報の保存に失敗しました。",
    };
  }
}

export function ShiftProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(createEmptyAppState);
  const [ready, setReady] = useState(false);
  const staffPersistTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const staffPersistPatches = useRef<Record<string, StaffPersistPatch>>({});
  const latestShiftSnapshotRef = useRef<ShiftPersistenceSnapshot>(buildShiftPersistenceSnapshot(createEmptyAppState()));
  const lastShiftPersistSignatureRef = useRef("");
  const shiftPersistInFlightRef = useRef(0);
  const shiftReloadPendingRef = useRef(false);
  const shiftReloadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shiftPersistDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shiftPersistQueuedRef = useRef(false);
  const currentUserForSync = state.staffList.find((staff) => staff.id === state.currentUserId);

  const finishShiftPersist = useCallback((user?: Staff) => {
    shiftPersistInFlightRef.current = Math.max(0, shiftPersistInFlightRef.current - 1);
    if (shiftPersistInFlightRef.current === 0 && shiftReloadPendingRef.current) {
      shiftReloadPendingRef.current = false;
      void fetchShiftSnapshotFromApi().then((next) => {
        if (!next) return;
        lastShiftPersistSignatureRef.current = buildShiftPersistenceSignature(next);
        setState((prev) => ({
          ...prev,
          ...next,
          staffList: prev.staffList,
          departments: prev.departments,
          currentUserId: prev.currentUserId,
        }));
      });
    }
    if (shiftPersistInFlightRef.current === 0 && shiftPersistQueuedRef.current && user) {
      shiftPersistQueuedRef.current = false;
      const latestSignature = buildShiftPersistenceSignature(latestShiftSnapshotRef.current);
      if (latestSignature !== lastShiftPersistSignatureRef.current) {
        void runShiftPersistRef.current?.(user);
      }
    }
  }, []);

  const runShiftPersistRef = useRef<((user: Staff) => Promise<void>) | null>(null);

  const persistSnapshotViaApi = useCallback(
    async (
      user: Staff,
      snapshot: ShiftPersistenceSnapshot
    ): Promise<{ ok: true } | { ok: false; message: string }> => {
      try {
        if (user.role === "worker") {
          const workerSnapshot: ShiftPersistenceSnapshot = {
            ...snapshot,
            desiredShifts: snapshot.desiredShifts.filter((shift) => shift.staffId === user.id),
          };
          const response = await fetch("/api/shifts/worker", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ snapshot: workerSnapshot }),
          });
          const payload = (await response.json().catch(() => null)) as {
            ok?: boolean;
            message?: string;
            periodId?: string;
          } | null;
          if (!response.ok || !payload?.ok) {
            return { ok: false, message: payload?.message || "希望シフトの保存に失敗しました。" };
          }
          if (payload.periodId && payload.periodId !== snapshot.period.id) {
            setState((prev) => ({
              ...prev,
              period: { ...prev.period, id: payload.periodId! },
              desiredShifts: prev.desiredShifts.map((shift) => ({ ...shift, periodId: payload.periodId! })),
              confirmedShifts: prev.confirmedShifts.map((shift) => ({ ...shift, periodId: payload.periodId! })),
              requiredShifts: prev.requiredShifts.map((shift) => ({ ...shift, periodId: payload.periodId! })),
            }));
          }
          return { ok: true };
        }

        const response = await fetch("/api/shifts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snapshot }),
        });
        const payload = (await response.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
        if (!response.ok || !payload?.ok) {
          return {
            ok: false,
            message: formatShiftPersistError(payload?.message || "シフト保存に失敗しました。"),
          };
        }
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "シフト保存に失敗しました。",
        };
      }
    },
    []
  );

  const runShiftPersist = useCallback(
    async (user: Staff) => {
      if (shiftPersistInFlightRef.current > 0) {
        shiftPersistQueuedRef.current = true;
        return;
      }

      const snapshot = latestShiftSnapshotRef.current;
      const signature = buildShiftPersistenceSignature(snapshot);
      if (lastShiftPersistSignatureRef.current === signature) return;

      shiftPersistInFlightRef.current += 1;
      try {
        const result = await persistSnapshotViaApi(user, snapshot);
        if (!result.ok) {
          lastShiftPersistSignatureRef.current = "";
          window.alert(`シフトの DB 保存に失敗しました: ${formatShiftPersistError(result.message)}`);
          return;
        }
        lastShiftPersistSignatureRef.current = signature;
      } finally {
        finishShiftPersist(user);
      }
    },
    [finishShiftPersist, persistSnapshotViaApi]
  );

  runShiftPersistRef.current = runShiftPersist;

  const applyStaffPersistPatch = useCallback(
    async (
      staffId: string,
      patch: Partial<StaffEditableFields>
    ): Promise<{ ok: true } | { ok: false; message: string }> => {
      try {
        const { email: nextEmail, ...profilePatch } = patch;
        if (typeof nextEmail === "string") {
          const emailResult = await patchStaffLoginEmail(staffId, nextEmail);
          if (!emailResult.ok) {
            return emailResult;
          }
        }

        if (Object.keys(profilePatch).length > 0) {
          const result = await persistStaffPatchViaApi(staffId, profilePatch);
          if (!result.ok) {
            return { ok: false as const, message: result.message || "スタッフ情報の保存に失敗しました。" };
          }
        }

        return { ok: true as const };
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : "スタッフ情報の保存に失敗しました。",
        };
      }
    },
    []
  );

  const flushStaffPersistForStaff = useCallback(
    async (staffId: string): Promise<{ ok: true } | { ok: false; message: string }> => {
      if (staffPersistTimers.current[staffId]) {
        clearTimeout(staffPersistTimers.current[staffId]);
        delete staffPersistTimers.current[staffId];
      }
      const merged = staffPersistPatches.current[staffId];
      delete staffPersistPatches.current[staffId];
      if (!merged) {
        return { ok: true as const };
      }
      return applyStaffPersistPatch(staffId, merged);
    },
    [applyStaffPersistPatch]
  );

  const flushStaffPersists = useCallback(async () => {
    const entries = Object.entries(staffPersistPatches.current);
    for (const [, timer] of Object.entries(staffPersistTimers.current)) {
      clearTimeout(timer);
    }
    staffPersistTimers.current = {};
    staffPersistPatches.current = {};
    if (entries.length === 0) return;
    for (const [staffId, patch] of entries) {
      const result = await applyStaffPersistPatch(staffId, patch);
      if (!result.ok) {
        console.error("staff_profiles flush failed", result.message);
      }
    }
  }, [applyStaffPersistPatch]);

  const refreshStaffFromSupabase = useCallback(async () => {
    try {
      const remote = await reloadRemoteAppData();
      setState((prev) => ({
        ...prev,
        staffList: remote.bootstrap?.staffList ?? [],
        departments: remote.bootstrap?.departments?.length
          ? remote.bootstrap.departments
          : prev.departments,
        currentUserId: remote.bootstrap?.userId ?? prev.currentUserId,
        homeMessages: remote.homeMessages,
      }));
    } catch (error) {
      console.warn("refreshStaffFromSupabase failed", error);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let authSubscription: { unsubscribe: () => void } | null = null;
    let initialSessionHandled = false;
    let loadGeneration = 0;

    async function applyAuthUser(userId: string | null) {
      const generation = ++loadGeneration;

      if (!userId) {
        if (!cancelled) {
          setState(createEmptyAppState());
          setReady(true);
        }
        return;
      }

      try {
        if (!cancelled) {
          setReady(false);
        }

        const remote = await reloadRemoteAppData();
        if (cancelled || generation !== loadGeneration) return;

        if (!remote.bootstrap?.userId) {
          console.warn("staff bootstrap unavailable after login");
          if (!cancelled) {
            setState(createEmptyAppState());
            setReady(true);
          }
          return;
        }

        lastShiftPersistSignatureRef.current = buildShiftPersistenceSignature(remote.shiftSnapshot);

        setState({
          staffList: remote.bootstrap.staffList,
          departments: remote.bootstrap.departments,
          currentUserId: remote.bootstrap.userId,
          homeMessages: remote.homeMessages,
          ...remote.shiftSnapshot,
        });
      } catch (error) {
        console.warn("Supabase staff bootstrap skipped", error);
        if (!cancelled) {
          setState(createEmptyAppState());
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    async function boot() {
      try {
        const supabase = createClient();
        const { data } = supabase.auth.onAuthStateChange((event, session) => {
          if (event === "INITIAL_SESSION") {
            initialSessionHandled = true;
            void applyAuthUser(session?.user?.id ?? null);
            return;
          }
          if (event === "SIGNED_OUT") {
            void applyAuthUser(null);
            return;
          }
          if (event === "SIGNED_IN" || event === "USER_UPDATED") {
            void applyAuthUser(session?.user?.id ?? null);
          }
        });
        authSubscription = data.subscription;

        window.setTimeout(() => {
          if (cancelled || initialSessionHandled) return;
          void supabase.auth.getSession().then(({ data: sessionData }) => {
            if (cancelled || initialSessionHandled) return;
            void applyAuthUser(sessionData.session?.user?.id ?? null);
          });
        }, 150);
      } catch (error) {
        console.warn("Supabase auth boot failed", error);
        if (!cancelled) {
          setState(createEmptyAppState());
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
    latestShiftSnapshotRef.current = buildShiftPersistenceSnapshot(state);
  }, [state]);

  const flushShiftPersist = useCallback(async (): Promise<{ ok: true } | { ok: false; message: string }> => {
    const currentUser = state.staffList.find((staff) => staff.id === state.currentUserId);
    if (!currentUser) return { ok: true };

    if (shiftPersistDebounceRef.current) {
      clearTimeout(shiftPersistDebounceRef.current);
      shiftPersistDebounceRef.current = null;
    }

    const snapshot = latestShiftSnapshotRef.current;
    if (shiftPersistInFlightRef.current > 0) {
      shiftPersistQueuedRef.current = true;
      return { ok: true };
    }

    shiftPersistInFlightRef.current += 1;
    try {
      const result = await persistSnapshotViaApi(currentUser, snapshot);
      if (!result.ok) return result;
      lastShiftPersistSignatureRef.current = buildShiftPersistenceSignature(snapshot);
      return { ok: true };
    } finally {
      finishShiftPersist(currentUser);
    }
  }, [state, finishShiftPersist, persistSnapshotViaApi]);

  useEffect(() => {
    if (!ready || !currentUserForSync) return;

    const signature = buildShiftPersistenceSignature(latestShiftSnapshotRef.current);
    if (lastShiftPersistSignatureRef.current === signature) return;

    if (shiftPersistDebounceRef.current) {
      clearTimeout(shiftPersistDebounceRef.current);
    }

    const debounceMs = currentUserForSync.role === "worker" ? 400 : 700;
    shiftPersistDebounceRef.current = setTimeout(() => {
      shiftPersistDebounceRef.current = null;
      void runShiftPersist(currentUserForSync);
    }, debounceMs);

    return () => {
      if (shiftPersistDebounceRef.current) {
        clearTimeout(shiftPersistDebounceRef.current);
      }
    };
  }, [ready, state, currentUserForSync, runShiftPersist]);


  useEffect(() => {
    if (!ready || !currentUserForSync) return;
    let cancelled = false;
    let supabase: ReturnType<typeof createClient> | null = null;
    let channel: any = null;

    const reloadShiftSnapshot = async () => {
      if (cancelled) return;
      if (shiftPersistInFlightRef.current > 0) {
        shiftReloadPendingRef.current = true;
        return;
      }
      try {
        const [next, homeMessages] = await Promise.all([
          fetchShiftSnapshotFromApi(),
          fetchHomeMessagesFromApi(),
        ]);
        if (!next || cancelled) return;
        lastShiftPersistSignatureRef.current = buildShiftPersistenceSignature(next);
        setState((prev) => {
          const isWorker =
            prev.staffList.find((staff) => staff.id === prev.currentUserId)?.role === "worker";
          const mergedPublishedDates =
            isWorker && (prev.workerPublishedDates?.length || next.workerPublishedDates?.length)
              ? Array.from(
                  new Set([...(prev.workerPublishedDates ?? []), ...(next.workerPublishedDates ?? [])])
                ).sort()
              : next.workerPublishedDates;
          return {
            ...prev,
            ...next,
            workerPublishedDates: mergedPublishedDates,
            homeMessages,
            staffList: prev.staffList,
            departments: prev.departments,
            currentUserId: prev.currentUserId,
          };
        });
      } catch (error) {
        console.warn("Shift snapshot reload skipped", error);
      }
    };

    const scheduleReloadShiftSnapshot = () => {
      if (shiftReloadDebounceRef.current) {
        clearTimeout(shiftReloadDebounceRef.current);
      }
      shiftReloadDebounceRef.current = setTimeout(() => {
        shiftReloadDebounceRef.current = null;
        void reloadShiftSnapshot();
      }, 350);
    };

    void (async () => {
      try {
        supabase = createClient();
        channel = supabase
          .channel("shift-state-sync")
          .on("postgres_changes", { event: "*", schema: "public", table: "desired_shifts" }, scheduleReloadShiftSnapshot)
          .on("postgres_changes", { event: "*", schema: "public", table: "confirmed_shifts" }, scheduleReloadShiftSnapshot)
          .on("postgres_changes", { event: "*", schema: "public", table: "required_shifts" }, scheduleReloadShiftSnapshot)
          .on("postgres_changes", { event: "*", schema: "public", table: "goal_block_slots" }, scheduleReloadShiftSnapshot)
          .on("postgres_changes", { event: "*", schema: "public", table: "goal_memos" }, scheduleReloadShiftSnapshot)
          .on("postgres_changes", { event: "*", schema: "public", table: "shift_periods" }, scheduleReloadShiftSnapshot)
          .on("postgres_changes", { event: "*", schema: "public", table: "home_messages" }, scheduleReloadShiftSnapshot);
        channel.subscribe();
      } catch (error) {
        console.warn("Shift realtime subscription skipped", error);
      }
    })();

    return () => {
      cancelled = true;
      if (shiftReloadDebounceRef.current) {
        clearTimeout(shiftReloadDebounceRef.current);
      }
      if (supabase && channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [ready, currentUserForSync]);

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
    return state.staffList.find((s) => s.id === state.currentUserId);
  }, [state.currentUserId, state.staffList]);

  const isAdmin = currentUser?.role === "admin";
  const canManageMaster = Boolean(isAdmin && hasMasterPermission(currentUser?.adminPermission));
  const canManageAdmins = Boolean(isAdmin && canManageAdminAccounts(currentUser?.adminPermission));
  const workers = useMemo(
    () => state.staffList.filter((s) => s.role === "worker" && s.status === "active"),
    [state.staffList]
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

  const upsertGoalMemo = useCallback((memo: Omit<GoalMemo, "id"> & { id?: string }) => {
    const body = memo.body.trim();
    if (!body || !memo.startDate || !memo.endDate) return;
    const startDate = memo.startDate <= memo.endDate ? memo.startDate : memo.endDate;
    const endDate = memo.startDate <= memo.endDate ? memo.endDate : memo.startDate;
    const frequency =
      memo.frequency === "daily" || memo.frequency === "weekdays" || memo.frequency === "monthly"
        ? memo.frequency
        : "daily";
    const weekdays = [...new Set((memo.weekdays ?? []).filter((d) => d >= 1 && d <= 5))].sort();
    const next: GoalMemo = {
      id: memo.id ?? "",
      body,
      startDate,
      endDate,
      frequency,
      weekdays: frequency === "weekdays" ? weekdays : [],
      repeatMonths: Math.max(1, Number(memo.repeatMonths) || 3),
      monthlyMode: memo.monthlyMode === "range" ? "range" : "single",
      monthDay: Math.min(31, Math.max(1, Number(memo.monthDay) || 1)),
      monthDayStart: Math.min(31, Math.max(1, Number(memo.monthDayStart) || 1)),
      monthDayEnd: Math.min(31, Math.max(1, Number(memo.monthDayEnd) || 1)),
    };

    setState((prev) => {
      const list = [...(prev.goalMemos ?? [])];
      if (memo.id) {
        const index = list.findIndex((item) => item.id === memo.id);
        if (index >= 0) {
          list[index] = { ...next, id: memo.id };
          return { ...prev, goalMemos: list };
        }
      }
      list.unshift({
        ...next,
        id: `goal-memo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
      return { ...prev, goalMemos: list };
    });
  }, []);

  const deleteGoalMemo = useCallback((memoId: string) => {
    setState((prev) => ({
      ...prev,
      goalMemos: (prev.goalMemos ?? []).filter((memo) => memo.id !== memoId),
    }));
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
        departments: prev.departments,
      };
    });

    const { password: _password, salaryHistory: _salaryHistory, email: _email, ...persistable } = patch;
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
      if (!merged || Object.keys(merged).length === 0) return;
      void (async () => {
        try {
          const result = await persistStaffPatchViaApi(staffId, merged);
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

  const saveStaffProfile = useCallback(
    async (
      staffId: string,
      patch: Partial<StaffEditableFields>
    ): Promise<{ ok: true } | { ok: false; message: string }> => {
      const target = state.staffList.find((staff) => staff.id === staffId);
      const actor = state.staffList.find((staff) => staff.id === state.currentUserId);
      if (
        target?.role === "admin" &&
        actor?.role === "admin" &&
        !canManageAdminAccounts(actor.adminPermission)
      ) {
        return { ok: false as const, message: "管理者アカウントの変更はマネージャーのみ可能です。" };
      }
      if (
        (patch.role === "admin" || patch.adminPermission !== undefined) &&
        actor?.role === "admin" &&
        !canManageAdminAccounts(actor.adminPermission)
      ) {
        return { ok: false as const, message: "管理者権限の変更はマネージャーのみ可能です。" };
      }

      if (staffPersistTimers.current[staffId]) {
        clearTimeout(staffPersistTimers.current[staffId]);
        delete staffPersistTimers.current[staffId];
      }
      delete staffPersistPatches.current[staffId];

      setState((prev) => ({
        ...prev,
        staffList: prev.staffList.map((staff) =>
          staff.id === staffId ? normalizeStaff({ ...staff, ...patch }) : staff
        ),
      }));

      const { password: _password, salaryHistory: _salaryHistory, ...persistable } = patch;
      try {
        const { email: nextEmail, ...profilePatch } = persistable;
        if (typeof nextEmail === "string") {
          const parsed = parseLoginEmail(nextEmail);
          if (!parsed.ok) {
            return { ok: false as const, message: parsed.message };
          }
          const currentEmail = normalizeEmailInput(target?.email ?? "");
          if (parsed.email !== currentEmail) {
            const emailResult = await patchStaffLoginEmail(staffId, nextEmail);
            if (!emailResult.ok) {
              return emailResult;
            }
          }
        }

        if (Object.keys(profilePatch).length > 0) {
          const result = await persistStaffPatchViaApi(staffId, profilePatch);
          if (!result.ok) {
            return result;
          }
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

        return { ok: true as const };
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : "スタッフ情報の保存に失敗しました。",
        };
      }
    },
    [state.currentUserId, state.staffList]
  );

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
    const isSelf = staffId === state.currentUserId;
    if (
      !isSelf &&
      target?.role === "admin" &&
      actor?.role === "admin" &&
      !canManageAdminAccounts(actor.adminPermission)
    ) {
      return { ok: false as const, message: "管理者アカウントのパスワード変更はマネージャーのみ可能です。" };
    }

    try {
        const flushResult = await flushStaffPersistForStaff(staffId);
        if (!flushResult.ok) {
          return flushResult;
        }

        const response = await fetch("/api/staff", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: staffId,
            password,
          }),
          credentials: "same-origin",
        });
        const payload = await readApiJson<{ ok: boolean; message?: string }>(
          response,
          "パスワードの更新に失敗しました。"
        );
        if (!payload.ok) {
          return { ok: false as const, message: payload.message || "パスワードの更新に失敗しました。" };
        }
        setState((prev) => ({
          ...prev,
          staffList: prev.staffList.map((staff) =>
            staff.id === staffId ? normalizeStaff({ ...staff, password: "" }) : staff
          ),
        }));
        if (isSelf) {
          return {
            ok: true as const,
            message: "パスワードを更新しました。一度ログアウトし、新しいパスワードで再ログインしてください。",
          };
        }
        return { ok: true as const };
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : "パスワードの更新に失敗しました。",
        };
      }
  }, [flushStaffPersistForStaff, state.currentUserId, state.staffList]);

  const addSalaryRaise = useCallback(
    async (staffId: string, input: { effectiveDate: string; hourlyWage: number; note: string }) => {
      const effectiveDate = input.effectiveDate.trim();
      const hourlyWage = Number(input.hourlyWage);
      if (!effectiveDate) return { ok: false as const, message: "適用日を入力してください" };
      if (!Number.isFinite(hourlyWage) || hourlyWage < 0) {
        return { ok: false as const, message: "時給を正しく入力してください" };
      }

      const note = input.note.trim();

      try {
        const response = await fetch("/api/staff/salary-raises", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ staffId, effectiveDate, hourlyWage, note }),
        });
        const payload = (await response.json()) as { ok: boolean; id?: string; message?: string };
        if (!payload.ok || !payload.id) {
          return { ok: false as const, message: payload.message || "昇給の保存に失敗しました。" };
        }
        await refreshStaffFromSupabase();
        return { ok: true as const };
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : "昇給の保存に失敗しました。",
        };
      }
    },
    [refreshStaffFromSupabase]
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

      try {
        const response = await fetch("/api/staff/salary-raises", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ staffId, raiseId, effectiveDate, hourlyWage, note }),
        });
        const payload = (await response.json()) as { ok: boolean; message?: string };
        if (!payload.ok) {
          return { ok: false as const, message: payload.message || "昇給履歴の更新に失敗しました。" };
        }
        await refreshStaffFromSupabase();
        return { ok: true as const };
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : "昇給履歴の更新に失敗しました。",
        };
      }
    },
    [refreshStaffFromSupabase]
  );

  const addDepartment = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false as const, message: "所属名を入力してください" };
    if (isFixedDepartmentName(trimmed)) {
      return { ok: false as const, message: `${trimmed}は固定の所属です` };
    }

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
        await refreshStaffFromSupabase();
        return { ok: true as const };
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : "所属の追加に失敗しました。",
        };
      }
  }, [refreshStaffFromSupabase]);

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
        await refreshStaffFromSupabase();
        const remote = await fetchShiftSnapshotFromApi();
        if (remote) {
          lastShiftPersistSignatureRef.current = buildShiftPersistenceSignature(remote);
          setState((prev) => ({ ...prev, ...remote }));
        }
        return { ok: true as const };
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : "所属名の変更に失敗しました。",
        };
      }
  }, [refreshStaffFromSupabase]);

  const deleteDepartment = useCallback(async (name: string) => {
    if (isFixedDepartmentName(name)) {
      return { ok: false as const, message: `${name}は削除できません` };
    }

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
        await refreshStaffFromSupabase();
        const remote = await fetchShiftSnapshotFromApi();
        if (remote) {
          lastShiftPersistSignatureRef.current = buildShiftPersistenceSignature(remote);
          setState((prev) => ({ ...prev, ...remote }));
        }
        return { ok: true as const };
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : "所属の削除に失敗しました。",
        };
      }
  }, [refreshStaffFromSupabase]);

  const createStaff = useCallback(async (input: StaffEditableFields) => {
    const emailParsed = parseLoginEmail(input.email ?? "");
    if (!emailParsed.ok) {
      return { ok: false as const, message: emailParsed.message };
    }
    const email = emailParsed.email;
    if (!input.password?.trim()) {
      return { ok: false as const, message: "パスワードを入力してください。" };
    }

    const actor = currentUser;
    if (input.role === "admin" && !canManageAdminAccounts(actor?.adminPermission)) {
      return { ok: false as const, message: "管理者アカウントの作成はマネージャーのみ可能です。" };
    }
    if (input.password.trim().length < 6) {
      return { ok: false as const, message: "パスワードは6文字以上にしてください。" };
    }
    if (input.role === "admin" && !(input.managedTeams?.length > 0)) {
      return { ok: false as const, message: "管理者には操作できる所属を1つ以上選択してください。" };
    }
    if (input.role === "worker" && !input.team?.trim()) {
      return { ok: false as const, message: "所属は必須です。" };
    }

    try {
        const response = await fetch("/api/staff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
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
        const payload = await readApiJson<{ ok: boolean; id?: string; message?: string }>(
          response,
          "スタッフ作成に失敗しました。"
        );
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
  }, [currentUser, refreshStaffFromSupabase]);

  const deleteStaff = useCallback(async (staffId: string) => {
    const target = state.staffList.find((staff) => staff.id === staffId);
    if (target?.role === "admin" && !canManageAdminAccounts(currentUser?.adminPermission)) {
      return { ok: false as const, message: "管理者アカウントの削除はマネージャーのみ可能です。" };
    }

    try {
        const response = await fetch("/api/staff", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: staffId }),
        });
        const payload = (await response.json()) as { ok: boolean; message?: string };
        if (!payload.ok) {
          return { ok: false as const, message: payload.message || "スタッフの削除に失敗しました。" };
        }
        await refreshStaffFromSupabase();
        const remote = await fetchShiftSnapshotFromApi();
        if (remote) {
          lastShiftPersistSignatureRef.current = buildShiftPersistenceSignature(remote);
          setState((prev) => ({ ...prev, ...remote }));
        }
        return { ok: true as const };
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : "スタッフの削除に失敗しました。",
        };
      }
  }, [currentUser, refreshStaffFromSupabase]);

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
            Boolean(s.publishedAt)
        );

        if (existing) {
          const updatedDesired: DesiredShift = {
            ...existing,
            startTime: input.startTime,
            endTime: input.endTime,
            breakMinutes,
            actualMinutes,
            note: input.note,
            updatedAt: now,
          };
          const shouldMarkAdjusting = hasWishChangedAfterPublish(confirmedShift, updatedDesired);
          const nextState = {
            ...prev,
            desiredShifts: prev.desiredShifts.map((s) => (s.id === existing.id ? updatedDesired : s)),
            confirmedShifts: confirmedShift
              ? prev.confirmedShifts.map((s) =>
                  s.id === confirmedShift.id
                    ? shouldMarkAdjusting
                      ? { ...s, status: "adjusting" as const, updatedAt: now }
                      : {
                          ...s,
                          status: (isAttendanceStatus(s.status) ? s.status : "confirmed") as ConfirmedShift["status"],
                          updatedAt: s.publishedAt ?? s.updatedAt,
                        }
                    : s
                )
              : prev.confirmedShifts,
            period: shouldMarkAdjusting
              ? { ...prev.period, adjustmentStatus: "adjusting" as const, updatedAt: now }
              : prev.period,
          };
          latestShiftSnapshotRef.current = buildShiftPersistenceSnapshot(nextState);
          return nextState;
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
        const shouldMarkAdjusting = hasWishChangedAfterPublish(confirmedShift, created);
        const nextState = {
          ...prev,
          desiredShifts: [...prev.desiredShifts, created],
          confirmedShifts: confirmedShift
            ? prev.confirmedShifts.map((s) =>
                s.id === confirmedShift.id
                  ? shouldMarkAdjusting
                    ? { ...s, status: "adjusting" as const, updatedAt: now }
                    : {
                        ...s,
                        status: (isAttendanceStatus(s.status) ? s.status : "confirmed") as ConfirmedShift["status"],
                        updatedAt: s.publishedAt ?? s.updatedAt,
                      }
                  : s
              )
            : prev.confirmedShifts,
          period: shouldMarkAdjusting
            ? { ...prev.period, adjustmentStatus: "adjusting" as const, updatedAt: now }
            : prev.period,
        };
        latestShiftSnapshotRef.current = buildShiftPersistenceSnapshot(nextState);
        return nextState;
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
            Boolean(s.publishedAt)
        );
        const nextState = {
          ...prev,
          desiredShifts: prev.desiredShifts.filter(
            (s) => !(s.staffId === prev.currentUserId && s.date === date)
          ),
          confirmedShifts: prev.confirmedShifts
            .filter(
              (s) =>
                !(
                  s.staffId === prev.currentUserId &&
                  s.date === date &&
                  !s.publishedAt
                )
            )
            .map((s) =>
              confirmedShift && s.id === confirmedShift.id
                ? { ...s, status: "adjusting" as const, updatedAt: now }
                : s
            ),
          period: confirmedShift
            ? { ...prev.period, adjustmentStatus: "adjusting" as const, updatedAt: now }
            : prev.period,
        };
        latestShiftSnapshotRef.current = buildShiftPersistenceSnapshot(nextState);
        return nextState;
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

      const nextState = {
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
          ? { ...prev.period, adjustmentStatus: "adjusting" as const, updatedAt: now }
          : prev.period,
      };
      latestShiftSnapshotRef.current = buildShiftPersistenceSnapshot(nextState);
      return nextState;
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
          const nextState = {
            ...prev,
            confirmedShifts: prev.confirmedShifts.map((s) =>
              s.id === existing.id ? { ...s, status: "adjusting" as const, updatedAt: now } : s
            ),
            period: { ...prev.period, adjustmentStatus: "adjusting" as const, updatedAt: now },
          };
          latestShiftSnapshotRef.current = buildShiftPersistenceSnapshot(nextState);
          return nextState;
        }
        const created: ConfirmedShift = {
          id: `confirm-${desired.staffId}-${desired.date}`,
          staffId: desired.staffId,
          periodId: desired.periodId,
          date: desired.date,
          status: "adjusting",
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
        const nextState = {
          ...prev,
          confirmedShifts: [...prev.confirmedShifts, created],
          period: { ...prev.period, adjustmentStatus: "adjusting" as const, updatedAt: now },
        };
        latestShiftSnapshotRef.current = buildShiftPersistenceSnapshot(nextState);
        return nextState;
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
        const nextState = {
          ...prev,
          confirmedShifts: prev.confirmedShifts.map((s) =>
            s.id === existing.id ? updatedConfirmed : s
          ),
          period: { ...prev.period, adjustmentStatus: "adjusting" as const, updatedAt: now },
        };
        latestShiftSnapshotRef.current = buildShiftPersistenceSnapshot(nextState);
        return nextState;
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

      const nextState = {
        ...prev,
        confirmedShifts: [...prev.confirmedShifts, created],
        period: { ...prev.period, adjustmentStatus: "adjusting" as const, updatedAt: now },
      };
      latestShiftSnapshotRef.current = buildShiftPersistenceSnapshot(nextState);
      return nextState;
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
      setState((prev) => {
        const nextState = {
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
            ? { ...prev.period, adjustmentStatus: "adjusting" as const, updatedAt: now }
            : prev.period,
        };
        latestShiftSnapshotRef.current = buildShiftPersistenceSnapshot(nextState);
        return nextState;
      });
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
            ? existing
              ? existing.status === "unconfirmed" || isAttendanceStatus(existing.status)
                ? existing.status
                : "confirmed"
              : "confirmed"
            : "unconfirmed";
          const fallbackStart = desired?.startTime ?? existing?.startTime ?? "09:00";
          const fallbackEnd =
            desired?.endTime ??
            existing?.endTime ??
            (nextStatus === "unconfirmed" ? "09:01" : "18:00");
          const nextShift: ConfirmedShift = existing
            ? {
                ...existing,
                status: nextStatus,
                startTime: fallbackStart,
                endTime: fallbackEnd,
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
                startTime: fallbackStart,
                endTime: fallbackEnd,
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

      const nextState = {
        ...prev,
        confirmedShifts: Array.from(nextConfirmedMap.values()),
        period: {
          ...prev.period,
          publishedWeekStartDate: mode === "week" ? date ?? prev.period.publishedWeekStartDate : prev.period.publishedWeekStartDate,
          publishedAt: mode === "week" ? now : prev.period.publishedAt,
          adjustmentStatus: "published" as const,
          updatedAt: now,
        },
      };
      latestShiftSnapshotRef.current = buildShiftPersistenceSnapshot(nextState);
      return nextState;
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
    async (input: { body: string; audience: "all" | "team"; team?: string }) => {
      if (!canManageMaster) {
        return { ok: false as const, message: "メッセージの送信はマネージャーまたはアルバイト管理者のみ可能です。" };
      }

      try {
        const response = await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const payload = (await response.json()) as { ok: boolean; message?: string };
        if (!payload.ok) {
          return { ok: false as const, message: payload.message || "メッセージの送信に失敗しました。" };
        }
        const homeMessages = await fetchHomeMessagesFromApi();
        setState((prev) => ({ ...prev, homeMessages }));
        return { ok: true as const };
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : "メッセージの送信に失敗しました。",
        };
      }
    },
    [canManageMaster]
  );

  const deleteHomeMessage = useCallback(
    async (messageId: string) => {
      if (!canManageMaster) return;

      try {
        const response = await fetch("/api/messages", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: messageId }),
        });
        if (!response.ok) return;
        const homeMessages = await fetchHomeMessagesFromApi();
        setState((prev) => ({ ...prev, homeMessages }));
      } catch (error) {
        console.warn("deleteHomeMessage failed", error);
      }
    },
    [canManageMaster]
  );


  const value: ShiftContextValue = {
    ready,
    state,
    currentUser,
    isAdmin,
    canManageMaster,
    canManageAdminAccounts: canManageAdmins,
    workers,
    updatePeriod,
    updateGoalBlockCount,
    updateGoalBlockDepartment,
    setGoalBlocksForDate,
    applyGoalBlocksRepeat,
    upsertGoalMemo,
    deleteGoalMemo,
    updateStaff,
    saveStaffProfile,
    changeStaffPassword,
    flushStaffPersistForStaff,
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
    flushShiftPersist,
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
  };

  return <ShiftContext.Provider value={value}>{children}</ShiftContext.Provider>;
}

export function useShift() {
  const ctx = useContext(ShiftContext);
  if (!ctx) throw new Error("useShift must be used within ShiftProvider");
  return ctx;
}
