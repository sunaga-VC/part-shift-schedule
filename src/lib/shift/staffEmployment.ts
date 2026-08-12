import { addMonthsToDateKey, toDateKeyJst } from "./dates";
import type { SalaryRaise, Staff } from "./types";

export const DEFAULT_CONTRACT_RENEWAL_MONTHS = 3;
export const CONTRACT_RENEWAL_WARN_DAYS = 30;

export type ContractRenewalAlert =
  | { level: "none" }
  | { level: "soon"; endDate: string; daysLeft: number }
  | { level: "overdue"; endDate: string; daysOver: number };

export function getCurrentHourlyWage(staff: Staff): number {
  if (Number.isFinite(staff.hourlyWage) && staff.hourlyWage > 0) return staff.hourlyWage;
  const latest = [...(staff.salaryHistory ?? [])].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
  return latest?.hourlyWage ?? 0;
}

export function sortSalaryHistory(history: SalaryRaise[]): SalaryRaise[] {
  return [...history].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.id.localeCompare(a.id));
}

export function formatYen(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  return `¥${Math.round(amount).toLocaleString("ja-JP")}`;
}

function diffDays(fromDate: string, toDate: string): number {
  const from = new Date(`${fromDate}T00:00:00+09:00`).getTime();
  const to = new Date(`${toDate}T00:00:00+09:00`).getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

/** 契約終了日までの更新アラート（終了日未設定はなし） */
export function getContractRenewalAlert(
  staff: Pick<Staff, "status" | "contractEndDate">,
  todayKey = toDateKeyJst(new Date()),
  warnDays = CONTRACT_RENEWAL_WARN_DAYS
): ContractRenewalAlert {
  if (staff.status !== "active") return { level: "none" };
  const endDate = staff.contractEndDate?.trim();
  if (!endDate) return { level: "none" };

  const days = diffDays(todayKey, endDate);
  if (days < 0) {
    return { level: "overdue", endDate, daysOver: Math.abs(days) };
  }
  if (days <= warnDays) {
    return { level: "soon", endDate, daysLeft: days };
  }
  return { level: "none" };
}

export function describeRenewalAlert(alert: ContractRenewalAlert): string {
  if (alert.level === "overdue") return `更新期限超過（${alert.daysOver}日経過）`;
  if (alert.level === "soon") {
    return alert.daysLeft === 0 ? "本日期限" : `残り${alert.daysLeft}日`;
  }
  return "";
}

/** 契約開始日と更新月数から終了日を算出 */
export function calcContractEndDate(startDate: string, renewalMonths = DEFAULT_CONTRACT_RENEWAL_MONTHS): string {
  if (!startDate) return "";
  const months = Math.max(1, renewalMonths || DEFAULT_CONTRACT_RENEWAL_MONTHS);
  // 開始日の N か月後の前日を終了日にする
  const nextStart = addMonthsToDateKey(startDate, months);
  const end = new Date(`${nextStart}T00:00:00+09:00`);
  end.setDate(end.getDate() - 1);
  return toDateKeyJst(end);
}

/**
 * 3か月更新用。現行契約終了月の翌月1日から、指定月数分の契約期間を返す。
 * 終了日が無い場合は開始日、それも無ければ今日を基準にする。
 */
export function calcRenewedContractPeriod(
  currentEndDate: string,
  currentStartDate = "",
  renewalMonths = DEFAULT_CONTRACT_RENEWAL_MONTHS,
  todayKey = toDateKeyJst(new Date())
): { contractStartDate: string; contractEndDate: string; contractRenewalMonths: number } {
  const months = Math.max(1, renewalMonths || DEFAULT_CONTRACT_RENEWAL_MONTHS);
  const base = currentEndDate?.trim() || currentStartDate?.trim() || todayKey;
  const d = new Date(`${base}T00:00:00+09:00`);
  const contractStartDate = toDateKeyJst(new Date(d.getFullYear(), d.getMonth() + 1, 1));
  return {
    contractStartDate,
    contractEndDate: calcContractEndDate(contractStartDate, months),
    contractRenewalMonths: months,
  };
}

/** 契約h列の表示。社保加入ありの場合は「社会保険あり」 */
export function formatContractHoursLabel(staff: Pick<Staff, "weeklyContractHours" | "socialInsurance">): string {
  if (staff.socialInsurance) return "社会保険あり";
  return String(staff.weeklyContractHours);
}
