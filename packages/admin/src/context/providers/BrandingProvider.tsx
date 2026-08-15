"use client";

import { useQuery } from "@tanstack/react-query";
import type React from "react";
import { createContext, useContext, useEffect, useMemo } from "react";

import { protectedApi } from "../../lib/api/protectedApi";
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

/**
 * Whether the admin-meta request has answered yet, alongside its answer.
 *
 * The two are held together because most readers want only the answer, and
 * one reader — a page that treats a plugin's ABSENCE from the list as a fact
 * about the project — needs to know the list has actually arrived. Before it
 * does, `branding` is undefined, which is indistinguishable from a project
 * that has no plugins.
 */
interface BrandingState {
  branding: AdminBranding | undefined;
  /**
   * True until the WORKSPACE query settles, either way.
   *
   * Not the public half: this pairs with `isUnavailable` to answer whether a
   * plugin being absent is a fact, and the plugin list is in the workspace
   * half alone.
   */
  isPending: boolean;
  /**
   * True when the PUBLIC half never produced an answer.
   *
   * Separate from `isUnavailable` because the two halves fail independently
   * and for different reasons: the workspace half fails routinely before
   * sign-in, which says nothing about branding being readable.
   */
  isBrandingUnavailable: boolean;
  /**
   * True when admin-meta has never produced an answer, so absence proves
   * nothing.
   *
   * Not "the last request failed". Once a response is cached, a failed
   * BACKGROUND refetch leaves that answer intact and still valid, and treating
   * it as unavailable would replace a correct page with an error for as long
   * as the server stays unreachable.
   */
  isUnavailable: boolean;
}

const BrandingContext = createContext<BrandingState | undefined>(undefined);

export function useBranding(): AdminBranding {
  return useContext(BrandingContext)?.branding ?? {};
}

/**
 * The admin-meta request's state, for readers that draw a conclusion from
 * something being MISSING from branding.
 *
 * Derived from the same context entry `useBranding` reads, rather than from a
 * second query: two `useQuery` calls on one key would report their states
 * independently and could disagree about whether the data has arrived.
 */
export function useBrandingStatus(): Omit<BrandingState, "branding"> {
  const state = useContext(BrandingContext);
  // No provider above: nothing is loading and nothing failed, which is the
  // same shape a settled empty response has. A reader outside the provider is
  // already reading `{}` from `useBranding`, and reporting "still pending"
  // here would hang it forever.
  return {
    isPending: state?.isPending ?? false,
    isUnavailable: state?.isUnavailable ?? false,
    isBrandingUnavailable: state?.isBrandingUnavailable ?? false,
  };
}

// ============================================================================
// Side Effects
// ============================================================================

/**
 * Injects a <style> tag that overrides the Tailwind CSS custom properties on
 * `.nextly-admin` and `.nextly-admin.dark` with user-supplied brand colors.
 *
 * This handles DB-level overrides (e.g. logoText set via admin Settings UI).
 * For the initial config-based colors, a server-side <style> tag is injected
 * by the consumer's layout.tsx using `getBrandingCss()` from `nextly/config`.
 *
 * Runs only when colors change. Cleans up on unmount.
 */
function useColorInjection(colors: ResolvedBrandingColors | undefined) {
  useEffect(() => {
    if (!colors || (!colors.primary && !colors.accent)) return;

    const rules: string[] = [];

    // The /admin-meta API resolves these to complete CSS colors (e.g.
    // "hsl(239 84.3% 64.7%)"), which is what the `--nx-*` tokens hold.
    const primaryHsl = colors.primary;
    const accentHsl = colors.accent;

    if (primaryHsl) {
      rules.push(`--nx-primary: ${primaryHsl};`);
      rules.push(
        `--nx-primary-foreground: ${colors.primaryForeground ?? "0 0% 100%"};`
      );
      // Derived tokens that reference --nx-primary HSL triplet
      rules.push(`--nx-ring: ${primaryHsl};`);
      rules.push(`--nx-focus-ring: ${primaryHsl};`);
      rules.push(`--nx-sidebar-ring: ${primaryHsl};`);
      rules.push(`--nx-chart-1: ${primaryHsl};`);
    }

    if (accentHsl) {
      rules.push(`--nx-accent: ${accentHsl};`);
      rules.push(
        `--nx-accent-foreground: ${colors.accentForeground ?? "0 0% 100%"};`
      );
      rules.push(`--nx-chart-2: ${accentHsl};`);
    }

    // Scoped to .nextly-admin so we never leak styles to the host application.
    // Applied to both light and dark variants since the user's brand colors
    // are injected as the same values in both modes. Keep this selector and the
    // token names in step with `getBrandingCss`, which server-renders the same
    // declarations to avoid a flash of unbranded color before this runs.
    const css = `.nextly-admin, .nextly-admin.dark { ${rules.join(" ")} }`;

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
  const {
    data: brandingData,
    // `isLoadingError`, not `isError`: the latter is also true when a
    // background refetch fails while a previous response is still cached, and
    // that cached response is a perfectly good answer.
    isLoadingError: brandingUnavailable,
  } = useQuery<AdminBranding>({
    queryKey: ["admin-meta"],
    queryFn: () => publicApi.get<AdminBranding>("/admin-meta"),
    // Refetch periodically to pick up changes to custom sidebar groups,
    // plugin placements, and other admin-meta settings without a full page reload.
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
  });

  // The half that describes the installation rather than its appearance. It
  // comes from a session-gated route, so before sign-in this query fails and
  // contributes nothing — which is correct, since no pre-session surface reads
  // these fields.
  const {
    data: workspaceData,
    isPending: workspacePending,
    isLoadingError: workspaceUnavailable,
  } = useQuery<AdminBranding>({
    queryKey: ["admin-meta", "workspace"],
    queryFn: () => protectedApi.get<AdminBranding>("/admin-meta/workspace"),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  useColorInjection(brandingData?.colors);
  useFaviconInjection(brandingData?.favicon);

  // Memoized because the value is an object built here rather than either
  // query's stable `data` reference: without this every consumer of the
  // context re-renders on each render of this provider.
  //
  // The two halves are merged so the shape consumers read is unchanged; the
  // boundary that matters is the one on the server, which decides what an
  // anonymous caller can be served at all.
  const value = useMemo(() => {
    const merged =
      brandingData === undefined && workspaceData === undefined
        ? undefined
        : { ...brandingData, ...workspaceData };
    return {
      branding: merged,
      // The WORKSPACE query, matching `isUnavailable`. Both answer one
      // question — is it safe to conclude something from a plugin being
      // absent — and the plugin list is in that half. Combining the two
      // reports "still loading" while the only relevant query has settled, so
      // a stalled public request would hold the reader on a loading state
      // indefinitely and hide a definitive workspace error behind it.
      isPending: workspacePending,
      // Reported from the WORKSPACE query. The reader this exists for treats a
      // plugin's absence from the list as a fact about the project, and the
      // plugin list lives in that half — so branding having arrived says
      // nothing about whether that conclusion is safe to draw.
      isUnavailable: workspaceUnavailable,
      isBrandingUnavailable: brandingUnavailable,
    };
  }, [
    brandingData,
    workspaceData,
    workspacePending,
    workspaceUnavailable,
    brandingUnavailable,
  ]);

  return (
    <BrandingContext.Provider value={value}>
      {children}
    </BrandingContext.Provider>
  );
}
