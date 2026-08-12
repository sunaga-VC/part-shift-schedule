"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icons } from "@/components/icons";
import { useShift } from "@/context/ShiftContext";
import { createClient } from "@/lib/supabase/client";
import { getStaffDisplayName } from "@/lib/shift/display";

const workerLinks = [
  { href: "/", label: "ホーム", Icon: Icons.Home },
  { href: "/shift", label: "シフト", Icon: Icons.Shift },
];

const adminBaseLinks = [
  { href: "/", label: "ホーム", Icon: Icons.Home },
  { href: "/admin/board", label: "シフト調整", Icon: Icons.Shift },
  { href: "/admin/goal", label: "目安設定", Icon: Icons.Goal },
];

const masterLink = { href: "/admin/master", label: "マスタ管理", Icon: Icons.Master };

function adminRoleLabel(permission: "manager" | "general"): string {
  return permission === "manager" ? "マネージャー" : "一般";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { ready, usingSupabaseAuth, state, currentUser, isAdmin, canManageMaster, setCurrentUserId, resetDemoData } =
    useShift();
  const links = isAdmin
    ? canManageMaster
      ? [...adminBaseLinks, masterLink]
      : adminBaseLinks
    : workerLinks;

  const handleLogout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // env 未設定時は無視
    }
    router.replace("/login");
    router.refresh();
  };

  if (!ready || !currentUser) {
    return (
      <div className="app-shell">
        <div className="panel">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="brand">
            <span className="brand-mark">
              <Icons.Brand size={16} strokeWidth={2.2} />
            </span>
            シフト調整アプリ
          </div>
          <div className="muted sidebar-user" style={{ fontSize: "0.85rem", marginTop: 4 }}>
            {getStaffDisplayName(currentUser)}
            {isAdmin
              ? `（管理者・${adminRoleLabel(currentUser.adminPermission)}）`
              : "（アルバイト）"}{" "}
            / {currentUser.team}
          </div>
        </div>

        {!usingSupabaseAuth ? (
          <div className="user-switch sidebar-switch">
            <span className="muted">ログインユーザー</span>
            <div className="sidebar-select-wrap">
              <select value={state.currentUserId} onChange={(e) => setCurrentUserId(e.target.value)}>
                {state.staffList
                  .filter((s) => s.status === "active")
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {getStaffDisplayName(s)}（
                      {s.role === "admin" ? `管理者・${adminRoleLabel(s.adminPermission)}` : "アルバイト"}）
                    </option>
                  ))}
              </select>
              <Icons.ChevronDown size={14} className="sidebar-select-chevron" />
            </div>
            <button type="button" className="btn" onClick={resetDemoData}>
              デモ初期化
            </button>
          </div>
        ) : (
          <div className="user-switch sidebar-switch">
            <span className="muted">Supabase ログイン中</span>
            <div className="muted" style={{ fontSize: 12 }}>
              {getStaffDisplayName(currentUser)}
            </div>
          </div>
        )}

        <div className="sidebar-menu">
          <div className="sidebar-menu-title">メニュー</div>
          <nav className="nav sidebar-nav">
            {links.map((link) => {
              const active =
                link.href === "/"
                  ? pathname === "/"
                  : pathname === link.href || pathname.startsWith(`${link.href}/`);
              const Icon = link.Icon;
              return (
                <Link key={link.href} href={link.href} className={active ? "active" : undefined}>
                  <Icon size={18} className="nav-icon" />
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="sidebar-footer">
          <button type="button" className="btn" onClick={handleLogout} style={{ width: "100%" }}>
            ログアウト
          </button>
          <span className="sidebar-support">
            <Icons.Support size={16} />
            サポート
          </span>
        </div>
      </aside>

      <main className="app-main">{children}</main>
    </div>
  );
}
