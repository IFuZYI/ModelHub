"use client";

import Link from "next/link";
import { useTheme, toggleTheme } from "../theme";

interface Props {
  authenticated: boolean;
  onLogout?: () => void;
}

/**
 * Top navigation. Action buttons keep a one-line row on phones: labels are
 * wrapped in `.btn-label` so very narrow screens can collapse them to icons
 * (see the <=380px media query) without the row wrapping to a second line.
 * Role-based sections (admin) are handled inside /console, not here.
 */
export default function SiteHeader({ authenticated, onLogout }: Props) {
  useTheme();
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark">✦</span>
          <span>
            <div className="brand-name">ModelHub</div>
            <div className="brand-sub">Model Directory</div>
          </span>
        </Link>
        <div className="header-actions">
          <button
            className="icon-btn"
            onClick={toggleTheme}
            aria-label="切换主题"
            title="切换主题"
          >
            ◐<span className="btn-label"> 主题</span>
          </button>
          {authenticated ? (
            <>
              <Link href="/console" className="icon-btn" title="控制台">
                ▤<span className="btn-label"> 控制台</span>
              </Link>
              {onLogout && (
                <button className="icon-btn" onClick={onLogout} title="退出登录">
                  ⏻<span className="btn-label"> 退出</span>
                </button>
              )}
            </>
          ) : (
            <Link href="/login" className="icon-btn" title="登录">
              ⇢<span className="btn-label"> 登录</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
