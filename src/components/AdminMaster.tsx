"use client";

import { useEffect, useMemo, useState, type SetStateAction } from "react";
import Link from "next/link";
import { Icons } from "@/components/icons";
import { useShift } from "@/context/ShiftContext";
import { toDateKeyJst } from "@/lib/shift/dates";
import { getStaffFullName } from "@/lib/shift/display";
import { DEFAULT_GOAL_DEPARTMENT } from "@/lib/shift/goal";
import {
  calcContractEndDate,
  calcRenewedContractPeriod,
  DEFAULT_CONTRACT_RENEWAL_MONTHS,
  describeRenewalAlert,
  formatContractHoursLabel,
  formatYen,
  getContractRenewalAlert,
  sortSalaryHistory,
} from "@/lib/shift/staffEmployment";
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
  socialInsurance: boolean;
  googleEmail: string;
  displayGivenName: boolean;
};

type RaiseForm = {
  staffId: string;
  effectiveDate: string;
  hourlyWage: string;
  note: string;
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
  socialInsurance: false,
  googleEmail: "",
  displayGivenName: false,
});

function adminPermissionLabel(permission: AdminPermission): string {
  return permission === "manager" ? "マネージャー" : "一般";
}

function formatSlashDate(date: string): string {
  if (!date) return "—";
  return date.replace(/-/g, "/");
}

export function AdminMaster() {
  const { state, isAdmin, canManageMaster, usingSupabaseAuth, updateStaff, createStaff, addSalaryRaise, deleteStaff, addDepartment, updateDepartment, deleteDepartment } =
    useShift();
  const departments = useMemo(() => {
    const base =
      state.departments.length > 0 ? state.departments : Array.from(new Set(state.staffList.map((s) => s.team)));
    // Supabase 同期時は DB にある所属だけを使う（存在しない「リクルーティング」を先頭注入しない）
    if (usingSupabaseAuth) return base;
    return base.includes(DEFAULT_GOAL_DEPARTMENT) ? base : [DEFAULT_GOAL_DEPARTMENT, ...base];
  }, [state.departments, state.staffList, usingSupabaseAuth]);

  const teamDepartments = useMemo(
    () => departments.filter((department) => department !== "本部"),
    [departments]
  );

  const defaultStaffTeam = teamDepartments[0] ?? departments[0] ?? "";

  const [newDepartment, setNewDepartment] = useState("");
  const [tab, setTab] = useState<"staff" | "admin">("staff");
  const [addStaffOpen, setAddStaffOpen] = useState(false);
  const [addAdminOpen, setAddAdminOpen] = useState(false);
  const [addTeamOpen, setAddTeamOpen] = useState(false);
  const [editingAdminId, setEditingAdminId] = useState<string | null>(null);
  const [editingDepartment, setEditingDepartment] = useState<string | null>(null);
  const [departmentDraft, setDepartmentDraft] = useState("");
  const [historyStaffId, setHistoryStaffId] = useState<string | null>(null);
  const [detailStaffId, setDetailStaffId] = useState<string | null>(null);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [menuStaffId, setMenuStaffId] = useState<string | null>(null);
  const [teamFilter, setTeamFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [raiseForm, setRaiseForm] = useState<RaiseForm | null>(null);
  const [raiseMessage, setRaiseMessage] = useState<string | null>(null);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [newStaff, setNewStaff] = useState<NewStaffForm>(() => emptyStaffForm(""));
  const todayKey = useMemo(() => toDateKeyJst(new Date()), []);

  useEffect(() => {
    if (!newStaff.team && defaultStaffTeam) {
      setNewStaff((prev) => ({ ...prev, team: defaultStaffTeam }));
    }
  }, [defaultStaffTeam, newStaff.team]);

  useEffect(() => {
    if (!menuStaffId) return;
    const close = () => setMenuStaffId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuStaffId]);

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
      const hay = `${staff.name}${staff.firstName}${staff.team}${staff.googleEmail}`.toLowerCase();
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
  const detailStaff = detailStaffId ? state.staffList.find((s) => s.id === detailStaffId) : null;

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

    if (!name || !firstName || !email || !password || !team || !Number.isFinite(weeklyContractHours)) {
      setFormMessage("姓・名・メール・パスワード・所属は必須です。");
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
      role: "worker",
      status: newStaff.status,
      weeklyContractHours,
      adminPermission: "general",
      socialInsurance: newStaff.socialInsurance,
      googleEmail: newStaff.googleEmail.trim() || email,
      hireDate,
      contractStartDate,
      contractEndDate,
      contractRenewalMonths,
      hourlyWage,
      salaryHistory: [],
    });
    if (!result.ok) {
      setFormMessage(result.message);
      return false;
    }
    setFormMessage(null);
    setNewStaff(emptyStaffForm(team || defaultStaffTeam));
    return true;
  };

  const handleAddDepartment = () => {
    const result = addDepartment(newDepartment);
    if (result.ok) {
      setNewDepartment("");
      setAddTeamOpen(false);
      setNewStaff((prev) => (prev.team ? prev : { ...prev, team: newDepartment.trim() }));
    }
  };

  const openRaiseModal = (staff: Staff) => {
    setMenuStaffId(null);
    setRaiseMessage(null);
    setRaiseForm({
      staffId: staff.id,
      effectiveDate: todayKey,
      hourlyWage: String(staff.hourlyWage || 0),
      note: "昇給",
    });
  };

  const submitRaise = () => {
    if (!raiseForm) return;
    const result = addSalaryRaise(raiseForm.staffId, {
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
            : "一般権限の管理者はマスタ管理を利用できません。マネージャー権限が必要です。"}
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
          <button
            type="button"
            className={`staff-mgmt-tab ${tab === "admin" ? "active" : ""}`}
            onClick={() => setTab("admin")}
          >
            管理者アカウント
          </button>
          <button
            type="button"
            className={`staff-mgmt-tab ${tab === "staff" ? "active" : ""}`}
            onClick={() => setTab("staff")}
          >
            スタッフアカウント
          </button>
        </div>
      </section>

      {tab === "admin" ? (
        <section className="panel stack">
          <div className="actions" style={{ justifyContent: "space-between", marginTop: 0 }}>
            <div className="stack" style={{ gap: 4 }}>
              <h2 style={{ margin: 0 }}>管理者アカウント</h2>
              <div className="muted">管理者の名前・パスワード・権限を管理できます。一般権限はマスタ管理を開けません。</div>
            </div>
            <button type="button" className="btn primary btn-action-green" onClick={() => setAddAdminOpen(true)}>
              <Icons.Plus size={16} />
              管理アカウント追加
            </button>
          </div>
          <div className="table-scroll">
            <table className="table master-table master-table-admin">
              <thead>
                <tr>
                  <th>名前</th>
                  <th>メール</th>
                  <th>パスワード</th>
                  <th>権限</th>
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
                          <input
                            className="master-input"
                            value={admin.password}
                            onChange={(e) => updateStaff(admin.id, { password: e.target.value })}
                          />
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
                            <option value="general">一般</option>
                          </select>
                        ) : (
                          <span className="master-display">{adminPermissionLabel(admin.adminPermission)}</span>
                        )}
                      </td>
                      <td>
                        <div className="master-actions">
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => setEditingAdminId((prev) => (prev === admin.id ? null : admin.id))}
                            aria-label={editingAdminId === admin.id ? "編集終了" : "編集"}
                          >
                            {editingAdminId === admin.id ? <Icons.Check size={14} /> : <Icons.Pencil size={14} />}
                          </button>
                          <button
                            type="button"
                            className="icon-btn danger"
                            onClick={() => deleteStaff(admin.id)}
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
                    <th>所属</th>
                    <th>状態</th>
                    <th>入社日</th>
                    <th>契約期間</th>
                    <th>時給</th>
                    <th>契約h</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWorkers.map((staff) => {
                    const alert = getContractRenewalAlert(staff, todayKey);
                    const editing = editingStaffId === staff.id;
                    return (
                      <tr key={staff.id} className={alert.level !== "none" ? "row-shortage" : undefined}>
                        <td>
                          {editing ? (
                            <div className="staff-name-edit">
                              <input
                                className="master-input"
                                value={staff.name}
                                onChange={(e) => updateStaff(staff.id, { name: e.target.value })}
                                placeholder="姓"
                              />
                              <input
                                className="master-input"
                                value={staff.firstName}
                                onChange={(e) => updateStaff(staff.id, { firstName: e.target.value })}
                                placeholder="名"
                              />
                            </div>
                          ) : (
                            <div>
                              <div className="staff-cell-name">{getStaffFullName(staff)}</div>
                              {staff.email || staff.googleEmail ? (
                                <div className="staff-cell-sub">{staff.email || staff.googleEmail}</div>
                              ) : null}
                            </div>
                          )}
                        </td>
                        <td>
                          {editing ? (
                            <select
                              className="master-input"
                              value={staff.team}
                              onChange={(e) => updateStaff(staff.id, { team: e.target.value })}
                            >
                              {!teamDepartments.includes(staff.team) && staff.team ? (
                                <option value={staff.team}>{staff.team}</option>
                              ) : null}
                              {teamDepartments.map((department) => (
                                <option key={department} value={department}>
                                  {department}
                                </option>
                              ))}
                            </select>
                          ) : (
                            staff.team
                          )}
                        </td>
                        <td>
                          {editing ? (
                            <select
                              className="master-input"
                              value={staff.status}
                              onChange={(e) =>
                                updateStaff(staff.id, { status: e.target.value as "active" | "inactive" })
                              }
                            >
                              <option value="active">在籍</option>
                              <option value="inactive">退職</option>
                            </select>
                          ) : (
                            <span className={`emp-status ${staff.status}`}>
                              {staff.status === "active" ? "在籍" : "退職"}
                            </span>
                          )}
                        </td>
                        <td>
                          {editing ? (
                            <input
                              className="master-input"
                              type="date"
                              value={staff.hireDate}
                              onChange={(e) => updateStaff(staff.id, { hireDate: e.target.value })}
                            />
                          ) : (
                            formatSlashDate(staff.hireDate)
                          )}
                        </td>
                        <td>
                          {editing ? (
                            <div className="master-contract-edit">
                              <input
                                className="master-input"
                                type="date"
                                value={staff.contractStartDate}
                                onChange={(e) => {
                                  const start = e.target.value;
                                  updateStaff(staff.id, {
                                    contractStartDate: start,
                                    contractEndDate:
                                      staff.contractEndDate ||
                                      calcContractEndDate(start, staff.contractRenewalMonths),
                                  });
                                }}
                              />
                              <span className="muted">〜</span>
                              <input
                                className="master-input"
                                type="date"
                                value={staff.contractEndDate}
                                onChange={(e) => updateStaff(staff.id, { contractEndDate: e.target.value })}
                              />
                              <button
                                type="button"
                                className="btn ghost-sm contract-renew-btn"
                                title="現行契約の翌月1日から3か月分を自動入力"
                                onClick={() => {
                                  const renewed = calcRenewedContractPeriod(
                                    staff.contractEndDate,
                                    staff.contractStartDate,
                                    DEFAULT_CONTRACT_RENEWAL_MONTHS,
                                    todayKey
                                  );
                                  updateStaff(staff.id, renewed);
                                }}
                              >
                                3か月更新済
                              </button>
                              {alert.level !== "none" ? (
                                <span className={`renewal-chip ${alert.level}`}>{describeRenewalAlert(alert)}</span>
                              ) : null}
                            </div>
                          ) : (
                            <div className="contract-period-cell">
                              <span>
                                {staff.contractStartDate || staff.contractEndDate
                                  ? `${formatSlashDate(staff.contractStartDate)} 〜 ${formatSlashDate(staff.contractEndDate)}`
                                  : "—"}
                              </span>
                              {alert.level !== "none" ? (
                                <span className={`renewal-chip ${alert.level}`}>{describeRenewalAlert(alert)}</span>
                              ) : null}
                            </div>
                          )}
                        </td>
                        <td>
                          {editing ? (
                            <input
                              className="master-input master-input-wage"
                              type="number"
                              min="0"
                              step="10"
                              value={staff.hourlyWage}
                              onChange={(e) => updateStaff(staff.id, { hourlyWage: Number(e.target.value) || 0 })}
                            />
                          ) : (
                            formatYen(staff.hourlyWage)
                          )}
                        </td>
                        <td>
                          {editing ? (
                            <div className="master-contract-hours-edit">
                              <select
                                className="master-input"
                                value={staff.socialInsurance ? "insured" : "hours"}
                                onChange={(e) => {
                                  const insured = e.target.value === "insured";
                                  updateStaff(staff.id, { socialInsurance: insured });
                                }}
                              >
                                <option value="hours">契約h</option>
                                <option value="insured">社会保険あり</option>
                              </select>
                              {!staff.socialInsurance ? (
                                <input
                                  className="master-input"
                                  type="number"
                                  min="0"
                                  step="0.5"
                                  value={staff.weeklyContractHours}
                                  onChange={(e) =>
                                    updateStaff(staff.id, { weeklyContractHours: Number(e.target.value) || 0 })
                                  }
                                />
                              ) : null}
                            </div>
                          ) : (
                            <span className={staff.socialInsurance ? "insurance-label" : undefined}>
                              {formatContractHoursLabel(staff)}
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="staff-row-actions">
                            <button type="button" className="btn ghost-sm" onClick={() => setDetailStaffId(staff.id)}>
                              詳細
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              onClick={() => setEditingStaffId((prev) => (prev === staff.id ? null : staff.id))}
                              aria-label={editing ? "編集終了" : "編集"}
                              title={editing ? "編集終了" : "編集"}
                            >
                              {editing ? <Icons.Check size={14} /> : <Icons.Pencil size={14} />}
                            </button>
                            <div className="staff-more-wrap">
                              <button
                                type="button"
                                className="icon-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMenuStaffId((prev) => (prev === staff.id ? null : staff.id));
                                }}
                                aria-label="その他"
                                title="その他"
                              >
                                <Icons.More size={14} />
                              </button>
                              {menuStaffId === staff.id ? (
                                <div className="staff-more-menu" onClick={(e) => e.stopPropagation()}>
                                  <button type="button" onClick={() => openRaiseModal(staff)}>
                                    <Icons.Yen size={14} />
                                    昇給を記録
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMenuStaffId(null);
                                      setHistoryStaffId(staff.id);
                                    }}
                                  >
                                    <Icons.History size={14} />
                                    昇給履歴
                                  </button>
                                  <button
                                    type="button"
                                    className="danger"
                                    onClick={() => {
                                      setMenuStaffId(null);
                                      deleteStaff(staff.id);
                                    }}
                                  >
                                    <Icons.Trash size={14} />
                                    削除
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredWorkers.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="muted" style={{ textAlign: "center", padding: 24 }}>
                        条件に一致するスタッフがいません
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {editingStaffId ? (
              <StaffExtraEdit
                staff={state.staffList.find((s) => s.id === editingStaffId)}
                onChange={(patch) => updateStaff(editingStaffId, patch)}
              />
            ) : null}
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
                const isFixedDepartment = department === DEFAULT_GOAL_DEPARTMENT;
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
                                if (isEditing) {
                                  updateDepartment(department, departmentDraft);
                                  setEditingDepartment(null);
                                } else {
                                  setEditingDepartment(department);
                                  setDepartmentDraft(department);
                                }
                              }}
                              aria-label={isEditing ? "保存" : "編集"}
                            >
                              {isEditing ? <Icons.Check size={14} /> : <Icons.Pencil size={14} />}
                            </button>
                            <button
                              type="button"
                              className="icon-btn danger"
                              onClick={() => {
                                deleteDepartment(department);
                                if (editingDepartment === department) setEditingDepartment(null);
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

      {detailStaff && (
        <div className="modal-backdrop" onClick={() => setDetailStaffId(null)}>
          <div className="modal-panel modal-panel-wide" onClick={(e) => e.stopPropagation()}>
            <div className="staff-detail-head">
              <div>
                <h3 style={{ margin: 0 }}>{getStaffFullName(detailStaff)}</h3>
                <div className="muted">{detailStaff.team}</div>
              </div>
              <span className={`emp-status ${detailStaff.status}`}>
                {detailStaff.status === "active" ? "在籍" : "退職"}
              </span>
            </div>
            <div className="staff-detail-grid">
              <DetailItem label="入社日" value={formatSlashDate(detailStaff.hireDate)} />
              <DetailItem
                label="契約期間"
                value={
                  detailStaff.contractStartDate || detailStaff.contractEndDate
                    ? `${formatSlashDate(detailStaff.contractStartDate)} 〜 ${formatSlashDate(detailStaff.contractEndDate)}`
                    : "—"
                }
              />
              <DetailItem label="更新間隔" value={`${detailStaff.contractRenewalMonths || 3}か月`} />
              <DetailItem label="時給" value={formatYen(detailStaff.hourlyWage)} />
              <DetailItem label="契約h" value={formatContractHoursLabel(detailStaff)} />
              <DetailItem label="ログイン用メール" value={detailStaff.email || "—"} />
              <DetailItem label="Googleアドレス" value={detailStaff.googleEmail || "—"} />
            </div>
            <div className="actions" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn primary btn-action-green"
                onClick={() => {
                  setDetailStaffId(null);
                  setEditingStaffId(detailStaff.id);
                }}
              >
                編集
              </button>
              <button type="button" className="btn" onClick={() => setDetailStaffId(null)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

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
            <div className="actions" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn primary btn-action-green" onClick={handleAddDepartment}>
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
                  <option value="general">一般</option>
                </select>
              </label>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              一般権限の管理者はシフト調整などは利用できますが、マスタ管理は開けません。
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
                  const result = await createStaff({
                    name,
                    firstName: "",
                    displayGivenName: false,
                    iconLabel: "",
                    password,
                    email,
                    team: "本部",
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

      {historyStaff && (
        <div className="modal-backdrop" onClick={() => setHistoryStaffId(null)}>
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
                  </tr>
                </thead>
                <tbody>
                  {sortSalaryHistory(historyStaff.salaryHistory).map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.effectiveDate ? formatSlashDate(entry.effectiveDate) : "—"}</td>
                      <td>{formatYen(entry.hourlyWage)}</td>
                      <td>{entry.note || "—"}</td>
                    </tr>
                  ))}
                  {historyStaff.salaryHistory.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted">
                        履歴はまだありません
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="actions" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn primary btn-action-green"
                onClick={() => openRaiseModal(historyStaff)}
              >
                昇給を記録
              </button>
              <button type="button" className="btn" onClick={() => setHistoryStaffId(null)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="staff-detail-item">
      <div className="staff-detail-label">{label}</div>
      <div className="staff-detail-value">{value}</div>
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
}: {
  title: string;
  form: NewStaffForm;
  setForm: (updater: SetStateAction<NewStaffForm>) => void;
  departments: string[];
  message?: string | null;
  onCancel: () => void;
  onSubmit: () => void | Promise<void>;
  submitLabel: string;
}) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-panel modal-panel-wide" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <div className="form-grid master-form-grid staff-form-grid">
          <label>
            姓
            <input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
          </label>
          <label>
            名
            <input
              value={form.firstName}
              onChange={(e) => setForm((prev) => ({ ...prev, firstName: e.target.value }))}
            />
          </label>
          <label>
            ログイン用メール
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              placeholder="staff@example.com"
            />
          </label>
          <label>
            ログインパスワード
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
            />
          </label>
          <label>
            所属
            <select value={form.team} onChange={(e) => setForm((prev) => ({ ...prev, team: e.target.value }))}>
              {departments
                .filter((department) => department !== "本部")
                .map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              {form.team && !departments.filter((d) => d !== "本部").includes(form.team) ? (
                <option value={form.team}>{form.team}</option>
              ) : null}
            </select>
          </label>
          <label>
            状態
            <select
              value={form.status}
              onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value as "active" | "inactive" }))}
            >
              <option value="active">在籍</option>
              <option value="inactive">退職</option>
            </select>
          </label>
          <label>
            契約時間
            <select
              value={form.socialInsurance ? "insured" : "hours"}
              onChange={(e) => setForm((prev) => ({ ...prev, socialInsurance: e.target.value === "insured" }))}
            >
              <option value="hours">契約hを入力</option>
              <option value="insured">社会保険あり</option>
            </select>
          </label>
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
          ) : null}
          <label>
            Googleアドレス
            <input
              type="email"
              value={form.googleEmail}
              onChange={(e) => setForm((prev) => ({ ...prev, googleEmail: e.target.value }))}
              placeholder="未入力ならログイン用メールを使用"
            />
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
              3か月更新済
            </button>
            <span className="muted" style={{ fontSize: 11 }}>
              終了月の翌月1日〜3か月を自動入力
            </span>
          </div>
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
          <label className="master-checkbox" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={form.displayGivenName}
              onChange={(e) => setForm((prev) => ({ ...prev, displayGivenName: e.target.checked }))}
            />
            <span>名を表示</span>
          </label>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          契約終了日が空の場合、開始日＋更新間隔（既定3か月）から自動計算します。所属候補:{" "}
          {departments.filter((d) => d !== "本部").join(" / ") || "なし"}
        </p>
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

function StaffExtraEdit({
  staff,
  onChange,
}: {
  staff: Staff | undefined;
  onChange: (patch: Partial<Staff>) => void;
}) {
  if (!staff) return null;
  return (
    <div className="staff-extra-edit">
      <div className="muted" style={{ fontSize: 12, fontWeight: 700 }}>
        追加項目（{staff.name}
        {staff.firstName}）
      </div>
      <div className="filters dashboard-filters">
        <label className="filter-field">
          <span>ログイン用メール</span>
          <input
            className="master-input"
            type="email"
            value={staff.email}
            onChange={(e) => onChange({ email: e.target.value })}
            placeholder="login@example.com"
          />
        </label>
        <label className="filter-field">
          <span>パスワード</span>
          <input className="master-input" value={staff.password} onChange={(e) => onChange({ password: e.target.value })} />
        </label>
        <label className="filter-field">
          <span>Googleアドレス</span>
          <input
            className="master-input"
            type="email"
            value={staff.googleEmail}
            onChange={(e) => onChange({ googleEmail: e.target.value })}
            placeholder="name@example.com"
          />
        </label>
        <label className="filter-field">
          <span>更新間隔（か月）</span>
          <input
            className="master-input"
            type="number"
            min="1"
            value={staff.contractRenewalMonths}
            onChange={(e) => onChange({ contractRenewalMonths: Math.max(1, Number(e.target.value) || 3) })}
          />
        </label>
        <label className="filter-field" style={{ alignSelf: "end" }}>
          <span>名表示</span>
          <label className="master-checkbox" style={{ flexDirection: "row", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={staff.displayGivenName}
              onChange={(e) => onChange({ displayGivenName: e.target.checked })}
            />
            <span>名を表示</span>
          </label>
        </label>
      </div>
    </div>
  );
}
