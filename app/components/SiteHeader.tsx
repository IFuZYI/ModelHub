"use client";

import Link from "next/link";
import { useTheme, toggleTheme } from "../theme";

interface Props {
  authenticated: boolean;
  onLogout?: () => void;
}

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
          >
            ◐ 主题
          </button>
          {authenticated ? (
            <>
              <Link href="/admin" className="icon-btn">
                ⚙ 后台
              </Link>
              {onLogout && (
                <button className="icon-btn" onClick={onLogout}>
                  退出
                </button>
              )}
            </>
          ) : (
            <Link href="/admin" className="icon-btn">
              管理登录
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
