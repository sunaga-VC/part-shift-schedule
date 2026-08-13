"use client";

import { memo, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icons } from "@/components/icons";
import { useShiftAuth } from "@/components/context/ShiftContext";
import { createClient } from "@/lib/supabase/client";
import { getStaffDisplayName } from "@/lib/shift/display";

const workerLinks = [{ href: "/shift", label: "シフト", Icon: Icons.Shift }];

const adminBaseLinks = [
  { href: "/", label: "ホーム", Icon: Icons.Home },
  { href: "/admin/board", label: "シフト調整", Icon: Icons.Shift },
  { href: "/admin/goal", label: "目安設定", Icon: Icons.Goal },
];

const masterLink = { href: "/admin/master", label: "マスタ管理", Icon: Icons.Master };

export const AppShell = memo(function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { ready, currentUser, isAdmin, canManageMaster } = useShiftAuth();
  const links = isAdmin
    ? canManageMaster
      ? [...adminBaseLinks, masterLink]
      : adminBaseLinks
    : workerLinks;
  const [menuOpen, setMenuOpen] = useState(false);

  // クライアント側でも権限外URLを遮断（ブックマーク直打ち対策）
  useEffect(() => {
    if (!ready || !currentUser) return;
    if (!isAdmin && (pathname.startsWith("/admin") || pathname === "/")) {
      window.location.replace("/shift");
      return;
    }
    if (isAdmin && !canManageMaster && pathname.startsWith("/admin/master")) {
      window.location.replace("/admin/board");
    }
  }, [ready, currentUser, isAdmin, canManageMaster, pathname]);

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

  if (!ready) {
    return (
      <div className="app-shell">
        <div className="panel">読み込み中...</div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="app-shell">
        <div className="panel stack">
          <p>プロフィールの読み込みに失敗しました。ページを再読み込みするか、再度ログインしてください。</p>
          <div className="actions">
            <button type="button" className="btn primary" onClick={() => window.location.reload()}>
              再読み込み
            </button>
            <a href="/login" className="btn">
              ログイン画面へ
            </a>
          </div>
        </div>
      </div>
    );
  }

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

        <div className="user-switch sidebar-switch">
          <div className="muted" style={{ fontSize: 12 }}>
            {getStaffDisplayName(currentUser)}
          </div>
        </div>

        <div className="sidebar-menu">
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
        </div>
      </aside>

      <main className="app-main">{children}</main>

      {links.length > 1 ? (
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
      ) : null}
    </div>
  );
});
