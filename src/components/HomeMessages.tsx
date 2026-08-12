"use client";

import { useMemo, useState } from "react";
import { Icons } from "@/components/icons";
import { useShift } from "@/context/ShiftContext";
import { getStaffDisplayName } from "@/lib/shift/display";
import type { HomeMessage, Staff } from "@/lib/shift/types";

function formatMessageTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function audienceLabel(message: HomeMessage): string {
  return message.audience === "team" && message.team ? message.team : "全員";
}

function isVisibleToWorker(message: HomeMessage, worker: Staff): boolean {
  if (message.audience === "all") return true;
  return message.team === worker.team;
}

export function AdminHomeMessages() {
  const { state, createHomeMessage, deleteHomeMessage } = useShift();
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"all" | "team">("all");
  const [team, setTeam] = useState("");
  const [error, setError] = useState<string | null>(null);

  const teams = useMemo(
    () =>
      (state.departments.length > 0
        ? state.departments
        : Array.from(new Set(state.staffList.filter((s) => s.role === "worker").map((s) => s.team)))
      ).filter((d) => d !== "本部"),
    [state.departments, state.staffList]
  );

  const messages = state.homeMessages ?? [];

  const submit = () => {
    const result = createHomeMessage({
      body,
      audience,
      team: audience === "team" ? team || teams[0] : undefined,
    });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setBody("");
    setError(null);
  };

  return (
    <section className="panel stack home-message-panel">
      <div className="home-message-head">
        <h2 className="page-title-with-icon" style={{ margin: 0 }}>
          <Icons.Message size={18} className="page-title-icon" />
          アルバイトへのメッセージ
        </h2>
        <span className="muted" style={{ fontSize: 12 }}>
          送信するとアルバイトのホームに表示されます
        </span>
      </div>

      <label className="home-message-compose">
        <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>
          本文
        </span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="例: 来週の希望登録をお願いします。締め切りは金曜18時です。"
        />
      </label>

      <div className="home-message-compose-row">
        <label className="filter-field">
          <span>宛先</span>
          <select
            value={audience === "all" ? "all" : team || teams[0] || ""}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "all") {
                setAudience("all");
                setTeam("");
              } else {
                setAudience("team");
                setTeam(value);
              }
            }}
          >
            <option value="all">全員</option>
            {teams.map((department) => (
              <option key={department} value={department}>
                {department}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn primary btn-action-green" onClick={submit}>
          送信
        </button>
      </div>
      {error ? <p className="badge warn" style={{ margin: 0 }}>{error}</p> : null}

      <div className="home-message-list">
        {messages.length === 0 ? (
          <div className="muted home-message-empty">まだメッセージはありません</div>
        ) : (
          messages.map((message) => {
            const author = state.staffList.find((s) => s.id === message.createdByStaffId);
            return (
              <article key={message.id} className="home-message-card admin">
                <div className="home-message-card-top">
                  <div className="home-message-meta">
                    <span className="home-chip">{audienceLabel(message)}</span>
                    <span className="muted">{formatMessageTime(message.createdAt)}</span>
                    <span className="muted">{getStaffDisplayName(author)}</span>
                  </div>
                  <button
                    type="button"
                    className="icon-btn danger"
                    aria-label="削除"
                    onClick={() => deleteHomeMessage(message.id)}
                  >
                    <Icons.Trash size={14} />
                  </button>
                </div>
                <p className="home-message-body">{message.body}</p>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

export function WorkerHomeMessages() {
  const { state, currentUser } = useShift();

  const messages = useMemo(
    () => (state.homeMessages ?? []).filter((message) => isVisibleToWorker(message, currentUser)),
    [currentUser, state.homeMessages]
  );

  if (messages.length === 0) return null;

  return (
    <section className="panel stack home-message-panel worker">
      <div className="home-message-head">
        <h2 className="page-title-with-icon" style={{ margin: 0 }}>
          <Icons.Message size={18} className="page-title-icon" />
          お知らせ
        </h2>
      </div>
      <div className="home-message-list">
        {messages.map((message) => {
          const author = state.staffList.find((s) => s.id === message.createdByStaffId);
          return (
            <article key={message.id} className="home-message-card">
              <div className="home-message-meta">
                <span className="home-chip ok">{audienceLabel(message)}</span>
                <span className="muted">{formatMessageTime(message.createdAt)}</span>
                {author ? <span className="muted">{getStaffDisplayName(author)}</span> : null}
              </div>
              <p className="home-message-body">{message.body}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
