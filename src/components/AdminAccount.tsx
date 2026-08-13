"use client";

import { useState } from "react";
import Link from "next/link";
import { useShift } from "@/components/context/ShiftContext";

export function AdminAccount() {
  const { updateStaff, changeStaffPassword, currentUser } = useShift();
  const [passwordDraft, setPasswordDraft] = useState("");

  if (!currentUser || currentUser.role !== "admin") {
    return (
      <div className="panel">
        <p>管理者アカウントが見つかりません。</p>
        <Link href="/" className="btn">
          ホームへ
        </Link>
      </div>
    );
  }

  const admin = currentUser;

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="actions" style={{ justifyContent: "space-between", marginTop: 0 }}>
          <div className="stack" style={{ gap: 4 }}>
            <h1 style={{ margin: 0 }}>管理アカウント</h1>
            <div className="muted">管理者自身のアカウント設定です。スタッフマスタとは分けています。</div>
          </div>
          <Link href="/" className="btn">
            ホームへ
          </Link>
        </div>
      </section>

      <section className="panel stack">
        <div className="form-grid master-form-grid">
          <label>
            メール（ログインID）
            <input value={admin.email} readOnly />
          </label>
          <label>
            名前
            <input value={admin.name} onChange={(e) => updateStaff(admin.id, { name: e.target.value })} />
          </label>
          <label>
            パスワード変更
            <div className="password-change-row">
              <input
                type="password"
                value={passwordDraft}
                onChange={(e) => setPasswordDraft(e.target.value)}
                placeholder="新しいパスワード（6文字以上）"
                autoComplete="new-password"
              />
              <button
                type="button"
                className="btn ghost-sm"
                onClick={() => {
                  void (async () => {
                    const result = await changeStaffPassword(admin.id, passwordDraft);
                    if (!result.ok) {
                      window.alert(result.message);
                      return;
                    }
                    setPasswordDraft("");
                    window.alert("パスワードを更新しました。");
                  })();
                }}
              >
                変更
              </button>
            </div>
          </label>
        </div>
      </section>
    </div>
  );
}
