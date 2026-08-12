"use client";

import Link from "next/link";
import { useShift } from "@/context/ShiftContext";

export function AdminAccount() {
  const { state, updateStaff } = useShift();
  const admin = state.staffList.find((staff) => staff.role === "admin");

  if (!admin) {
    return (
      <div className="panel">
        <p>管理者アカウントが見つかりません。</p>
        <Link href="/" className="btn">
          ホームへ
        </Link>
      </div>
    );
  }

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
            名前
            <input value={admin.name} onChange={(e) => updateStaff(admin.id, { name: e.target.value })} />
          </label>
          <label>
            ログインパスワード
            <input value={admin.password} onChange={(e) => updateStaff(admin.id, { password: e.target.value })} />
          </label>
        </div>
      </section>
    </div>
  );
}
