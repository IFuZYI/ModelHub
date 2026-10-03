"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import SiteHeader from "./SiteHeader";
import { fetchAuthStatus, logout as apiLogout, type SessionUser } from "../lib/api";

export interface ConsoleNavItem {
  href: string;
  label: string;
  icon: string;
  /** Only shown to admins. */
  adminOnly?: boolean;
}

/** Menu definition — one place for every console entry. */
const NAV: ConsoleNavItem[] = [
  { href: "/console", label: "概览", icon: "◈" },
  { href: "/console/providers", label: "我的站点", icon: "▤" },
  { href: "/console/profile", label: "个人资料", icon: "◐" },
  { href: "/console/account", label: "账号安全", icon: "⚿" },
  { href: "/console/users", label: "用户管理", icon: "☰", adminOnly: true },
  { href: "/console/stats", label: "全服统计", icon: "◭", adminOnly: true },
  { href: "/console/settings", label: "系统设置", icon: "⚙", adminOnly: true },
];

interface Props {
  /** Page title shown in the content header. */
  title: string;
  subtitle?: string;
  /** Optional right-aligned action (e.g. a "new" button). */
  action?: React.ReactNode;
  /** Extra guard: render children only when this is true. */
  requireAdmin?: boolean;
  children: (ctx: { user: SessionUser | null }) => React.ReactNode;
}

/**
 * Shared console frame: a blog-admin-style sidebar (identity card + menu) plus
 * a content column. Every /console/* page renders through this so navigation
 * lives in ONE place instead of a row of scattered buttons per page.
 *
 * Serves the session lookup + auth guard; callers receive `user` in children.
 */
export default function ConsoleShell({
  title,
  subtitle,
  action,
  requireAdmin,
  children,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [denied, setDenied] = useState(false);
  const [role, setRole] = useState<"admin" | "user" | "guest">("guest");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [open, setOpen] = useState(false); // mobile drawer

  const load = useCallback(async () => {
    const status = await fetchAuthStatus();
    setRole(status.role);
    setUser(status.user);
    setAuthed(status.authenticated);
    if (!status.authenticated) {
      setReady(true);
      return;
    }
    if (requireAdmin && status.role !== "admin") {
      setDenied(true);
      setReady(true);
      return;
    }
    const profile = await fetch("/api/me/profile", {
      credentials: "same-origin",
    })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    setDisplayName(profile?.display_name ?? null);
    setAvatar(profile?.avatar ?? null);
    setReady(true);
  }, [requireAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  // Close the mobile drawer on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  async function doLogout() {
    await apiLogout();
    router.replace("/login");
  }

  if (!ready)
    return (
      <>
        <SiteHeader authenticated={false} />
        <main className="shell">
          <div className="spin">加载中…</div>
        </main>
      </>
    );

  if (!authed)
    return (
      <>
        <SiteHeader authenticated={false} />
        <main className="shell">
          <div className="empty">
            请先登录。
            <div style={{ marginTop: 16 }}>
              <Link href="/login" className="btn secondary">
                去登录
              </Link>
            </div>
          </div>
        </main>
      </>
    );

  if (denied)
    return (
      <>
        <SiteHeader authenticated onLogout={doLogout} />
        <main className="shell">
          <div className="empty">
            需要管理员权限。
            <div style={{ marginTop: 16 }}>
              <Link href="/console" className="btn secondary">
                返回控制台
              </Link>
            </div>
          </div>
        </main>
      </>
    );

  const name = displayName || user?.username || "";
  const visibleNav = NAV.filter((n) => !n.adminOnly || role === "admin");

  return (
    <>
      <SiteHeader authenticated onLogout={doLogout} />
      <div className="console-shell">
        <button
          className="console-drawer-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="切换菜单"
        >
          ☰ 菜单
        </button>

        <aside className={`console-side${open ? " open" : ""}`}>
          <div className="console-id">
            <div className="console-id-avatar">
              {avatar ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={avatar} alt="" referrerPolicy="no-referrer" />
              ) : (
                (name.slice(0, 1) || "?").toUpperCase()
              )}
            </div>
            <div className="console-id-body">
              <p className="console-id-name">{name}</p>
              <p className="console-id-meta">
                @{user?.username}
                {role === "admin" && <span className="console-role">管理员</span>}
              </p>
            </div>
          </div>

          <nav className="console-menu">
            {visibleNav.map((n) => {
              const active =
                n.href === "/console"
                  ? pathname === "/console"
                  : pathname.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`console-menu-item${active ? " active" : ""}`}
                >
                  <span className="console-menu-icon">{n.icon}</span>
                  {n.label}
                </Link>
              );
            })}
          </nav>

          <Link href="/" className="console-menu-back">
            ← 返回站点首页
          </Link>
        </aside>

        <main className="console-main">
          <div className="console-head">
            <div>
              <h1 className="detail-title">{title}</h1>
              {subtitle && (
                <p className="card-domain" style={{ marginTop: 8 }}>
                  {subtitle}
                </p>
              )}
            </div>
            {action}
          </div>
          {children({ user })}
        </main>
      </div>
    </>
  );
}
