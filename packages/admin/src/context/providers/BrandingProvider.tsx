"use client";

import { useQuery } from "@tanstack/react-query";
import React, { createContext, useContext, useEffect } from "react";

import { publicApi } from "../../lib/api/publicApi";
import {
  DEFAULT_MARK_PATHS,
  DEFAULT_MARK_VIEWBOX,
} from "../../lib/branding/default-mark";
import type {
  AdminBranding,
  ResolvedBrandingColors,
} from "../../types/branding";

// ============================================================================
// Context
// ============================================================================

const BrandingContext = createContext<AdminBranding | undefined>(undefined);

export function useBranding(): AdminBranding {
  return useContext(BrandingContext) ?? {};
}

// ============================================================================
// Side Effects
// ============================================================================

/**
 * Injects a <style> tag that overrides the Tailwind CSS custom properties on
 * `.adminapp` and `.adminapp.dark` with user-supplied brand colors.
 *
 * This handles DB-level overrides (e.g. logoText set via admin Settings UI).
 * For the initial config-based colors, a server-side <style> tag is injected
 * by the consumer's layout.tsx using `getBrandingCss()` from `@revnixhq/nextly/config`.
 *
 * Runs only when colors change. Cleans up on unmount.
 */
function useColorInjection(colors: ResolvedBrandingColors | undefined) {
  useEffect(() => {
    if (!colors || (!colors.primary && !colors.accent)) return;

    const rules: string[] = [];

    // Note: The /admin-meta API already returns HSL triplets like "0 0% 0%"
    const primaryHsl = colors.primary;
    const accentHsl = colors.accent;

    if (primaryHsl) {
      rules.push(`--primary: ${primaryHsl};`);
      rules.push(
        `--primary-foreground: ${colors.primaryForeground ?? "0 0% 100%"};`
      );
      // Derived tokens that reference --primary HSL triplet
      rules.push(`--ring: ${primaryHsl};`);
      rules.push(`--focus-ring: ${primaryHsl};`);
      rules.push(`--sidebar-ring: ${primaryHsl};`);
      rules.push(`--chart-1: ${primaryHsl};`);
    }

    if (accentHsl) {
      rules.push(`--accent: ${accentHsl};`);
      rules.push(
        `--accent-foreground: ${colors.accentForeground ?? "0 0% 100%"};`
      );
      rules.push(`--chart-2: ${accentHsl};`);
    }

    // Scoped to .adminapp so we never leak styles to the host application.
    // Applied to both light and dark variants since the user's brand colors
    // are injected as the same HSL values in both modes.
    const css = `.adminapp, .adminapp.dark { ${rules.join(" ")} }`;

    const style = document.createElement("style");
    style.id = "nextly-branding-colors";
    style.textContent = css;

    document.getElementById("nextly-branding-colors")?.remove();
    document.head.appendChild(style);

    return () => {
      document.getElementById("nextly-branding-colors")?.remove();
    };
  }, [colors]);
}

/**
 * Default inline SVG favicon (theme-aware via `prefers-color-scheme`).
 * Used when no `branding.favicon` is configured.
 *
 * Note: uses the OS-level color-scheme preference rather than the in-app
 * `next-themes` value — favicons can't reliably react to JS theme toggles
 * across browsers, so the in-app dark-mode switch won't update the favicon.
 */
const DEFAULT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${DEFAULT_MARK_VIEWBOX}"><style>path{fill:#000}@media (prefers-color-scheme: dark){path{fill:#fff}}</style>${DEFAULT_MARK_PATHS.map(d => `<path d="${d}"/>`).join("")}</svg>`;
const DEFAULT_FAVICON_DATA_URL = `data:image/svg+xml;utf8,${encodeURIComponent(DEFAULT_FAVICON_SVG)}`;

/**
 * Updates page favicon links.
 * Config value wins; otherwise falls back to the inline SVG default.
 *
 * Removes any existing icon links (including Next.js's auto-generated
 * favicon.ico link with stale `sizes`/`type` attributes) and appends a
 * fresh `<link>` so the browser reliably picks up the new icon.
 */
function useFaviconInjection(favicon: string | undefined) {
  useEffect(() => {
    const resolvedFavicon = favicon?.trim() || DEFAULT_FAVICON_DATA_URL;
    const isSvg = resolvedFavicon.startsWith("data:image/svg+xml");

    document
      .querySelectorAll<HTMLLinkElement>(
        'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'
      )
      .forEach(link => link.remove());

    const link = document.createElement("link");
    link.rel = "icon";
    if (isSvg) link.type = "image/svg+xml";
    link.href = resolvedFavicon;
    document.head.appendChild(link);
  }, [favicon]);
}

// ============================================================================
// Provider
// ============================================================================

interface BrandingProviderProps {
  children: React.ReactNode;
}

export function BrandingProvider({ children }: BrandingProviderProps) {
  const { data: fetchedData } = useQuery<AdminBranding>({
    queryKey: ["admin-meta"],
    queryFn: () => publicApi.get<AdminBranding>("/admin-meta"),
    // Refetch periodically to pick up changes to custom sidebar groups,
    // plugin placements, and other admin-meta settings without a full page reload.
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
  });

  useColorInjection(fetchedData?.colors);
  useFaviconInjection(fetchedData?.favicon);

  return (
    <BrandingContext.Provider value={fetchedData}>
      {children}
    </BrandingContext.Provider>
  );
}
