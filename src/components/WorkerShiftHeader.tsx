"use client";

import { useMemo } from "react";
import { WorkerHomeMessages } from "@/components/HomeMessages";
import { useShift } from "@/components/context/ShiftContext";
import { toDateKeyJst } from "@/lib/shift/dates";
import { getStaffDisplayName } from "@/lib/shift/display";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

function formatTodayHeading(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00+09:00`);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
}

export function WorkerShiftHeader() {
  const { currentUser } = useShift();
  const todayKey = useMemo(() => toDateKeyJst(new Date()), []);

  if (!currentUser) return null;

  const displayName = getStaffDisplayName(currentUser);

  return (
    <>
      <section className="home-hero panel">
        <div className="home-hero-copy">
          <p className="home-hero-kicker">{formatTodayHeading(todayKey)}</p>
          <h1 className="home-hero-title">
            <span className="home-hero-greeting">こんにちは、</span>
            <span className="home-hero-name">{displayName}</span>
            <span className="home-hero-greeting">さん</span>
          </h1>
        </div>
      </section>
      <WorkerHomeMessages />
    </>
  );
}
