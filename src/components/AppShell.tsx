"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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

function adminRoleLabel(permission: "manager" | "general" | "part_time_admin"): string {
  if (permission === "manager") return "マネージャー";
  if (permission === "part_time_admin") return "アルバイト管理者";
  return "一般";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { ready, usingSupabaseAuth, state, currentUser, isAdmin, canManageMaster, setCurrentUserId, resetDemoData } =
    useShift();
  const links = isAdmin
    ? canManageMaster
      ? [...adminBaseLinks, masterLink]
      : adminBaseLinks
    : workerLinks;
  const [menuOpen, setMenuOpen] = useState(false);

  // クライアント側でも権限外URLを遮断（ブックマーク直打ち対策）
  useEffect(() => {
    if (!ready || !currentUser || !usingSupabaseAuth) return;
    if (!isAdmin && pathname.startsWith("/admin")) {
      window.location.replace("/");
      return;
    }
    if (isAdmin && !canManageMaster && pathname.startsWith("/admin/master")) {
      window.location.replace("/admin/board");
    }
  }, [ready, currentUser, usingSupabaseAuth, isAdmin, canManageMaster, pathname]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  const handleLogout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // env 未設定時は無視
    }
    // フル遷移で前ユーザーの表示キャッシュを確実に捨てる
    window.location.href = "/login";
  };

  if (!ready || !currentUser) {
    return (
      <div className="app-shell">
        <div className="panel">読み込み中...</div>
      </div>
    );
  }

  const roleText = isAdmin
    ? `管理者・${adminRoleLabel(currentUser.adminPermission)}`
    : "アルバイト";

  return (
    <div className={`app-shell${menuOpen ? " menu-open" : ""}`}>
      <header className="mobile-topbar">
        <div className="mobile-topbar-brand">
          <span className="brand-mark">
            <Icons.Brand size={14} strokeWidth={2.2} />
          </span>
          <span className="mobile-topbar-title">シフト調整</span>
        </div>
        <button
          type="button"
          className="mobile-topbar-btn"
          onClick={() => setMenuOpen(true)}
          aria-label="メニューを開く"
        >
          <Icons.Menu size={20} />
        </button>
      </header>

      {menuOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="メニューを閉じる"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <aside className={`sidebar${menuOpen ? " open" : ""}`}>
        <div className="sidebar-head">
          <div>
            <div className="brand">
              <span className="brand-mark">
                <Icons.Brand size={16} strokeWidth={2.2} />
              </span>
              シフト調整アプリ
            </div>
            <div className="muted sidebar-user" style={{ fontSize: "0.85rem", marginTop: 4 }}>
              {getStaffDisplayName(currentUser)}
              （{roleText}） / {currentUser.team || "未所属"}
            </div>
            {currentUser.email ? (
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                {currentUser.email}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="mobile-drawer-close"
            onClick={() => setMenuOpen(false)}
            aria-label="メニューを閉じる"
          >
            <Icons.Close size={18} />
          </button>
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
                <Link
                  key={link.href}
                  href={link.href}
                  className={active ? "active" : undefined}
                  onClick={() => setMenuOpen(false)}
                >
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

      <nav className="mobile-bottom-nav" aria-label="メインメニュー">
        {links.map((link) => {
          const active =
            link.href === "/"
              ? pathname === "/"
              : pathname === link.href || pathname.startsWith(`${link.href}/`);
          const Icon = link.Icon;
          return (
            <Link key={link.href} href={link.href} className={active ? "active" : undefined}>
              <Icon size={20} className="nav-icon" />
              <span>{link.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
