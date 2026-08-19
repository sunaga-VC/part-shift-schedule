"use client";

import { useMemo, useState } from "react";
import { Icons } from "@/components/icons";
import { useShift } from "@/components/context/ShiftContext";
import { listOperableDepartmentNames } from "@/lib/shift/adminDepartments";
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
  const { state, canManageMaster, createHomeMessage, deleteHomeMessage } = useShift();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"all" | "team">("all");
  const [team, setTeam] = useState("");
  const [error, setError] = useState<string | null>(null);

  const teams = useMemo(
    () => listOperableDepartmentNames(state.departments),
    [state.departments]
  );
  const staffById = useMemo(
    () => new Map(state.staffList.map((staff) => [staff.id, staff] as const)),
    [state.staffList]
  );

  const messages = state.homeMessages ?? [];

  // マネージャー / アルバイト管理者はメッセージ編集可
  if (!canManageMaster) return null;

  const submit = async () => {
    const result = await createHomeMessage({
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

  const closeEditing = () => {
    setEditing(false);
    setError(null);
    setBody("");
    setAudience("all");
    setTeam("");
  };

  return (
    <section className="panel stack">
      <div className="home-section-head">
        <h2 style={{ margin: 0 }}>アルバイトへのメッセージ</h2>
        {editing ? (
          <button type="button" className="btn" onClick={closeEditing}>
            閉じる
          </button>
        ) : (
          <button
            type="button"
            className="icon-btn"
            aria-label="メッセージを編集"
            title="メッセージを編集"
            onClick={() => setEditing(true)}
          >
            <Icons.Pencil size={16} />
          </button>
        )}
      </div>

      {editing ? (
        <>
          <span className="muted" style={{ fontSize: 12 }}>
            送信するとアルバイトのシフト画面に表示されます
          </span>

          <label className="filter-field home-message-body-field">
            <span>本文</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder="例: 来週の希望登録をお願いします。締め切りは金曜18時です。"
            />
          </label>

          <div className="filters dashboard-filters home-message-compose-row">
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
            <button type="button" className="btn primary" onClick={() => void submit()}>
              送信
            </button>
          </div>
          {error ? (
            <p className="badge warn" style={{ margin: 0 }}>
              {error}
            </p>
          ) : null}

          <div className="home-message-list">
            {messages.length === 0 ? (
              <div className="muted">メッセージがありません</div>
            ) : (
              messages.map((message) => {
                const author = staffById.get(message.createdByStaffId);
                return (
                  <article key={message.id} className="list-item home-message-item">
                    <div className="home-message-item-main">
                      <div className="home-message-meta">
                        <span className="badge">{audienceLabel(message)}</span>
                        <span className="muted">{formatMessageTime(message.createdAt)}</span>
                        <span className="muted">{getStaffDisplayName(author)}</span>
                      </div>
                      <p className="home-message-body">{message.body}</p>
                    </div>
                    <button
                      type="button"
                      className="icon-btn danger"
                      aria-label="削除"
                      onClick={() => void deleteHomeMessage(message.id)}
                    >
                      <Icons.Trash size={14} />
                    </button>
                  </article>
                );
              })
            )}
          </div>
        </>
      ) : (
        <div className="home-message-list">
          {messages.length === 0 ? (
            <div className="muted">メッセージがありません</div>
          ) : (
            messages.map((message) => {
              const author = staffById.get(message.createdByStaffId);
              return (
                <article key={message.id} className="list-item home-message-item">
                  <div className="home-message-item-main">
                    <div className="home-message-meta">
                      <span className="badge">{audienceLabel(message)}</span>
                      <span className="muted">{formatMessageTime(message.createdAt)}</span>
                      <span className="muted">{getStaffDisplayName(author)}</span>
                    </div>
                    <p className="home-message-body">{message.body}</p>
                  </div>
                </article>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}

export function WorkerHomeMessages() {
  const { state, currentUser } = useShift();
  const staffById = useMemo(
    () => new Map(state.staffList.map((staff) => [staff.id, staff] as const)),
    [state.staffList]
  );

  const messages = useMemo(() => {
    if (!currentUser) return [];
    return (state.homeMessages ?? []).filter((message) => isVisibleToWorker(message, currentUser));
  }, [currentUser, state.homeMessages]);

  if (messages.length === 0) return null;

  return (
    <section className="panel stack">
      <div className="home-section-head">
        <h2 style={{ margin: 0 }}>お知らせ</h2>
      </div>
      <div className="home-message-list">
        {messages.map((message) => {
          const author = staffById.get(message.createdByStaffId);
          return (
            <article key={message.id} className="list-item home-message-item">
              <div className="home-message-item-main">
                <div className="home-message-meta">
                  <span className="badge">{audienceLabel(message)}</span>
                  <span className="muted">{formatMessageTime(message.createdAt)}</span>
                  {author ? <span className="muted">{getStaffDisplayName(author)}</span> : null}
                </div>
                <p className="home-message-body">{message.body}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
