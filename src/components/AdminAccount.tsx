"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useShift } from "@/components/context/ShiftContext";
import { createClient } from "@/lib/supabase/client";

export function AdminAccount() {
  const { updateStaff, saveStaffProfile, changeStaffPassword, refreshStaffFromSupabase, currentUser } = useShift();
  const [emailDraft, setEmailDraft] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");

  useEffect(() => {
    if (currentUser?.role === "admin") {
      setEmailDraft(currentUser.email);
    }
  }, [currentUser?.email, currentUser?.role]);

  useEffect(() => {
    void refreshStaffFromSupabase();
  }, [refreshStaffFromSupabase]);

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

  const signOutAndGoToLogin = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // ローカル環境で Supabase が未設定でも続行する
    }
    window.location.assign("/login");
  };

  const handleSaveEmail = async () => {
    const nextEmail = emailDraft.trim();
    if (!nextEmail) {
      window.alert("メールアドレスを入力してください。");
      return;
    }
    if (nextEmail === admin.email.trim()) {
      window.alert("変更後のメールアドレスが同じです。");
      return;
    }
    const result = await saveStaffProfile(admin.id, { email: nextEmail });
    if (!result.ok) {
      window.alert(result.message);
      return;
    }
    window.alert("メールアドレスを更新しました。再ログインしてください。");
    await signOutAndGoToLogin();
  };

  const handleChangePassword = async () => {
    const result = await changeStaffPassword(admin.id, passwordDraft);
    if (!result.ok) {
      window.alert(result.message);
      return;
    }
    setPasswordDraft("");
    window.alert("パスワードを更新しました。再ログインしてください。");
    await signOutAndGoToLogin();
  };

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="actions" style={{ justifyContent: "space-between", marginTop: 0 }}>
          <div className="stack" style={{ gap: 4 }}>
            <h1 style={{ margin: 0 }}>管理アカウント</h1>
            <div className="muted">管理者自身のアカウント設定です。スタッフマスタとは分けています。</div>
          </div>
          <div className="actions" style={{ marginTop: 0 }}>
            <button type="button" className="btn" onClick={() => void refreshStaffFromSupabase()}>
              最新に更新
            </button>
            <Link href="/" className="btn">
              ホームへ
            </Link>
          </div>
        </div>
      </section>

      <section className="panel stack">
        <div className="form-grid master-form-grid">
          <label>
            メール（ログインID）
            <input value={emailDraft} onChange={(e) => setEmailDraft(e.target.value)} />
            <button type="button" className="btn ghost-sm" onClick={() => void handleSaveEmail()}>
              変更
            </button>
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
                onClick={() => void handleChangePassword()}
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
