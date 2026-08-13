"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AdminDashboard } from "@/components/AdminDashboard";
import { AdminHomeMessages } from "@/components/HomeMessages";
import { Icons } from "@/components/icons";
import { useShift } from "@/components/context/ShiftContext";
import { toDateKeyJst } from "@/lib/shift/dates";
import { getStaffDisplayName } from "@/lib/shift/display";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

function formatTodayHeading(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00+09:00`);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
}

export function HomePage() {
  const { canManageMaster, currentUser } = useShift();
  const todayKey = useMemo(() => toDateKeyJst(new Date()), []);

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
            希望の集計とシフト調整の状況を確認できます。足りない日や未調整の日を優先して進めましょう。
          </p>
          <div className="home-hero-actions">
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
          </div>
        </div>
      </section>

      {canManageMaster ? <AdminHomeMessages /> : null}
      <AdminDashboard />
    </div>
  );
}
