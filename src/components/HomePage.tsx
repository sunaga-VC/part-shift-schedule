"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AdminDashboard } from "@/components/AdminDashboard";
import { AdminHomeMessages, WorkerHomeMessages } from "@/components/HomeMessages";
import { Icons } from "@/components/icons";
import { useShift } from "@/components/context/ShiftContext";
import {
  addDays,
  formatDateRangeShort,
  formatDateShort,
  getMondayOfWeek,
  getWorkWeekDates,
  toDateKeyJst,
} from "@/lib/shift/dates";
import { getStaffDisplayName } from "@/lib/shift/display";
import { formatTimeRange } from "@/lib/shift/time";
import type { ConfirmedShift, DesiredShift } from "@/lib/shift/types";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

function formatDayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00+09:00`);
  return `${formatDateShort(date)}（${WEEKDAYS[d.getDay()]}）`;
}

function formatTodayHeading(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00+09:00`);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
}

export function HomePage() {
  const { state, isAdmin, canManageMaster, currentUser } = useShift();
  const todayKey = useMemo(() => toDateKeyJst(new Date()), []);

  const workerWeeks = useMemo(() => {
    const emptyWeek = {
      dates: [] as string[],
      wishes: [] as DesiredShift[],
      confirmed: [] as ConfirmedShift[],
    };
    if (!currentUser) {
      return {
        thisWeek: { label: "今週", range: "", ...emptyWeek },
        nextWeek: { label: "来週", range: "", ...emptyWeek },
      };
    }
    const userId = currentUser.id;
    const thisWeekMonday = getMondayOfWeek(todayKey);
    const nextWeekMonday = addDays(thisWeekMonday, 7);
    const thisWeekDates = getWorkWeekDates(todayKey);
    const nextWeekDates = getWorkWeekDates(nextWeekMonday);

    const collectWeek = (dates: string[]) => {
      const dateSet = new Set(dates);
      const wishes = state.desiredShifts
        .filter((shift) => shift.staffId === userId && dateSet.has(shift.date))
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
      const confirmed = state.confirmedShifts
        .filter(
          (shift) =>
            shift.staffId === userId &&
            dateSet.has(shift.date) &&
            Boolean(shift.publishedAt)
        )
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
      return { dates, wishes, confirmed };
    };

    return {
      thisWeek: { label: "今週", range: formatDateRangeShort(thisWeekDates), ...collectWeek(thisWeekDates) },
      nextWeek: { label: "来週", range: formatDateRangeShort(nextWeekDates), ...collectWeek(nextWeekDates) },
    };
  }, [currentUser, state.confirmedShifts, state.desiredShifts, todayKey]);

  const workerSummary = useMemo(() => {
    const wishDays = new Set([
      ...workerWeeks.thisWeek.wishes.map((s) => s.date),
      ...workerWeeks.nextWeek.wishes.map((s) => s.date),
    ]).size;
    const confirmedDays = new Set([
      ...workerWeeks.thisWeek.confirmed.map((s) => s.date),
      ...workerWeeks.nextWeek.confirmed.map((s) => s.date),
    ]).size;
    const todayConfirmed = workerWeeks.thisWeek.confirmed.filter((s) => s.date === todayKey);
    return { wishDays, confirmedDays, todayConfirmed };
  }, [todayKey, workerWeeks]);

  if (!currentUser) {
    return (
      <div className="stack home-page">
        <section className="panel">
          <p style={{ margin: 0 }}>ログイン情報を確認しています…</p>
        </section>
      </div>
    );
  }

  const displayName = getStaffDisplayName(currentUser);

  return (
    <div className="stack home-page">
      <section className="home-hero panel">
        <div className="home-hero-copy">
          <p className="home-hero-kicker">{formatTodayHeading(todayKey)}</p>
          <h1 className="home-hero-title">
            <span className="home-hero-greeting">こんにちは、</span>
            <span className="home-hero-name">{displayName}</span>
            <span className="home-hero-greeting">さん</span>
          </h1>
          <p className="home-hero-lead">
            {isAdmin
              ? "希望の集計とシフト調整の状況を確認できます。足りない日や未調整の日を優先して進めましょう。"
              : "今週・来週の希望と確定シフトを確認できます。変更はシフト画面から登録してください。"}
          </p>
          <div className="home-hero-actions">
            {isAdmin ? (
              <>
                <Link className="btn primary btn-action-green" href="/admin/board">
                  <Icons.Shift size={16} />
                  シフト調整へ
                </Link>
                <Link className="btn" href="/admin/goal">
                  <Icons.Goal size={16} />
                  目安設定
                </Link>
                {canManageMaster ? (
                  <Link className="btn" href="/admin/master">
                    <Icons.Master size={16} />
                    スタッフ管理
                  </Link>
                ) : null}
              </>
            ) : (
              <Link className="btn primary btn-action-green" href="/shift">
                <Icons.Shift size={16} />
                シフトを登録・確認
              </Link>
            )}
          </div>
        </div>

        {!isAdmin ? (
          <div className="home-hero-aside">
            <article className="home-mini-stat">
              <div className="home-mini-stat-label">今日の確定</div>
              <div className="home-mini-stat-value">
                {workerSummary.todayConfirmed.length > 0
                  ? workerSummary.todayConfirmed
                      .map((s) => formatTimeRange(s.startTime, s.endTime))
                      .join(" / ")
                  : "なし"}
              </div>
            </article>
            <article className="home-mini-stat">
              <div className="home-mini-stat-label">希望（今週〜来週）</div>
              <div className="home-mini-stat-value">{workerSummary.wishDays}日</div>
            </article>
            <article className="home-mini-stat accent">
              <div className="home-mini-stat-label">確定（今週〜来週）</div>
              <div className="home-mini-stat-value">{workerSummary.confirmedDays}日</div>
            </article>
          </div>
        ) : null}
      </section>

      {isAdmin ? (
        <>
          {canManageMaster ? <AdminHomeMessages /> : null}
          <AdminDashboard />
        </>
      ) : (
        <>
          <WorkerHomeMessages />
          <div className="worker-home-weeks">
            <WorkerWeekPanel week={workerWeeks.thisWeek} todayKey={todayKey} />
            <WorkerWeekPanel week={workerWeeks.nextWeek} todayKey={todayKey} />
          </div>
        </>
      )}
    </div>
  );
}

type WorkerWeekData = {
  label: string;
  range: string;
  dates: string[];
  wishes: DesiredShift[];
  confirmed: ConfirmedShift[];
};

function WorkerWeekPanel({ week, todayKey }: { week: WorkerWeekData; todayKey: string }) {
  const wishDays = new Set(week.wishes.map((s) => s.date)).size;
  const confirmedDays = new Set(week.confirmed.map((s) => s.date)).size;

  return (
    <section className="panel stack worker-home-week">
      <div className="worker-home-week-header">
        <div>
          <h2 className="worker-home-week-title">{week.label}</h2>
          <span className="muted">{week.range}</span>
        </div>
        <div className="worker-home-week-chips">
          <span className="home-chip">希望 {wishDays}日</span>
          <span className="home-chip ok">確定 {confirmedDays}日</span>
        </div>
      </div>

      <div className="worker-day-grid">
        {week.dates.map((date) => {
          const dayWishes = week.wishes.filter((s) => s.date === date);
          const dayConfirmed = week.confirmed.filter((s) => s.date === date);
          const isToday = date === todayKey;
          return (
            <div key={date} className={`worker-day-card ${isToday ? "is-today" : ""}`}>
              <div className="worker-day-card-head">
                <span className="worker-day-date">{formatDayLabel(date)}</span>
                {isToday ? <span className="home-chip today">今日</span> : null}
              </div>
              <div className="worker-day-rows">
                <div className="worker-day-row">
                  <span className="worker-day-kind">希望</span>
                  <span className={dayWishes.length ? "worker-day-times" : "muted"}>
                    {dayWishes.length
                      ? dayWishes.map((s) => formatTimeRange(s.startTime, s.endTime)).join(" / ")
                      : "未登録"}
                  </span>
                </div>
                <div className="worker-day-row">
                  <span className="worker-day-kind confirmed">確定</span>
                  <span className={dayConfirmed.length ? "worker-day-times confirmed" : "muted"}>
                    {dayConfirmed.length
                      ? dayConfirmed
                          .map((s) => (s.status === "unconfirmed" ? "休み" : formatTimeRange(s.startTime, s.endTime)))
                          .join(" / ")
                      : "なし"}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
