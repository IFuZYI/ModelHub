"use client";

import { useState } from "react";
import { providerInitial, isIconUrl } from "../lib/display";

/**
 * Provider avatar: renders the official favicon (when icon is a URL), an
 * emoji/glyph (when icon is a short string), or the name's initial as a
 * fallback. `className` selects the sizing style (.card-icon, .preset-avatar…).
 *
 * If a favicon URL fails to load (offline, blocked favicon service — e.g.
 * Google's s2/favicons is unreachable from mainland China), we fall back to the
 * name initial instead of showing the browser's broken-image glyph.
 */
export default function ProviderAvatar({
  name,
  icon,
  className = "card-icon",
}: {
  name: string;
  icon: string | null | undefined;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);

  if (isIconUrl(icon) && !broken) {
    return (
      <span className={className}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="provider-favicon"
          src={icon as string}
          alt=""
          width={24}
          height={24}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      </span>
    );
  }
  return (
    <span className={className}>
      {icon && !isIconUrl(icon) && icon.trim().length
        ? icon
        : providerInitial(name)}
    </span>
  );
}
