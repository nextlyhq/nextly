import { useMemo } from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useTheme } from "@admin/context/providers/ThemeProvider";
import {
  DEFAULT_MARK_PATHS,
  DEFAULT_MARK_VIEWBOX,
} from "@admin/lib/branding/default-mark";

export interface ThemeAwareLogoProps {
  alt?: string;
  className?: string;
  /**
   * Optional URL fallbacks. When omitted, an inline SVG is rendered instead.
   */
  defaultLightSrc?: string;
  defaultDarkSrc?: string;
  forceTheme?: "light" | "dark";
}

/**
 * Theme-aware logo renderer.
 *
 * Priority order:
 * 1) `branding.logoUrl` (highest priority, e.g. user-configured custom logo)
 * 2) `branding.logoUrlLight`/`branding.logoUrlDark` based on resolved theme
 * 3) `defaultLightSrc`/`defaultDarkSrc` if provided
 * 4) Inline SVG fallback (fill color follows the resolved theme)
 */
export function ThemeAwareLogo({
  alt,
  className,
  defaultLightSrc,
  defaultDarkSrc,
  forceTheme,
}: ThemeAwareLogoProps) {
  const branding = useBranding();
  const { resolvedTheme } = useTheme();

  const theme = forceTheme || (resolvedTheme === "dark" ? "dark" : "light");

  const src = useMemo(() => {
    if (branding.logoUrl) return branding.logoUrl;

    if (theme === "dark") {
      return branding.logoUrlDark || defaultDarkSrc;
    }
    return branding.logoUrlLight || defaultLightSrc;
  }, [
    branding.logoUrl,
    branding.logoUrlDark,
    branding.logoUrlLight,
    defaultDarkSrc,
    defaultLightSrc,
    theme,
  ]);

  const computedAlt = alt ?? branding.logoText ?? "Logo";

  if (!src) {
    const fillColor = theme === "dark" ? "white" : "black";
    return (
      <svg
        viewBox={DEFAULT_MARK_VIEWBOX}
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        role="img"
        aria-label={computedAlt}
      >
        {DEFAULT_MARK_PATHS.map(d => (
          <path key={d} d={d} fill={fillColor} />
        ))}
      </svg>
    );
  }

  return <img src={src} alt={computedAlt} className={className} />;
}
