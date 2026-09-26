import type { ProviderType, FetchStatus } from "@/lib";
import { typeLabel, statusLabel } from "../lib/display";

export function TypeBadge({ type }: { type: ProviderType }) {
  return <span className={`badge ${type}`}>{typeLabel(type)}</span>;
}

/** Small FREE tag shown when a provider offers a free tier / free tokens. */
export function FreeBadge() {
  return <span className="badge free-tag">FREE</span>;
}

export function StatusDot({ status }: { status: FetchStatus }) {
  return (
    <span className="status">
      <span className={`dot ${status}`} />
      {statusLabel(status)}
    </span>
  );
}
