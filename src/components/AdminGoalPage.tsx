"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icons } from "@/components/icons";
import { useShift } from "@/context/ShiftContext";
import { listOperableDepartmentNames } from "@/lib/shift/adminDepartments";
import { formatDateLong, formatDateShort, toDateKeyJst } from "@/lib/shift/dates";
import {
  GOAL_BLOCK_TIMES,
  getGoalBlocksForDate,
  getGoalDepartmentLabel,
  getGoalDisplayDepartments,
} from "@/lib/shift/goal";
import {
  buildGoalMemoFromDraft,
  formatMemoRepeatLabel,
  getGoalMemosForDate,
  getMemoDisplayDates,
  getMemoRepeatRule,
} from "@/lib/shift/goalMemos";
import {
  WORKDAY_OPTIONS,
  clampMonthDay,
  createDefaultRepeatRule,
  getRepeatTargetDates,
  type GoalRepeatRule,
} from "@/lib/shift/goalRepeat";
import type { GoalMemo } from "@/lib/shift/types";

type GoalPickerTarget = {
  date: string;
  blockIndex: number;
  iconIndex: number;
};

type MemoDraft = {
  id?: string;
  body: string;
  startDate: string;
  rule: GoalRepeatRule;
};

function emptyMemoDraft(todayKey: string): MemoDraft {
  return {
    body: "",
    startDate: todayKey,
    rule: createDefaultRepeatRule(todayKey),
  };
}

export function AdminGoalPage() {
  const {
    state,
    updateGoalBlockCount,
    updateGoalBlockDepartment,
    applyGoalBlocksRepeat,
    upsertGoalMemo,
    deleteGoalMemo,
  } = useShift();
  const [picker, setPicker] = useState<GoalPickerTarget | null>(null);
  const [repeatEditor, setRepeatEditor] = useState<{ sourceDate: string; rule: GoalRepeatRule } | null>(null);
  const [repeatMessage, setRepeatMessage] = useState<string | null>(null);
  const [memoMessage, setMemoMessage] = useState<string | null>(null);
  const [memoDraft, setMemoDraft] = useState<MemoDraft | null>(null);

  const departments = useMemo(
    () => listOperableDepartmentNames(state.departments),
    [state.departments]
  );
  const displayDepartments = useMemo(() => getGoalDisplayDepartments(departments), [departments]);

  const dates = useMemo(() => {
    const result: string[] = [];
    const today = new Date();
    const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const offsetToMonday = (cursor.getDay() + 6) % 7;
    cursor.setDate(cursor.getDate() - offsetToMonday - 28);
    while (result.length < 60) {
      const day = cursor.getDay();
      if (day !== 0 && day !== 6) {
        const y = cursor.getFullYear();
        const m = String(cursor.getMonth() + 1).padStart(2, "0");
        const d = String(cursor.getDate()).padStart(2, "0");
        result.push(`${y}-${m}-${d}`);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return result;
  }, []);

  const weekGroups = useMemo(() => {
    const groups: string[][] = [];
    for (let index = 0; index < dates.length; index += 5) {
      groups.push(dates.slice(index, index + 5));
    }
    return groups;
  }, [dates]);

  const todayKey = useMemo(() => toDateKeyJst(new Date()), []);

  const currentWeekIndex = useMemo(
    () => weekGroups.findIndex((group) => group.includes(todayKey)),
    [todayKey, weekGroups]
  );

  const repeatPreviewCount = useMemo(() => {
    if (!repeatEditor) return 0;
    return getRepeatTargetDates(repeatEditor.sourceDate, repeatEditor.rule).length;
  }, [repeatEditor]);

  const memoPreviewCount = useMemo(() => {
    if (!memoDraft) return 0;
    return getMemoDisplayDates(memoDraft.startDate, memoDraft.rule).length;
  }, [memoDraft]);

  const goalMemos = state.goalMemos ?? [];

  const handleSelectDepartment = (department: string) => {
    if (!picker) return;
    updateGoalBlockDepartment(picker.date, picker.blockIndex, picker.iconIndex, department);
    setPicker(null);
  };

  const openRepeatEditor = (sourceDate: string) => {
    setRepeatMessage(null);
    setRepeatEditor({ sourceDate, rule: createDefaultRepeatRule(sourceDate) });
  };

  const updateRepeatRule = (patch: Partial<GoalRepeatRule>) => {
    setRepeatEditor((prev) => (prev ? { ...prev, rule: { ...prev.rule, ...patch } } : prev));
  };

  const toggleRepeatWeekday = (weekday: number) => {
    setRepeatEditor((prev) => {
      if (!prev) return prev;
      const current = prev.rule.weekdays;
      const next = current.includes(weekday) ? current.filter((day) => day !== weekday) : [...current, weekday].sort();
      return { ...prev, rule: { ...prev.rule, weekdays: next.length > 0 ? next : [weekday] } };
    });
  };

  const handleApplyRepeat = () => {
    if (!repeatEditor) return;
    if (repeatEditor.rule.repeatMonths < 1) {
      setRepeatMessage("期間は1ヶ月以上を指定してください。");
      return;
    }
    if (repeatEditor.rule.frequency === "weekdays" && repeatEditor.rule.weekdays.length === 0) {
      setRepeatMessage("曜日を1つ以上選んでください。");
      return;
    }
    if (repeatEditor.rule.frequency === "monthly") {
      if (repeatEditor.rule.monthlyMode === "range" && repeatEditor.rule.monthDayStart > repeatEditor.rule.monthDayEnd) {
        setRepeatMessage("期間の開始日は終了日以前にしてください。");
        return;
      }
    }
    const count = applyGoalBlocksRepeat(repeatEditor.sourceDate, repeatEditor.rule);
    setRepeatMessage(count > 0 ? `${count}日分に反映しました。` : "反映対象の日付がありません。");
    if (count > 0) {
      setRepeatEditor(null);
    }
  };

  const openMemoCreate = () => {
    setMemoMessage(null);
    setMemoDraft(emptyMemoDraft(todayKey));
  };

  const openMemoEdit = (memo: GoalMemo) => {
    setMemoMessage(null);
    setMemoDraft({
      id: memo.id,
      body: memo.body,
      startDate: memo.startDate,
      rule: getMemoRepeatRule(memo),
    });
  };

  const updateMemoDraft = (patch: Partial<Omit<MemoDraft, "rule">>) => {
    setMemoDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const updateMemoRule = (patch: Partial<GoalRepeatRule>) => {
    setMemoDraft((prev) => (prev ? { ...prev, rule: { ...prev.rule, ...patch } } : prev));
  };

  const toggleMemoWeekday = (weekday: number) => {
    setMemoDraft((prev) => {
      if (!prev) return prev;
      const current = prev.rule.weekdays;
      const next = current.includes(weekday) ? current.filter((day) => day !== weekday) : [...current, weekday].sort();
      return { ...prev, rule: { ...prev.rule, weekdays: next.length > 0 ? next : [weekday] } };
    });
  };

  const handleSaveMemo = () => {
    if (!memoDraft) return;
    if (!memoDraft.body.trim()) {
      setMemoMessage("備考内容を入力してください。");
      return;
    }
    if (!memoDraft.startDate) {
      setMemoMessage("表示開始日を指定してください。");
      return;
    }
    if (memoDraft.rule.repeatMonths < 1) {
      setMemoMessage("期間は1ヶ月以上を指定してください。");
      return;
    }
    if (memoDraft.rule.frequency === "weekdays" && memoDraft.rule.weekdays.length === 0) {
      setMemoMessage("曜日を1つ以上選んでください。");
      return;
    }
    if (
      memoDraft.rule.frequency === "monthly" &&
      memoDraft.rule.monthlyMode === "range" &&
      memoDraft.rule.monthDayStart > memoDraft.rule.monthDayEnd
    ) {
      setMemoMessage("期間の開始日は終了日以前にしてください。");
      return;
    }
    upsertGoalMemo(
      buildGoalMemoFromDraft({
        id: memoDraft.id,
        body: memoDraft.body,
        startDate: memoDraft.startDate,
        rule: memoDraft.rule,
      })
    );
    setMemoDraft(null);
    setMemoMessage(null);
  };

  return (
    <div className="stack">
      <section className="panel">
        <div className="actions" style={{ justifyContent: "space-between", marginTop: 0 }}>
          <div className="stack" style={{ gap: 4 }}>
            <h1 className="page-title-with-icon" style={{ margin: 0 }}>
              <Icons.Goal size={20} className="page-title-icon" />
              目安設定
            </h1>
            <div className="muted">各日付の4ブロックに人アイコンを追加して、時間帯目安を設定します。</div>
          </div>
          <Link href="/admin/board" className="btn">
            シフト調整へ戻る
          </Link>
        </div>
        {repeatMessage ? <p className="muted" style={{ margin: "12px 0 0" }}>{repeatMessage}</p> : null}
      </section>

      <section className="panel stack goal-memo-section">
        <div className="actions" style={{ justifyContent: "space-between", marginTop: 0, alignItems: "center" }}>
          <div className="stack" style={{ gap: 2 }}>
            <h2 style={{ margin: 0 }}>備考</h2>
            <p className="muted" style={{ margin: 0 }}>
              表示開始日と繰り返し条件を決めて、カレンダーの対象日に備考を表示します。
            </p>
          </div>
          <button type="button" className="btn primary btn-action-green" onClick={openMemoCreate}>
            <Icons.Plus size={16} />
            備考を追加
          </button>
        </div>

        {goalMemos.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            まだ備考はありません。
          </p>
        ) : (
          <div className="goal-memo-list">
            {goalMemos.map((memo) => (
              <article key={memo.id} className="goal-memo-item">
                <div className="goal-memo-item-main">
                  <p className="goal-memo-body">{memo.body}</p>
                  <div className="goal-memo-meta muted">
                    <span>
                      {formatDateShort(memo.startDate)} 〜 {formatDateShort(memo.endDate)}
                    </span>
                    <span>{formatMemoRepeatLabel(memo)}</span>
                  </div>
                </div>
                <div className="goal-memo-item-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => openMemoEdit(memo)}
                    aria-label="備考を編集"
                    title="編集"
                  >
                    <Icons.Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    onClick={() => deleteGoalMemo(memo.id)}
                    aria-label="備考を削除"
                    title="削除"
                  >
                    <Icons.Trash size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="calendar-scroll">
          <div className="calendar calendar-weekday-header work-calendar goal-calendar-header">
            {["月", "火", "水", "木", "金"].map((label) => (
              <div key={label} className="calendar-head">
                {label}
              </div>
            ))}
          </div>
          <div className="calendar-stack">
            {weekGroups.map((group, weekIndex) => (
              <div className={`calendar-week-row${weekIndex < currentWeekIndex ? " past-week" : ""}`} key={`week-${weekIndex}`}>
                {group.map((date) => {
                  const blocks = getGoalBlocksForDate(state, date);
                  const dayMemos = getGoalMemosForDate(goalMemos, date);
                  return (
                    <div key={date} className={`day-cell goal-day-cell${weekIndex < currentWeekIndex ? " past" : ""}`}>
                      <div className="goal-day-head">
                        <div className="day-num">{formatDateShort(date)}</div>
                        <button
                          type="button"
                          className="goal-day-settings-btn"
                          onClick={() => openRepeatEditor(date)}
                          aria-label={`${date} の繰り返し設定`}
                          title="繰り返し設定"
                        >
                          <Icons.Settings size={14} />
                        </button>
                      </div>
                      {dayMemos.length > 0 ? (
                        <div className="goal-day-memo-list">
                          {dayMemos.map((memo) => (
                            <p key={memo.id} className="goal-day-note" title={memo.body}>
                              {memo.body}
                            </p>
                          ))}
                        </div>
                      ) : null}
                      <div className="goal-block-list">
                        {GOAL_BLOCK_TIMES.map((block, index) => {
                          const slots = blocks[index];
                          return (
                            <div key={block.label} className="goal-block-row">
                              <div className="goal-block-meta">
                                <span className="goal-block-time">{block.label}</span>
                                <div className="goal-block-icons">
                                  {slots.map((department, iconIndex) => (
                                    <button
                                      key={`${date}-${index}-${iconIndex}`}
                                      type="button"
                                      className="person-icon goal-person-icon goal-person-icon-btn"
                                      onClick={() => setPicker({ date, blockIndex: index, iconIndex })}
                                      title={department}
                                    >
                                      {getGoalDepartmentLabel(department)}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div className="goal-block-actions">
                                <button
                                  type="button"
                                  className="goal-block-btn"
                                  onClick={() => updateGoalBlockCount(date, index, -1)}
                                  disabled={slots.length === 0}
                                  aria-label={`${date} ${block.label} から人アイコンを減らす`}
                                >
                                  <Icons.Minus size={14} />
                                </button>
                                <button
                                  type="button"
                                  className="goal-block-btn"
                                  onClick={() => updateGoalBlockCount(date, index, 1)}
                                  aria-label={`${date} ${block.label} に人アイコンを追加`}
                                >
                                  <Icons.Plus size={14} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>

      {memoDraft ? (
        <div className="modal-backdrop" onClick={() => setMemoDraft(null)}>
          <div className="modal-panel goal-memo-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>{memoDraft.id ? "備考を編集" : "備考を追加"}</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              {formatDateLong(memoDraft.startDate)} からの備考を、指定した条件でカレンダーへ表示します。
            </p>
            <div className="form-grid goal-memo-form">
              <label className="staff-form-span">
                備考
                <textarea
                  value={memoDraft.body}
                  onChange={(e) => updateMemoDraft({ body: e.target.value })}
                  placeholder="連絡事項・注意点など"
                  rows={4}
                  autoFocus
                />
              </label>
              <label>
                表示開始日
                <input
                  type="date"
                  value={memoDraft.startDate}
                  onChange={(e) => {
                    const nextStart = e.target.value;
                    setMemoDraft((prev) => {
                      if (!prev) return prev;
                      if (!nextStart) return { ...prev, startDate: nextStart };
                      const defaults = createDefaultRepeatRule(nextStart);
                      return {
                        ...prev,
                        startDate: nextStart,
                        rule: {
                          ...prev.rule,
                          monthDay: defaults.monthDay,
                          monthDayEnd:
                            prev.rule.monthlyMode === "single" ? defaults.monthDay : prev.rule.monthDayEnd,
                        },
                      };
                    });
                  }}
                />
              </label>

              <fieldset className="goal-repeat-fieldset staff-form-span">
                <legend>繰り返し</legend>
                <label className="goal-repeat-option">
                  <input
                    type="radio"
                    name="goal-memo-frequency"
                    checked={memoDraft.rule.frequency === "daily"}
                    onChange={() => updateMemoRule({ frequency: "daily" })}
                  />
                  <span>毎日（平日）</span>
                </label>
                <label className="goal-repeat-option">
                  <input
                    type="radio"
                    name="goal-memo-frequency"
                    checked={memoDraft.rule.frequency === "weekdays"}
                    onChange={() => updateMemoRule({ frequency: "weekdays" })}
                  />
                  <span>曜日指定</span>
                </label>
                <label className="goal-repeat-option">
                  <input
                    type="radio"
                    name="goal-memo-frequency"
                    checked={memoDraft.rule.frequency === "monthly"}
                    onChange={() => updateMemoRule({ frequency: "monthly" })}
                  />
                  <span>毎月</span>
                </label>
              </fieldset>

              {memoDraft.rule.frequency === "weekdays" ? (
                <div className="goal-repeat-weekdays staff-form-span">
                  <span className="goal-repeat-weekdays-label">曜日</span>
                  <div className="goal-repeat-weekday-row">
                    {WORKDAY_OPTIONS.map(({ value, label }) => (
                      <label key={value} className="goal-repeat-weekday-chip">
                        <input
                          type="checkbox"
                          checked={memoDraft.rule.weekdays.includes(value)}
                          onChange={() => toggleMemoWeekday(value)}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {memoDraft.rule.frequency === "monthly" ? (
                <fieldset className="goal-repeat-fieldset staff-form-span">
                  <legend>毎月の日付</legend>
                  <label className="goal-repeat-option">
                    <input
                      type="radio"
                      name="goal-memo-monthly-mode"
                      checked={memoDraft.rule.monthlyMode === "single"}
                      onChange={() => updateMemoRule({ monthlyMode: "single" })}
                    />
                    <span className="goal-repeat-inline-inputs">
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={memoDraft.rule.monthDay}
                        onChange={(e) =>
                          updateMemoRule({ monthDay: clampMonthDay(Number(e.target.value), memoDraft.rule.monthDay) })
                        }
                      />
                      <span>日</span>
                    </span>
                  </label>
                  <label className="goal-repeat-option">
                    <input
                      type="radio"
                      name="goal-memo-monthly-mode"
                      checked={memoDraft.rule.monthlyMode === "range"}
                      onChange={() => updateMemoRule({ monthlyMode: "range" })}
                    />
                    <span className="goal-repeat-inline-inputs">
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={memoDraft.rule.monthDayStart}
                        onChange={(e) =>
                          updateMemoRule({
                            monthDayStart: clampMonthDay(Number(e.target.value), memoDraft.rule.monthDayStart),
                          })
                        }
                      />
                      <span>日 〜</span>
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={memoDraft.rule.monthDayEnd}
                        onChange={(e) =>
                          updateMemoRule({
                            monthDayEnd: clampMonthDay(Number(e.target.value), memoDraft.rule.monthDayEnd),
                          })
                        }
                      />
                      <span>日</span>
                    </span>
                  </label>
                </fieldset>
              ) : null}

              <label>
                期間（か月）
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={memoDraft.rule.repeatMonths}
                  onChange={(e) => updateMemoRule({ repeatMonths: Math.max(1, Number(e.target.value) || 1) })}
                />
              </label>
              <p className="muted staff-form-span" style={{ margin: 0 }}>
                反映予定: {memoPreviewCount}日
              </p>
            </div>
            {memoMessage ? <p className="badge warn">{memoMessage}</p> : null}
            <div className="actions" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn primary btn-action-green" onClick={handleSaveMemo}>
                保存
              </button>
              <button type="button" className="btn" onClick={() => setMemoDraft(null)}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {repeatEditor ? (
        <div className="modal-backdrop" onClick={() => setRepeatEditor(null)}>
          <div className="modal-panel goal-repeat-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>繰り返し設定</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              {formatDateLong(repeatEditor.sourceDate)} の目安を、指定した条件で他の日付へ反映します。
            </p>
            <div className="form-grid goal-repeat-form">
              <fieldset className="goal-repeat-fieldset">
                <legend>繰り返し</legend>
                <label className="goal-repeat-option">
                  <input
                    type="radio"
                    name="goal-repeat-frequency"
                    checked={repeatEditor.rule.frequency === "daily"}
                    onChange={() => updateRepeatRule({ frequency: "daily" })}
                  />
                  <span>毎日（平日）</span>
                </label>
                <label className="goal-repeat-option">
                  <input
                    type="radio"
                    name="goal-repeat-frequency"
                    checked={repeatEditor.rule.frequency === "weekdays"}
                    onChange={() => updateRepeatRule({ frequency: "weekdays" })}
                  />
                  <span>曜日指定</span>
                </label>
                <label className="goal-repeat-option">
                  <input
                    type="radio"
                    name="goal-repeat-frequency"
                    checked={repeatEditor.rule.frequency === "monthly"}
                    onChange={() => updateRepeatRule({ frequency: "monthly" })}
                  />
                  <span>毎月</span>
                </label>
              </fieldset>

              {repeatEditor.rule.frequency === "weekdays" ? (
                <div className="goal-repeat-weekdays">
                  <span className="goal-repeat-weekdays-label">曜日</span>
                  <div className="goal-repeat-weekday-row">
                    {WORKDAY_OPTIONS.map(({ value, label }) => (
                      <label key={value} className="goal-repeat-weekday-chip">
                        <input
                          type="checkbox"
                          checked={repeatEditor.rule.weekdays.includes(value)}
                          onChange={() => toggleRepeatWeekday(value)}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {repeatEditor.rule.frequency === "monthly" ? (
                <fieldset className="goal-repeat-fieldset">
                  <legend>毎月の日付</legend>
                  <label className="goal-repeat-option">
                    <input
                      type="radio"
                      name="goal-repeat-monthly-mode"
                      checked={repeatEditor.rule.monthlyMode === "single"}
                      onChange={() => updateRepeatRule({ monthlyMode: "single" })}
                    />
                    <span className="goal-repeat-inline-inputs">
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={repeatEditor.rule.monthDay}
                        onChange={(e) =>
                          updateRepeatRule({ monthDay: clampMonthDay(Number(e.target.value), repeatEditor.rule.monthDay) })
                        }
                      />
                      <span>日</span>
                    </span>
                  </label>
                  <label className="goal-repeat-option">
                    <input
                      type="radio"
                      name="goal-repeat-monthly-mode"
                      checked={repeatEditor.rule.monthlyMode === "range"}
                      onChange={() => updateRepeatRule({ monthlyMode: "range" })}
                    />
                    <span className="goal-repeat-inline-inputs">
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={repeatEditor.rule.monthDayStart}
                        onChange={(e) =>
                          updateRepeatRule({
                            monthDayStart: clampMonthDay(Number(e.target.value), repeatEditor.rule.monthDayStart),
                          })
                        }
                      />
                      <span>日 〜</span>
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={repeatEditor.rule.monthDayEnd}
                        onChange={(e) =>
                          updateRepeatRule({
                            monthDayEnd: clampMonthDay(Number(e.target.value), repeatEditor.rule.monthDayEnd),
                          })
                        }
                      />
                      <span>日</span>
                    </span>
                  </label>
                </fieldset>
              ) : null}

              <label>
                期間（か月）
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={repeatEditor.rule.repeatMonths}
                  onChange={(e) => updateRepeatRule({ repeatMonths: Math.max(1, Number(e.target.value) || 1) })}
                />
              </label>
              <p className="muted" style={{ margin: 0 }}>
                反映予定: {repeatPreviewCount}日
              </p>
            </div>
            {repeatMessage ? <p className="badge warn">{repeatMessage}</p> : null}
            <div className="actions" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn primary" onClick={handleApplyRepeat}>
                反映する
              </button>
              <button type="button" className="btn" onClick={() => setRepeatEditor(null)}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {picker ? (
        <div className="modal-backdrop" onClick={() => setPicker(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>所属を選択</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              マスタ管理の所属管理で登録されている所属から選びます。
            </p>
            {displayDepartments.length === 0 ? (
              <p className="muted">所属が登録されていません。マスタ管理で所属を追加してください。</p>
            ) : (
              <div className="goal-department-list">
                {displayDepartments.map((department) => (
                  <button
                    key={department}
                    type="button"
                    className="goal-department-item"
                    onClick={() => handleSelectDepartment(department)}
                  >
                    <span className="person-icon goal-person-icon">{getGoalDepartmentLabel(department)}</span>
                    <span>{department}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="actions" style={{ marginTop: 12 }}>
              <button type="button" className="btn" onClick={() => setPicker(null)}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
