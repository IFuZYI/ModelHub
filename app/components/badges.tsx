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

/**
 * Read-only star display (0-5, half-star precision not needed — shows the
 * rounded average). `count` renders next to it when non-zero.
 */
export function Stars({
  average,
  count,
  size = 14,
}: {
  average: number | null;
  count: number;
  size?: number;
}) {
  const filled = average === null ? 0 : Math.round(average);
  const label =
    average === null
      ? "暂无评分"
      : `${average} 星，${count} 人评分`;
  return (
    <span
      className="stars"
      title={label}
      role="img"
      aria-label={label}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`star ${i <= filled ? "on" : ""}`}
          style={{ fontSize: size }}
          aria-hidden="true"
        >
          ★
        </span>
      ))}
      {count > 0 && (
        <span className="stars-count" aria-hidden="true">
          {average}（{count}）
        </span>
      )}
    </span>
  );
}

/**
 * Interactive star picker for the rating widget. `value` is the current
 * score (0-5); hovering previews.
 */
export function StarPicker({
  value,
  onPick,
  disabled = false,
}: {
  value: number;
  onPick: (score: number) => void;
  disabled?: boolean;
}) {
  return (
    <span className="star-picker">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          className={`star-btn ${i <= value ? "on" : ""}`}
          disabled={disabled}
          onClick={() => onPick(i)}
          aria-label={`打 ${i} 星`}
        >
          ★
        </button>
      ))}
    </span>
  );
}
