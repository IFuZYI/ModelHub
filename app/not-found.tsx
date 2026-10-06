import Link from "next/link";
import SiteHeader from "./components/SiteHeader";

/**
 * Branded 404 for unmatched routes (e.g. /providers/ with no id).
 *
 * Without this file Next.js renders its built-in white, English "404 — This
 * page could not be found" page, which broke the dark Chinese UI entirely
 * (no theme, no header, no way back). The per-page "not found" states (e.g.
 * /providers/<bad-id>) are handled inside those pages; this covers URLs that
 * match no route at all.
 *
 * Server component: can't read the session, so the header renders in its
 * logged-out shape — the login link is the safe default for a dead route.
 */
export default function NotFound() {
  return (
    <>
      <SiteHeader authenticated={false} />
      <main className="shell">
        <div className="empty">
          <h1 className="empty-title">页面不存在</h1>
          你访问的页面可能已被移除或地址有误。
          <div style={{ marginTop: 16 }}>
            <Link href="/" className="btn secondary">
              返回首页
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
