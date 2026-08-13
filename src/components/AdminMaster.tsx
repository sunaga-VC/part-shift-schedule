"use client";

import { useEffect, useMemo, useState, type SetStateAction } from "react";
import Link from "next/link";
import { Icons } from "@/components/icons";
import { useShift } from "@/components/context/ShiftContext";
import { toDateKeyJst } from "@/lib/shift/dates";
import { getStaffFullName } from "@/lib/shift/display";
import { isFixedDepartmentName, getGoalDepartmentLabel } from "@/lib/shift/goal";
import {
  calcContractEndDate,
  calcRenewedContractPeriod,
  DEFAULT_CONTRACT_RENEWAL_MONTHS,
  describeRenewalAlert,
  formatContractHoursLabel,
  formatTenureLabel,
  formatYen,
  getContractRenewalAlert,
  getSalaryHistoryForDisplay,
} from "@/lib/shift/staffEmployment";
import { listOperableDepartmentNames } from "@/lib/shift/adminDepartments";
import { adminPermissionLabel } from "@/lib/shift/permissions";
import type { AdminPermission, Staff } from "@/lib/shift/types";

type NewStaffForm = {
  name: string;
  firstName: string;
  email: string;
  password: string;
  team: string;
  status: "active" | "inactive";
  weeklyContractHours: string;
  hireDate: string;
  contractStartDate: string;
  contractEndDate: string;
  contractRenewalMonths: string;
  hourlyWage: string;
  adminPermission: AdminPermission;
  managedTeams: string[];
  socialInsurance: boolean;
  googleEmail: string;
  displayGivenName: boolean;
  note: string;
};

type RaiseForm = {
  staffId: string;
  effectiveDate: string;
  hourlyWage: string;
  note: string;
};

type ContractPeriodForm = {
  staffId: string;
  staffName: string;
  contractStartDate: string;
  contractEndDate: string;
  contractRenewalMonths: string;
  renewedByButton?: boolean;
};

const emptyStaffForm = (team: string): NewStaffForm => ({
  name: "",
  firstName: "",
  email: "",
  password: "",
  team,
  status: "active",
  weeklyContractHours: "20",
  hireDate: "",
  contractStartDate: "",
  contractEndDate: "",
  contractRenewalMonths: String(DEFAULT_CONTRACT_RENEWAL_MONTHS),
  hourlyWage: "1100",
  adminPermission: "general",
  managedTeams: [],
  socialInsurance: false,
  googleEmail: "",
  displayGivenName: false,
  note: "",
});

function staffToForm(staff: Staff, fallbackTeam = ""): NewStaffForm {
  return {
    name: staff.name,
    firstName: staff.firstName,
    email: staff.email,
    password: "",
    team: staff.team.trim() || fallbackTeam,
    status: staff.status,
    weeklyContractHours: Number.isFinite(staff.weeklyContractHours)
      ? String(staff.weeklyContractHours)
      : "20",
    hireDate: staff.hireDate,
    contractStartDate: staff.contractStartDate,
    contractEndDate: staff.contractEndDate,
    contractRenewalMonths: String(staff.contractRenewalMonths || DEFAULT_CONTRACT_RENEWAL_MONTHS),
    hourlyWage: String(staff.hourlyWage ?? 0),
    adminPermission: staff.adminPermission,
    managedTeams: staff.managedTeams ?? [],
    socialInsurance: staff.socialInsurance,
    googleEmail: staff.googleEmail,
    displayGivenName: staff.displayGivenName,
    note: staff.note ?? "",
  };
}

function formatSlashDate(date: string): string {
  if (!date) return "—";
  return date.replace(/-/g, "/");
}

export function AdminMaster() {
  const {
    state,
    ready,
    isAdmin,
    canManageMaster,
    canManageAdminAccounts,
    updateStaff,
    saveStaffProfile,
    refreshStaffFromSupabase,
    createStaff,
    changeStaffPassword,
    flushStaffPersistForStaff,
    addSalaryRaise,
    updateSalaryRaise,
    deleteStaff,
    addDepartment,
    updateDepartment,
    deleteDepartment,
  } = useShift();
  // departments テーブル由来の一覧だけを使う（スタッフ所属や固定名の自動注入はしない）
  const departments = useMemo(
    () => listOperableDepartmentNames(state.departments),
    [state.departments]
  );

  const teamDepartments = departments;

  const defaultStaffTeam = teamDepartments[0] ?? "";

  useEffect(() => {
    if (ready) {
      void refreshStaffFromSupabase();
    }
  }, [ready, refreshStaffFromSupabase]);

  const [newDepartment, setNewDepartment] = useState("");
  const [tab, setTab] = useState<"staff" | "admin">("staff");
  const [addStaffOpen, setAddStaffOpen] = useState(false);
  const [addAdminOpen, setAddAdminOpen] = useState(false);
  const [addTeamOpen, setAddTeamOpen] = useState(false);
  const [editingAdminId, setEditingAdminId] = useState<string | null>(null);
  const [adminPasswordDraft, setAdminPasswordDraft] = useState("");
  const [editingDepartment, setEditingDepartment] = useState<string | null>(null);
  const [departmentDraft, setDepartmentDraft] = useState("");
  const [historyStaffId, setHistoryStaffId] = useState<string | null>(null);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [editStaffForm, setEditStaffForm] = useState<NewStaffForm | null>(null);
  const [teamFilter, setTeamFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [raiseForm, setRaiseForm] = useState<RaiseForm | null>(null);
  const [contractPeriodForm, setContractPeriodForm] = useState<ContractPeriodForm | null>(null);
  const [renewedContractStaffIds, setRenewedContractStaffIds] = useState<Record<string, true>>({});
  const [raiseMessage, setRaiseMessage] = useState<string | null>(null);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [editingHistoryRaiseId, setEditingHistoryRaiseId] = useState<string | null>(null);
  const [historyEditDraft, setHistoryEditDraft] = useState<{
    effectiveDate: string;
    hourlyWage: string;
    note: string;
  } | null>(null);
  const [historyEditMessage, setHistoryEditMessage] = useState<string | null>(null);
  const [newStaff, setNewStaff] = useState<NewStaffForm>(() => emptyStaffForm(""));

  const finishAdminEdit = async (adminId: string): Promise<boolean> => {
    const flushResult = await flushStaffPersistForStaff(adminId);
    if (!flushResult.ok) {
      window.alert(flushResult.message);
      return false;
    }

    const nextPassword = adminPasswordDraft.trim();
    if (nextPassword) {
      const passwordResult = await changeStaffPassword(adminId, nextPassword);
      if (!passwordResult.ok) {
        window.alert(passwordResult.message);
        return false;
      }
    }

    setAdminPasswordDraft("");
    setEditingAdminId((prev) => (prev === adminId ? null : prev));
    return true;
  };
  const todayKey = useMemo(() => toDateKeyJst(new Date()), []);

  useEffect(() => {
    if (!newStaff.team && defaultStaffTeam) {
      setNewStaff((prev) => ({ ...prev, team: defaultStaffTeam }));
    }
  }, [defaultStaffTeam, newStaff.team]);

  useEffect(() => {
    if (!canManageAdminAccounts && tab === "admin") {
      setTab("staff");
      setAddAdminOpen(false);
      setEditingAdminId(null);
    }
  }, [canManageAdminAccounts, tab]);

  const workers = useMemo(
    () =>
      state.staffList
        .filter((staff) => staff.role === "worker")
        .slice()
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === "active" ? -1 : 1;
          return a.name.localeCompare(b.name, "ja");
        }),
    [state.staffList]
  );

  const filteredWorkers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return workers.filter((staff) => {
      if (teamFilter !== "all" && staff.team !== teamFilter) return false;
      if (statusFilter !== "all" && staff.status !== statusFilter) return false;
      if (!q) return true;
      const hay = `${staff.name}${staff.firstName}${staff.team}${staff.googleEmail}${staff.email}${staff.note ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [workers, teamFilter, statusFilter, searchQuery]);

  const renewalAlerts = useMemo(
    () =>
      workers
        .map((staff) => ({ staff, alert: getContractRenewalAlert(staff, todayKey) }))
        .filter((row) => row.alert.level !== "none"),
    [todayKey, workers]
  );

  const stats = useMemo(() => {
    const active = workers.filter((s) => s.status === "active").length;
    return {
      total: workers.length,
      active,
      inactive: workers.length - active,
      renewalSoon: renewalAlerts.length,
    };
  }, [workers, renewalAlerts]);

  const historyStaff = historyStaffId ? state.staffList.find((s) => s.id === historyStaffId) : null;

  const handleAddStaff = async () => {
    const name = newStaff.name.trim();
    const firstName = newStaff.firstName.trim();
    const email = newStaff.email.trim();
    const password = newStaff.password.trim();
    const team = newStaff.team.trim();
    const weeklyContractHours = Number(newStaff.weeklyContractHours);
    const hourlyWage = Number(newStaff.hourlyWage);
    const contractRenewalMonths = Number(newStaff.contractRenewalMonths) || DEFAULT_CONTRACT_RENEWAL_MONTHS;
    const hireDate = newStaff.hireDate;
    const contractStartDate = newStaff.contractStartDate || hireDate;
    const contractEndDate =
      newStaff.contractEndDate ||
      (contractStartDate ? calcContractEndDate(contractStartDate, contractRenewalMonths) : "");

    if (!name || !email || !password || !team || !Number.isFinite(weeklyContractHours)) {
      setFormMessage("姓・メール・パスワード・所属は必須です。");
      return false;
    }
    if (!Number.isFinite(hourlyWage) || hourlyWage < 0) {
      setFormMessage("時給を正しく入力してください。");
      return false;
    }

    const result = await createStaff({
      name,
      firstName,
      displayGivenName: newStaff.displayGivenName,
      iconLabel: "",
      password,
      email,
      team,
      managedTeams: [],
      role: "worker",
      status: "active",
      weeklyContractHours,
      adminPermission: "general",
      socialInsurance: newStaff.socialInsurance,
      googleEmail: email,
      hireDate,
      contractStartDate,
      contractEndDate,
      contractRenewalMonths,
      hourlyWage,
      salaryHistory: [],
      note: newStaff.note.trim(),
    });
    if (!result.ok) {
      setFormMessage(result.message);
      return false;
    }
    setFormMessage(null);
    setNewStaff(emptyStaffForm(team || defaultStaffTeam));
    return true;
  };

  const openEditStaff = (staff: Staff) => {
    setFormMessage(null);
    setEditingStaffId(staff.id);
    setEditStaffForm(staffToForm(staff, defaultStaffTeam));
  };

  const closeEditStaff = () => {
    setFormMessage(null);
    setEditingStaffId(null);
    setEditStaffForm(null);
  };

  const handleSaveStaff = async () => {
    if (!editingStaffId || !editStaffForm) return false;
    const editingStaff = state.staffList.find((staff) => staff.id === editingStaffId);
    const name = editStaffForm.name.trim() || editingStaff?.name.trim() || "";
    const firstName = editStaffForm.firstName.trim() || editingStaff?.firstName.trim() || "";
    const email = editStaffForm.email.trim();
    const team = editStaffForm.team.trim() || defaultStaffTeam;
    const weeklyContractHours = editStaffForm.socialInsurance
      ? Number.isFinite(Number(editStaffForm.weeklyContractHours))
        ? Number(editStaffForm.weeklyContractHours)
        : 0
      : Number(editStaffForm.weeklyContractHours);
    const contractRenewalMonths =
      Number(editStaffForm.contractRenewalMonths) || DEFAULT_CONTRACT_RENEWAL_MONTHS;
    const hireDate = editStaffForm.hireDate;
    const contractStartDate = editStaffForm.contractStartDate || hireDate;
    const contractEndDate =
      editStaffForm.contractEndDate ||
      (contractStartDate ? calcContractEndDate(contractStartDate, contractRenewalMonths) : "");

    if (!name) {
      setFormMessage("姓を入力してください。");
      return false;
    }
    if (!email) {
      setFormMessage("メールアドレスを入力してください。");
      return false;
    }
    if (!team) {
      setFormMessage("所属を選択してください。");
      return false;
    }
    if (!editStaffForm.socialInsurance && !Number.isFinite(weeklyContractHours)) {
      setFormMessage("契約時間を正しく入力してください。");
      return false;
    }

    const result = await saveStaffProfile(editingStaffId, {
      name,
      firstName,
      displayGivenName: editStaffForm.displayGivenName,
      email,
      team,
      weeklyContractHours,
      socialInsurance: editStaffForm.socialInsurance,
      googleEmail: email,
      hireDate,
      contractStartDate,
      contractEndDate,
      contractRenewalMonths,
      note: editStaffForm.note.trim(),
    });
    if (!result.ok) {
      setFormMessage(result.message);
      return false;
    }

    const nextPassword = editStaffForm.password.trim();
    if (nextPassword) {
      const passwordResult = await changeStaffPassword(editingStaffId, nextPassword);
      if (!passwordResult.ok) {
        setFormMessage(passwordResult.message);
        return false;
      }
    }

    setFormMessage(null);
    return true;
  };

  const handleAddDepartment = async () => {
    const result = await addDepartment(newDepartment);
    if (!result.ok) {
      setFormMessage(result.message);
      return;
    }
    setFormMessage(null);
    setNewDepartment("");
    setAddTeamOpen(false);
    setNewStaff((prev) => (prev.team ? prev : { ...prev, team: newDepartment.trim() }));
  };

  const openRaiseModal = (staff: Staff) => {
    setRaiseMessage(null);
    setRaiseForm({
      staffId: staff.id,
      effectiveDate: todayKey,
      hourlyWage: String(staff.hourlyWage || 0),
      note: "昇給",
    });
  };

  const openContractPeriodModal = (staff: Staff) => {
    setFormMessage(null);
    setContractPeriodForm({
      staffId: staff.id,
      staffName: getStaffFullName(staff),
      contractStartDate: staff.contractStartDate,
      contractEndDate: staff.contractEndDate,
      contractRenewalMonths: String(staff.contractRenewalMonths || DEFAULT_CONTRACT_RENEWAL_MONTHS),
      renewedByButton: false,
    });
  };

  const handleSaveContractPeriod = () => {
    if (!contractPeriodForm) return false;
    const contractRenewalMonths =
      Number(contractPeriodForm.contractRenewalMonths) || DEFAULT_CONTRACT_RENEWAL_MONTHS;
    const contractStartDate = contractPeriodForm.contractStartDate;
    const contractEndDate =
      contractPeriodForm.contractEndDate ||
      (contractStartDate ? calcContractEndDate(contractStartDate, contractRenewalMonths) : "");
    const staffId = contractPeriodForm.staffId;
    const renewedByButton = Boolean(contractPeriodForm.renewedByButton);

    updateStaff(staffId, {
      contractStartDate,
      contractEndDate,
      contractRenewalMonths,
    });
    setRenewedContractStaffIds((prev) => {
      if (renewedByButton) return { ...prev, [staffId]: true };
      const next = { ...prev };
      delete next[staffId];
      return next;
    });
    setFormMessage(null);
    setContractPeriodForm(null);
    return true;
  };

  const submitRaise = async () => {
    if (!raiseForm) return;
    const result = await addSalaryRaise(raiseForm.staffId, {
      effectiveDate: raiseForm.effectiveDate,
      hourlyWage: Number(raiseForm.hourlyWage),
      note: raiseForm.note,
    });
    if (!result.ok) {
      setRaiseMessage(result.message);
      return;
    }
    setRaiseForm(null);
    setRaiseMessage(null);
  };

  const startHistoryEdit = (entry: { id: string; effectiveDate: string; hourlyWage: number; note: string }) => {
    setHistoryEditMessage(null);
    setEditingHistoryRaiseId(entry.id);
    setHistoryEditDraft({
      effectiveDate: entry.effectiveDate || todayKey,
      hourlyWage: String(entry.hourlyWage || 0),
      note: entry.note || "",
    });
  };

  const cancelHistoryEdit = () => {
    setEditingHistoryRaiseId(null);
    setHistoryEditDraft(null);
    setHistoryEditMessage(null);
  };

  const submitHistoryEdit = async () => {
    if (!historyStaffId || !editingHistoryRaiseId || !historyEditDraft) return;
    const result = await updateSalaryRaise(historyStaffId, editingHistoryRaiseId, {
      effectiveDate: historyEditDraft.effectiveDate,
      hourlyWage: Number(historyEditDraft.hourlyWage),
      note: historyEditDraft.note,
    });
    if (!result.ok) {
      setHistoryEditMessage(result.message);
      return;
    }
    cancelHistoryEdit();
  };

  if (!isAdmin || !canManageMaster) {
    return (
      <section className="panel stack">
        <h1 className="page-title-with-icon" style={{ margin: 0 }}>
          <Icons.Master size={20} className="page-title-icon" />
          スタッフ管理
        </h1>
        <p style={{ margin: 0 }}>
          {!isAdmin
            ? "管理者ユーザーに切り替えてください。"
            : "一般権限の管理者はマスタ管理を利用できません。マネージャーまたはアルバイト管理者権限が必要です。"}
        </p>
        <div className="actions" style={{ marginTop: 0 }}>
          <Link href="/" className="btn">
            ホームへ
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="stack staff-mgmt">
      <section className="panel stack">
        <div className="actions" style={{ justifyContent: "space-between", marginTop: 0 }}>
          <div className="stack" style={{ gap: 4 }}>
            <h1 className="page-title-with-icon staff-mgmt-title" style={{ margin: 0 }}>
              <Icons.Master size={22} className="page-title-icon" />
              スタッフ管理
            </h1>
            <div className="muted">スタッフ名・契約・給与・所属を管理できます。</div>
          </div>
          <Link href="/" className="btn">
            ホームへ
          </Link>
        </div>
        <div className="staff-mgmt-tabs">
          {canManageAdminAccounts ? (
            <button
              type="button"
              className={`staff-mgmt-tab ${tab === "admin" ? "active" : ""}`}
              onClick={() => setTab("admin")}
            >
              管理者アカウント
            </button>
          ) : null}
          <button
            type="button"
            className={`staff-mgmt-tab ${tab === "staff" ? "active" : ""}`}
            onClick={() => setTab("staff")}
          >
            スタッフアカウント
          </button>
        </div>
      </section>

      {tab === "admin" && canManageAdminAccounts ? (
        <section className="panel stack">
          <div className="actions" style={{ justifyContent: "space-between", marginTop: 0 }}>
            <div className="stack" style={{ gap: 4 }}>
              <h2 style={{ margin: 0 }}>管理者アカウント</h2>
              <div className="muted">
                管理者の名前・パスワード・権限・操作可能な所属を管理できます。所属はシフト調整のガント／確定の操作範囲になります。
                パスワードは編集モードで入力し、「変更」または編集終了（✓）で Auth に反映されます（マネージャーのみ）。
              </div>
            </div>
            <div className="actions" style={{ gap: 8, marginTop: 0 }}>
              <button type="button" className="btn primary btn-action-green" onClick={() => {
                setFormMessage(null);
                setNewStaff({
                  ...emptyStaffForm(defaultStaffTeam),
                  managedTeams: defaultStaffTeam ? [defaultStaffTeam] : [],
                });
                setAddAdminOpen(true);
              }}>
                <Icons.Plus size={16} />
                管理アカウント追加
              </button>
            </div>
          </div>
          <div className="table-scroll">
            <table className="table master-table master-table-admin">
              <thead>
                <tr>
                  <th>名前</th>
                  <th>メール</th>
                  <th>パスワード</th>
                  <th>権限</th>
                  <th>操作所属</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {state.staffList
                  .filter((staff) => staff.role === "admin")
                  .map((admin) => (
                    <tr key={admin.id}>
                      <td>
                        {editingAdminId === admin.id ? (
                          <input
                            className="master-input"
                            value={admin.name}
                            onChange={(e) => updateStaff(admin.id, { name: e.target.value })}
                          />
                        ) : (
                          <span className="master-display">{admin.name}</span>
                        )}
                      </td>
                      <td>
                        {editingAdminId === admin.id ? (
                          <input
                            className="master-input"
                            type="email"
                            value={admin.email}
                            onChange={(e) => updateStaff(admin.id, { email: e.target.value })}
                            placeholder="login@example.com"
                          />
                        ) : (
                          <span className="master-display">{admin.email || "—"}</span>
                        )}
                      </td>
                      <td>
                        {editingAdminId === admin.id ? (
                          <div className="password-change-row">
                            <input
                              className="master-input"
                              type="password"
                              value={adminPasswordDraft}
                              onChange={(e) => setAdminPasswordDraft(e.target.value)}
                              placeholder="新しいパスワード"
                              autoComplete="new-password"
                            />
                            <button
                              type="button"
                              className="btn ghost-sm"
                              onClick={() => {
                                void (async () => {
                                  const result = await changeStaffPassword(admin.id, adminPasswordDraft);
                                  if (!result.ok) {
                                    window.alert(result.message);
                                    return;
                                  }
                                  setAdminPasswordDraft("");
                                  window.alert(
                                    result.message ||
                                      "パスワードを更新しました。ログイン確認用に一度ログアウトして試してください。"
                                  );
                                })();
                              }}
                            >
                              変更
                            </button>
                          </div>
                        ) : (
                          <span className="master-display">••••••</span>
                        )}
                      </td>
                      <td>
                        {editingAdminId === admin.id ? (
                          <select
                            className="master-input"
                            value={admin.adminPermission}
                            onChange={(e) =>
                              updateStaff(admin.id, { adminPermission: e.target.value as AdminPermission })
                            }
                          >
                            <option value="manager">マネージャー</option>
                            <option value="part_time_admin">アルバイト管理者</option>
                            <option value="general">一般</option>
                          </select>
                        ) : (
                          <span className="master-display">{adminPermissionLabel(admin.adminPermission)}</span>
                        )}
                      </td>
                      <td>
                        {editingAdminId === admin.id ? (
                          <div className="csv-dept-checklist admin-managed-teams">
                            {departments.map((department) => (
                              <label key={department} className="csv-dept-check">
                                <input
                                  type="checkbox"
                                  checked={admin.managedTeams.includes(department)}
                                  onChange={() => {
                                    const next = admin.managedTeams.includes(department)
                                      ? admin.managedTeams.filter((item) => item !== department)
                                      : [...admin.managedTeams, department];
                                    updateStaff(admin.id, {
                                      managedTeams: next,
                                      team: next[0] ?? "",
                                    });
                                  }}
                                />
                                <span>{department}</span>
                              </label>
                            ))}
                          </div>
                        ) : (
                          <span className="master-display">
                            {admin.managedTeams.length > 0 ? admin.managedTeams.join(" / ") : "未設定"}
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="master-actions">
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => {
                              void (async () => {
                                if (editingAdminId === admin.id) {
                                  const ok = await finishAdminEdit(admin.id);
                                  if (!ok) return;
                                  return;
                                }
                                setAdminPasswordDraft("");
                                setEditingAdminId(admin.id);
                              })();
                            }}
                            aria-label={editingAdminId === admin.id ? "編集終了" : "編集"}
                          >
                            {editingAdminId === admin.id ? <Icons.Check size={14} /> : <Icons.Pencil size={14} />}
                          </button>
                          <button
                            type="button"
                            className="icon-btn danger"
                            onClick={() => {
                              void (async () => {
                                const result = await deleteStaff(admin.id);
                                if (!result.ok) window.alert(result.message);
                              })();
                            }}
                            aria-label="削除"
                          >
                            <Icons.Trash size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <div className="stack">
          <section className="staff-mgmt-stats">
            <article className="staff-stat-card">
              <div className="staff-stat-label">総スタッフ数</div>
              <div className="staff-stat-value">{stats.total}</div>
            </article>
            <article className="staff-stat-card">
              <div className="staff-stat-label">在籍</div>
              <div className="staff-stat-value ok">{stats.active}</div>
            </article>
            <article className="staff-stat-card">
              <div className="staff-stat-label">退職</div>
              <div className="staff-stat-value muted">{stats.inactive}</div>
            </article>
            <article className="staff-stat-card">
              <div className="staff-stat-label">更新注意（30日以内）</div>
              <div className="staff-stat-value warn">{stats.renewalSoon}</div>
            </article>
            {renewalAlerts.slice(0, 2).map(({ staff, alert }) => (
              <article key={staff.id} className="staff-alert-card">
                <div className="staff-alert-body">
                  <div className="staff-alert-name">{getStaffFullName(staff)}</div>
                  <div className="staff-alert-meta">{staff.team}</div>
                  <div className={`staff-alert-badge ${alert.level}`}>
                    {describeRenewalAlert(alert)}
                  </div>
                </div>
              </article>
            ))}
          </section>

          <section className="panel stack">
            <div className="staff-list-header">
              <h2 style={{ margin: 0 }}>スタッフ一覧</h2>
              <button
                type="button"
                className="btn primary btn-action-green"
                onClick={() => {
                  setFormMessage(null);
                  setNewStaff(emptyStaffForm(defaultStaffTeam));
                  setAddStaffOpen(true);
                }}
              >
                <Icons.Plus size={16} />
                スタッフ追加
              </button>
            </div>

            <div className="staff-list-filters">
              <label className="staff-search">
                <Icons.Search size={16} />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="スタッフ名で検索"
                />
              </label>
              <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
                <option value="all">すべての所属</option>
                {teamDepartments.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "inactive")}
              >
                <option value="all">すべての状態</option>
                <option value="active">在籍</option>
                <option value="inactive">退職</option>
              </select>
            </div>

            <div className="table-scroll">
              <table className="table staff-mgmt-table">
                <thead>
                  <tr>
                    <th>スタッフ</th>
                    <th>状態</th>
                    <th>入社日</th>
                    <th>契約期間</th>
                    <th>契約h</th>
                    <th>備考</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWorkers.map((staff) => {
                    const alert = getContractRenewalAlert(staff, todayKey);
                    return (
                      <tr key={staff.id} className={alert.level !== "none" ? "row-shortage" : undefined}>
                        <td>
                          <div className="staff-cell-main">
                            <span
                              className="person-icon goal-person-icon staff-team-icon"
                              title={staff.team || "未所属"}
                            >
                              {getGoalDepartmentLabel(staff.team || "未所属")}
                            </span>
                            <div className="staff-cell-text">
                              <div className="staff-cell-name">{getStaffFullName(staff)}</div>
                              <div className="staff-cell-sub">
                                {staff.team || "未所属"}
                                {staff.email || staff.googleEmail
                                  ? ` · ${staff.email || staff.googleEmail}`
                                  : ""}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <select
                            className={`emp-status-select ${staff.status}`}
                            value={staff.status}
                            onChange={(e) =>
                              updateStaff(staff.id, { status: e.target.value as "active" | "inactive" })
                            }
                            aria-label="状態"
                          >
                            <option value="active">在籍</option>
                            <option value="inactive">退職</option>
                          </select>
                        </td>
                        <td>
                          <div className="hire-date-cell">
                            <span>{formatSlashDate(staff.hireDate)}</span>
                            {staff.hireDate ? (
                              <span className="tenure-label">{formatTenureLabel(staff.hireDate, todayKey)}</span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <div
                            className={`contract-period-cell${
                              renewedContractStaffIds[staff.id] ? " is-renewed" : ""
                            }`}
                          >
                            {alert.level !== "none" ? (
                              <button
                                type="button"
                                className="contract-period-edit-btn"
                                onClick={() => openContractPeriodModal(staff)}
                                aria-label="契約期間を編集"
                                title="契約期間を編集"
                              >
                                <Icons.Pencil size={12} />
                              </button>
                            ) : null}
                            {staff.contractStartDate || staff.contractEndDate ? (
                              <span className="contract-period-dates">
                                <span>{formatSlashDate(staff.contractStartDate)}</span>
                                <span>〜 {formatSlashDate(staff.contractEndDate)}</span>
                              </span>
                            ) : (
                              <span>—</span>
                            )}
                            {alert.level !== "none" ? (
                              <span className={`renewal-chip ${alert.level}`}>{describeRenewalAlert(alert)}</span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <span className={staff.socialInsurance ? "insurance-label" : undefined}>
                            {formatContractHoursLabel(staff)}
                          </span>
                        </td>
                        <td className="staff-note-cell">
                          {staff.note?.trim() ? (
                            <span className="staff-note-text" title={staff.note.trim()}>
                              {staff.note.trim()}
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>
                          <div className="staff-row-actions">
                            <button
                              type="button"
                              className="icon-btn"
                              onClick={() => openRaiseModal(staff)}
                              aria-label="昇給を記録"
                              title="昇給を記録"
                            >
                              <Icons.Yen size={14} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              onClick={() => {
                                cancelHistoryEdit();
                                setHistoryStaffId(staff.id);
                              }}
                              aria-label="昇給履歴"
                              title="昇給履歴"
                            >
                              <Icons.History size={14} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              onClick={() => openEditStaff(staff)}
                              aria-label="編集"
                              title="編集"
                            >
                              <Icons.Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn danger"
                              onClick={() => {
                                void (async () => {
                                  const result = await deleteStaff(staff.id);
                                  if (!result.ok) window.alert(result.message);
                                })();
                              }}
                              aria-label="削除"
                              title="削除"
                            >
                              <Icons.Trash size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredWorkers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>
                        条件に一致するスタッフがいません
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <datalist id="department-options">
              {departments.map((department) => (
                <option key={department} value={department} />
              ))}
            </datalist>
          </section>

          <section className="panel stack">
            <div className="staff-list-header">
              <div>
                <h2 style={{ margin: 0 }}>チーム管理</h2>
                <p className="muted" style={{ margin: "4px 0 0" }}>
                  所属チームの追加・編集・削除を行います。
                </p>
              </div>
              <button type="button" className="btn primary btn-action-green" onClick={() => setAddTeamOpen(true)}>
                <Icons.Plus size={16} />
                チーム追加
              </button>
            </div>
            <div className="team-card-grid">
              {teamDepartments.map((department) => {
                const isEditing = editingDepartment === department;
                const isFixedDepartment = isFixedDepartmentName(department);
                const memberCount = workers.filter((s) => s.team === department).length;
                return (
                  <article key={department} className="team-card">
                    <div className="team-card-top">
                      {isFixedDepartment ? (
                        <h3 className="team-card-name">{department}</h3>
                      ) : isEditing ? (
                        <input
                          className="master-input"
                          value={departmentDraft}
                          onChange={(e) => setDepartmentDraft(e.target.value)}
                          autoFocus
                        />
                      ) : (
                        <h3 className="team-card-name">{department}</h3>
                      )}
                      <div className="master-actions">
                        {isFixedDepartment ? (
                          <span className="badge">固定</span>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="icon-btn"
                              onClick={() => {
                                void (async () => {
                                  if (isEditing) {
                                    const result = await updateDepartment(department, departmentDraft);
                                    if (!result.ok) {
                                      window.alert(result.message);
                                      return;
                                    }
                                    setEditingDepartment(null);
                                  } else {
                                    setEditingDepartment(department);
                                    setDepartmentDraft(department);
                                  }
                                })();
                              }}
                              aria-label={isEditing ? "保存" : "編集"}
                            >
                              {isEditing ? <Icons.Check size={14} /> : <Icons.Pencil size={14} />}
                            </button>
                            <button
                              type="button"
                              className="icon-btn danger"
                              onClick={() => {
                                void (async () => {
                                  const result = await deleteDepartment(department);
                                  if (!result.ok) {
                                    window.alert(result.message);
                                    return;
                                  }
                                  if (editingDepartment === department) setEditingDepartment(null);
                                })();
                              }}
                              aria-label="削除"
                            >
                              <Icons.Trash size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="team-card-count">{memberCount}名</div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {addStaffOpen && (
        <StaffFormModal
          title="新規スタッフ追加"
          form={newStaff}
          setForm={setNewStaff}
          departments={departments}
          message={formMessage}
          onCancel={() => {
            setFormMessage(null);
            setAddStaffOpen(false);
          }}
          onSubmit={async () => {
            if (await handleAddStaff()) setAddStaffOpen(false);
          }}
          submitLabel="追加"
        />
      )}

      {editingStaffId && editStaffForm ? (
        <StaffFormModal
          title="スタッフ編集"
          mode="edit"
          form={editStaffForm}
          setForm={(updater) => {
            setEditStaffForm((prev) => {
              if (!prev) return prev;
              return typeof updater === "function" ? updater(prev) : updater;
            });
          }}
          departments={departments}
          message={formMessage}
          onChangePassword={async (password) => changeStaffPassword(editingStaffId, password)}
          onCancel={closeEditStaff}
          onSubmit={async () => {
            if (await handleSaveStaff()) closeEditStaff();
          }}
          submitLabel="保存"
        />
      ) : null}

      {addTeamOpen && (
        <div className="modal-backdrop" onClick={() => setAddTeamOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>チーム追加</h3>
            <div className="form-grid master-form-grid">
              <label>
                チーム名
                <input
                  value={newDepartment}
                  onChange={(e) => setNewDepartment(e.target.value)}
                  placeholder="例: 第4チーム"
                  autoFocus
                />
              </label>
            </div>
            {formMessage ? <p className="badge warn">{formMessage}</p> : null}
            <div className="actions" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn primary btn-action-green"
                onClick={() => void handleAddDepartment()}
              >
                追加
              </button>
              <button type="button" className="btn" onClick={() => setAddTeamOpen(false)}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {addAdminOpen && (
        <div className="modal-backdrop" onClick={() => setAddAdminOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>新規管理アカウント追加</h3>
            <div className="form-grid master-form-grid">
              <label>
                名前
                <input value={newStaff.name} onChange={(e) => setNewStaff((prev) => ({ ...prev, name: e.target.value }))} />
              </label>
              <label>
                ログイン用メール
                <input
                  type="email"
                  value={newStaff.email}
                  onChange={(e) => setNewStaff((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="admin@example.com"
                />
              </label>
              <label>
                ログインパスワード
                <input
                  type="password"
                  value={newStaff.password}
                  onChange={(e) => setNewStaff((prev) => ({ ...prev, password: e.target.value }))}
                />
              </label>
              <label>
                権限
                <select
                  value={newStaff.adminPermission}
                  onChange={(e) =>
                    setNewStaff((prev) => ({ ...prev, adminPermission: e.target.value as AdminPermission }))
                  }
                >
                  <option value="manager">マネージャー</option>
                  <option value="part_time_admin">アルバイト管理者</option>
                  <option value="general">一般</option>
                </select>
              </label>
              <div className="stack" style={{ gap: 6 }}>
                <span>操作できる所属（複数可）</span>
                <div className="csv-dept-checklist">
                  {departments.map((department) => (
                    <label key={department} className="csv-dept-check">
                      <input
                        type="checkbox"
                        checked={newStaff.managedTeams.includes(department)}
                        onChange={() => {
                          setNewStaff((prev) => {
                            const next = prev.managedTeams.includes(department)
                              ? prev.managedTeams.filter((item) => item !== department)
                              : [...prev.managedTeams, department];
                            return { ...prev, managedTeams: next, team: next[0] ?? "" };
                          });
                        }}
                      />
                      <span>{department}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              選択した所属のシフト調整（ガント・確定）を操作できます。一般はマスタ管理不可。アルバイト管理者は管理者アカウントにアクセスできません。
            </p>
            {formMessage ? <p className="badge warn">{formMessage}</p> : null}
            <div className="actions" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn primary btn-action-green"
                onClick={async () => {
                  const name = newStaff.name.trim();
                  const email = newStaff.email.trim();
                  const password = newStaff.password.trim();
                  if (!name || !email || !password) {
                    setFormMessage("名前・メール・パスワードは必須です。");
                    return;
                  }
                  if (password.length < 6) {
                    setFormMessage("パスワードは6文字以上にしてください。");
                    return;
                  }
                  if (newStaff.managedTeams.length === 0) {
                    setFormMessage("操作できる所属を1つ以上選択してください。");
                    return;
                  }
                  if (departments.length === 0) {
                    setFormMessage("所属マスタが未設定です。先に「所属管理」でチームを追加してください。");
                    return;
                  }
                  const result = await createStaff({
                    name,
                    firstName: "",
                    displayGivenName: false,
                    iconLabel: "",
                    password,
                    email,
                    team: newStaff.managedTeams[0],
                    managedTeams: newStaff.managedTeams,
                    role: "admin",
                    adminPermission: newStaff.adminPermission,
                    status: "active",
                    weeklyContractHours: 40,
                    socialInsurance: false,
                    googleEmail: "",
                    hireDate: "",
                    contractStartDate: "",
                    contractEndDate: "",
                    contractRenewalMonths: DEFAULT_CONTRACT_RENEWAL_MONTHS,
                    hourlyWage: 0,
                    salaryHistory: [],
                    note: "",
                  });
                  if (!result.ok) {
                    setFormMessage(result.message);
                    return;
                  }
                  setFormMessage(null);
                  setNewStaff(emptyStaffForm(defaultStaffTeam));
                  setAddAdminOpen(false);
                }}
              >
                追加
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setFormMessage(null);
                  setAddAdminOpen(false);
                }}
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {raiseForm && (
        <div className="modal-backdrop" onClick={() => setRaiseForm(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>昇給を記録</h3>
            <div className="form-grid master-form-grid">
              <label>
                適用日
                <input
                  type="date"
                  value={raiseForm.effectiveDate}
                  onChange={(e) => setRaiseForm((prev) => (prev ? { ...prev, effectiveDate: e.target.value } : prev))}
                />
              </label>
              <label>
                時給（円）
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={raiseForm.hourlyWage}
                  onChange={(e) => setRaiseForm((prev) => (prev ? { ...prev, hourlyWage: e.target.value } : prev))}
                />
              </label>
              <label>
                備考
                <input
                  value={raiseForm.note}
                  onChange={(e) => setRaiseForm((prev) => (prev ? { ...prev, note: e.target.value } : prev))}
                  placeholder="昇給 / 契約更新時 など"
                />
              </label>
            </div>
            {raiseMessage ? <p className="badge warn">{raiseMessage}</p> : null}
            <div className="actions" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn primary btn-action-green" onClick={submitRaise}>
                記録
              </button>
              <button type="button" className="btn" onClick={() => setRaiseForm(null)}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {contractPeriodForm ? (
        <div className="modal-backdrop" onClick={() => setContractPeriodForm(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>契約期間の編集</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              {contractPeriodForm.staffName}
            </p>
            <div className="form-grid master-form-grid staff-form-grid">
              <div className="staff-form-renew staff-form-span contract-period-renew-block">
                <button
                  type="button"
                  className="btn primary btn-action-green contract-period-renew-btn"
                  title="現行契約の翌月1日から3か月分を自動入力"
                  onClick={() => {
                    setContractPeriodForm((prev) => {
                      if (!prev) return prev;
                      const renewed = calcRenewedContractPeriod(
                        prev.contractEndDate,
                        prev.contractStartDate,
                        DEFAULT_CONTRACT_RENEWAL_MONTHS
                      );
                      return {
                        ...prev,
                        contractStartDate: renewed.contractStartDate,
                        contractEndDate: renewed.contractEndDate,
                        contractRenewalMonths: String(renewed.contractRenewalMonths),
                        renewedByButton: true,
                      };
                    });
                  }}
                >
                  3か月更新
                </button>
                <span className="contract-period-renew-hint">
                  終了月の翌月1日〜3か月を自動入力
                </span>
              </div>
              <label className={contractPeriodForm.renewedByButton ? "contract-period-field-renewed" : undefined}>
                契約開始日
                <input
                  type="date"
                  value={contractPeriodForm.contractStartDate}
                  onChange={(e) => {
                    const contractStartDate = e.target.value;
                    setContractPeriodForm((prev) => {
                      if (!prev) return prev;
                      const months =
                        Number(prev.contractRenewalMonths) || DEFAULT_CONTRACT_RENEWAL_MONTHS;
                      return {
                        ...prev,
                        contractStartDate,
                        contractEndDate:
                          prev.contractEndDate || calcContractEndDate(contractStartDate, months),
                        renewedByButton: false,
                      };
                    });
                  }}
                />
              </label>
              <label className={contractPeriodForm.renewedByButton ? "contract-period-field-renewed" : undefined}>
                契約終了日
                <input
                  type="date"
                  value={contractPeriodForm.contractEndDate}
                  onChange={(e) =>
                    setContractPeriodForm((prev) =>
                      prev
                        ? { ...prev, contractEndDate: e.target.value, renewedByButton: false }
                        : prev
                    )
                  }
                />
              </label>
              <label>
                更新間隔（か月）
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={contractPeriodForm.contractRenewalMonths}
                  onChange={(e) =>
                    setContractPeriodForm((prev) =>
                      prev ? { ...prev, contractRenewalMonths: e.target.value } : prev
                    )
                  }
                />
              </label>
            </div>
            {formMessage ? <p className="badge warn">{formMessage}</p> : null}
            <div className="actions" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn primary btn-action-green"
                onClick={() => {
                  handleSaveContractPeriod();
                }}
              >
                保存
              </button>
              <button type="button" className="btn" onClick={() => setContractPeriodForm(null)}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {historyStaff && (
        <div
          className="modal-backdrop"
          onClick={() => {
            cancelHistoryEdit();
            setHistoryStaffId(null);
          }}
        >
          <div className="modal-panel modal-panel-wide" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>
              昇給履歴（{historyStaff.name}
              {historyStaff.firstName}）
            </h3>
            <p className="muted" style={{ marginTop: 0 }}>
              現行時給 {formatYen(historyStaff.hourlyWage)}
            </p>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>適用日</th>
                    <th>時給</th>
                    <th>備考</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {getSalaryHistoryForDisplay(historyStaff).map((entry) => {
                    const editing = editingHistoryRaiseId === entry.id;
                    return (
                      <tr key={entry.id}>
                        <td>
                          {editing && historyEditDraft ? (
                            <input
                              className="master-input"
                              type="date"
                              value={historyEditDraft.effectiveDate}
                              onChange={(e) =>
                                setHistoryEditDraft((prev) =>
                                  prev ? { ...prev, effectiveDate: e.target.value } : prev
                                )
                              }
                            />
                          ) : entry.effectiveDate ? (
                            formatSlashDate(entry.effectiveDate)
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {editing && historyEditDraft ? (
                            <input
                              className="master-input master-input-wage"
                              type="number"
                              min="0"
                              step="10"
                              value={historyEditDraft.hourlyWage}
                              onChange={(e) =>
                                setHistoryEditDraft((prev) =>
                                  prev ? { ...prev, hourlyWage: e.target.value } : prev
                                )
                              }
                            />
                          ) : (
                            formatYen(entry.hourlyWage)
                          )}
                        </td>
                        <td>
                          {editing && historyEditDraft ? (
                            <input
                              className="master-input"
                              value={historyEditDraft.note}
                              onChange={(e) =>
                                setHistoryEditDraft((prev) => (prev ? { ...prev, note: e.target.value } : prev))
                              }
                              placeholder="初任給 / 昇給 など"
                            />
                          ) : (
                            entry.note || "—"
                          )}
                        </td>
                        <td>
                          <div className="staff-row-actions">
                            {editing ? (
                              <>
                                <button
                                  type="button"
                                  className="icon-btn"
                                  onClick={() => void submitHistoryEdit()}
                                  aria-label="保存"
                                  title="保存"
                                >
                                  <Icons.Check size={14} />
                                </button>
                                <button
                                  type="button"
                                  className="icon-btn"
                                  onClick={cancelHistoryEdit}
                                  aria-label="キャンセル"
                                  title="キャンセル"
                                >
                                  <Icons.Close size={14} />
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="icon-btn"
                                onClick={() => startHistoryEdit(entry)}
                                aria-label="編集"
                                title="編集"
                              >
                                <Icons.Pencil size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {getSalaryHistoryForDisplay(historyStaff).length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        履歴はまだありません
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {historyEditMessage ? <p className="badge warn">{historyEditMessage}</p> : null}
            <div className="actions" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  cancelHistoryEdit();
                  setHistoryStaffId(null);
                }}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StaffFormModal({
  title,
  form,
  setForm,
  departments,
  message,
  onCancel,
  onSubmit,
  submitLabel,
  mode = "create",
  onChangePassword,
}: {
  title: string;
  form: NewStaffForm;
  setForm: (updater: SetStateAction<NewStaffForm>) => void;
  departments: string[];
  message?: string | null;
  onCancel: () => void;
  onSubmit: () => void | Promise<void>;
  submitLabel: string;
  mode?: "create" | "edit";
  onChangePassword?: (
    password: string
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  useEffect(() => {
    if (mode !== "edit") return;
    if (!form.team.trim() && departments[0]) {
      setForm((prev) => ({ ...prev, team: departments[0] }));
    }
  }, [mode, departments, form.team, setForm]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-panel modal-panel-wide" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <div className="form-grid master-form-grid staff-form-grid">
          <div className="staff-form-name-row">
            <label className="staff-form-name">
              姓（必須）
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="例: 山田"
                autoFocus
              />
            </label>
            <label className="staff-form-name">
              名
              <input
                type="text"
                value={form.firstName}
                onChange={(e) => setForm((prev) => ({ ...prev, firstName: e.target.value }))}
                placeholder="例: 太郎"
              />
            </label>
            <div className="staff-form-name-check">
              <span>名表示</span>
              <input
                type="checkbox"
                checked={form.displayGivenName}
                onChange={(e) => setForm((prev) => ({ ...prev, displayGivenName: e.target.checked }))}
              />
            </div>
          </div>
          <label>
            ログイン用メール
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              placeholder="staff@example.com"
            />
          </label>
          {mode === "edit" ? (
            <label>
              パスワード変更
              <div className="password-change-row">
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="新しいパスワード（6文字以上）"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="btn ghost-sm"
                  onClick={() => {
                    void (async () => {
                      if (!onChangePassword) return;
                      const result = await onChangePassword(form.password);
                      if (!result.ok) {
                        window.alert(result.message);
                        return;
                      }
                      setForm((prev) => ({ ...prev, password: "" }));
                      window.alert("パスワードを更新しました。");
                    })();
                  }}
                >
                  変更
                </button>
              </div>
            </label>
          ) : (
            <label>
              ログインパスワード
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
              />
            </label>
          )}
          <div className="staff-form-pair-row">
            <label>
              所属
              <select
                value={form.team || departments[0] || ""}
                onChange={(e) => setForm((prev) => ({ ...prev, team: e.target.value }))}
              >
                {!form.team && !departments[0] ? (
                  <option value="">所属を選択</option>
                ) : null}
                {departments.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
                {form.team && !departments.includes(form.team) ? (
                  <option value={form.team}>{form.team}</option>
                ) : null}
              </select>
            </label>
            <label>
              入社日
              <input
                type="date"
                value={form.hireDate}
                onChange={(e) => {
                  const hireDate = e.target.value;
                  setForm((prev) => {
                    const contractStartDate = prev.contractStartDate || hireDate;
                    const months = Number(prev.contractRenewalMonths) || DEFAULT_CONTRACT_RENEWAL_MONTHS;
                    return {
                      ...prev,
                      hireDate,
                      contractStartDate,
                      contractEndDate: prev.contractEndDate || calcContractEndDate(contractStartDate, months),
                    };
                  });
                }}
              />
            </label>
          </div>
          <div className="staff-form-pair-row">
            <div className="staff-insurance-field">
              <span className="staff-insurance-label">社保有無</span>
              <span className="staff-insurance-check-group">
                <label className="staff-insurance-option">
                  <input
                    type="checkbox"
                    checked={form.socialInsurance}
                    onChange={() => setForm((prev) => ({ ...prev, socialInsurance: true }))}
                  />
                  <span>あり</span>
                </label>
                <label className="staff-insurance-option">
                  <input
                    type="checkbox"
                    checked={!form.socialInsurance}
                    onChange={() => setForm((prev) => ({ ...prev, socialInsurance: false }))}
                  />
                  <span>なし</span>
                </label>
              </span>
            </div>
            {!form.socialInsurance ? (
              <label>
                契約時間（h）
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.weeklyContractHours}
                  onChange={(e) => setForm((prev) => ({ ...prev, weeklyContractHours: e.target.value }))}
                />
              </label>
            ) : (
              <div aria-hidden="true" />
            )}
          </div>
          <label>
            契約開始日
            <input
              type="date"
              value={form.contractStartDate}
              onChange={(e) => {
                const contractStartDate = e.target.value;
                const months = Number(form.contractRenewalMonths) || DEFAULT_CONTRACT_RENEWAL_MONTHS;
                setForm((prev) => ({
                  ...prev,
                  contractStartDate,
                  contractEndDate: prev.contractEndDate || calcContractEndDate(contractStartDate, months),
                }));
              }}
            />
          </label>
          <label>
            契約終了日
            <input
              type="date"
              value={form.contractEndDate}
              onChange={(e) => setForm((prev) => ({ ...prev, contractEndDate: e.target.value }))}
            />
          </label>
          <label>
            更新間隔（か月）
            <input
              type="number"
              min="1"
              step="1"
              value={form.contractRenewalMonths}
              onChange={(e) => setForm((prev) => ({ ...prev, contractRenewalMonths: e.target.value }))}
            />
          </label>
          {mode === "edit" ? (
            <div className="staff-form-renew">
              <button
                type="button"
                className="btn ghost-sm contract-renew-btn"
                title="現行契約の翌月1日から3か月分を自動入力"
                onClick={() => {
                  const renewed = calcRenewedContractPeriod(
                    form.contractEndDate,
                    form.contractStartDate || form.hireDate,
                    DEFAULT_CONTRACT_RENEWAL_MONTHS
                  );
                  setForm((prev) => ({
                    ...prev,
                    contractStartDate: renewed.contractStartDate,
                    contractEndDate: renewed.contractEndDate,
                    contractRenewalMonths: String(renewed.contractRenewalMonths),
                  }));
                }}
              >
                3か月更新
              </button>
              <span className="muted" style={{ fontSize: 11 }}>
                終了月の翌月1日〜3か月を自動入力
              </span>
            </div>
          ) : null}
          {mode === "create" ? (
            <label>
              時給（円）
              <input
                type="number"
                min="0"
                step="10"
                value={form.hourlyWage}
                onChange={(e) => setForm((prev) => ({ ...prev, hourlyWage: e.target.value }))}
              />
            </label>
          ) : null}
          <label className="staff-form-span">
            備考
            <textarea
              value={form.note}
              onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
              placeholder="連絡事項・注意点など（任意）"
              rows={3}
            />
          </label>
        </div>
        {message ? <p className="badge warn">{message}</p> : null}
        <div className="actions" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn primary btn-action-green" onClick={() => void onSubmit()}>
            {submitLabel}
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
