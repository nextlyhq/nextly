"use client";

import { useMemo } from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useTheme } from "@admin/context/providers/ThemeProvider";
import {
  DEFAULT_MARK_PATHS,
  DEFAULT_MARK_VIEWBOX,
} from "@admin/lib/branding/default-mark";
import { cn } from "@admin/lib/utils";

export interface ThemeAwareLogoProps {
  alt?: string;
  className?: string;
  /**
   * Optional URL fallbacks. When omitted, an inline SVG is rendered instead.
   */
  defaultLightSrc?: string;
  defaultDarkSrc?: string;
  forceTheme?: "light" | "dark";
  /**
   * Render the built-in mark on a filled, rounded tile.
   *
   * Opt-in, and it applies to the built-in mark ONLY. A configured logo is
   * someone else's brand: it may already carry its own container or padding,
   * and a tile behind a wordmark drawn for a transparent background can hide
   * it outright. So a project that sets `logoUrl` keeps exactly what it
   * uploaded, and this changes nothing for them.
   */
  boxed?: boolean;
}

/**
 * Theme-aware logo renderer.
 *
 * Priority order:
 * 1) `branding.logoUrl` (highest priority, e.g. user-configured custom logo)
 * 2) `branding.logoUrlLight`/`branding.logoUrlDark` based on resolved theme
 * 3) `defaultLightSrc`/`defaultDarkSrc` if provided
 * 4) Inline SVG fallback (ink comes from a theme token, optionally on a tile)
 */
export function ThemeAwareLogo({
  alt,
  className,
  defaultLightSrc,
  defaultDarkSrc,
  forceTheme,
  boxed = false,
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
    // `currentColor` rather than a literal, so the mark takes its ink from a
    // theme token like everything else the admin paints. The tile pairs the
    // surface with the foreground declared against it, which is the pairing
    // the token system guarantees a contrast for.
    const mark = (
      <svg
        viewBox={DEFAULT_MARK_VIEWBOX}
        xmlns="http://www.w3.org/2000/svg"
        className={boxed ? "h-1/2 w-1/2" : cn("text-foreground", className)}
        fill="currentColor"
        role={boxed ? undefined : "img"}
        aria-label={boxed ? undefined : computedAlt}
        aria-hidden={boxed ? true : undefined}
      >
        {DEFAULT_MARK_PATHS.map(d => (
          <path key={d} d={d} />
        ))}
      </svg>
    );

    if (!boxed) return mark;

    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground",
          className
        )}
        role="img"
        aria-label={computedAlt}
      >
        {mark}
      </span>
    );
  }

  return <img src={src} alt={computedAlt} className={className} />;
}
