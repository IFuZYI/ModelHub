import type { ProviderType, FetchStatus, FreeTier } from "@/lib";
import { typeLabel, statusLabel } from "../lib/display";

export function TypeBadge({ type }: { type: ProviderType }) {
  return <span className={`badge ${type}`}>{typeLabel(type)}</span>;
}

/**
 * Free-tier tag. "full" → FULL FREE, "free" → FREE, "none" → nothing.
 * Only the two free grades render; a paid provider shows no badge.
 */
export function FreeBadge({ tier }: { tier: FreeTier }) {
  if (tier === "none") return null;
  const label = tier === "full" ? "FULL FREE" : "FREE";
  return <span className={`badge free-tag ${tier}`}>{label}</span>;
}

export function StatusDot({ status }: { status: FetchStatus }) {
  return (
    <span className="status">
      <span className={`dot ${status}`} />
      {statusLabel(status)}
    </span>
  );
}
