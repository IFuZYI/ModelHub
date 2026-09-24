import { providerInitial, isIconUrl } from "../lib/display";

/**
 * Provider avatar: renders the official favicon (when icon is a URL), an
 * emoji/glyph (when icon is a short string), or the name's initial as a
 * fallback. `className` selects the sizing style (.card-icon, .preset-avatar…).
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
  if (isIconUrl(icon)) {
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
        />
      </span>
    );
  }
  return (
    <span className={className}>
      {icon && icon.trim().length ? icon : providerInitial(name)}
    </span>
  );
}
