"use client";

import {
  oklchToRgb,
  parseHex,
  readableOn,
  toHex,
  type Oklch,
  type Rgb,
} from "@nextlyhq/ui/color";
import { useQuery } from "@tanstack/react-query";
import type React from "react";
import { createContext, useContext, useEffect, useMemo } from "react";

import {
  ADMIN_META_KEY,
  ADMIN_WORKSPACE_KEY,
  useSchemaUpdateInvalidation,
} from "@admin/hooks/useSchemaUpdateInvalidation";

import { useAuthSession } from "../../hooks/queries/useAuthSession";
import { useFaviconInjection } from "../../hooks/useFaviconInjection";
import { enableDevReload } from "../../lib/api/fetcher";
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
 * What to call this product on screen.
 *
 * One implementation, because the answer is one decision: a screen that spells
 * `branding.logoText ?? "Nextly"` for itself can disagree with the component
 * beside it. The signed-out screens had that shape — the card supplied the
 * logo's label while the screen supplied the sentence under it, so a change to
 * either fallback made the two contradict each other on one page.
 */
export function useAppName(): string {
  // `??` alone would let a configured-but-empty `logoText` through, and an
  // empty name is worse than a default one: the sign-in line reads "Sign in to
  // your  account" and the card passes `alt=""`, which strips the logo's
  // accessible name rather than just looking odd.
  return useBranding().logoText?.trim() || "Nextly";
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
 * The surfaces a chart mark is drawn on, in each mode: the card, a bar's track
 * and the tooltip, as `--nx-card`, `--nx-muted` and `--nx-popover` are set in
 * the theme (`packages/ui/src/styles/theme.css`, which a test holds this to).
 */
export const CHART_SURFACES: Readonly<
  Record<"light" | "dark", readonly Oklch[]>
> = {
  light: [
    { l: 1, c: 0, h: 0 },
    { l: 0.97, c: 0, h: 0 },
    { l: 0.99, c: 0, h: 0 },
  ],
  dark: [
    { l: 0.14, c: 0, h: 0 },
    { l: 0.23, c: 0, h: 0 },
    { l: 0.18, c: 0, h: 0 },
  ],
};

/** The contrast a chart mark keeps against what it is drawn on (WCAG's non-text minimum). */
const CHART_MARK_CONTRAST = 3;

/**
 * A brand colour as `/admin-meta` resolves it (`hsl(239 84.3% 64.7%)`, or a
 * hex value), in sRGB; `undefined` for anything else, which is then drawn as
 * given.
 */
export function parseBrandColour(css: string): Rgb | undefined {
  const hex = parseHex(css.trim());
  if (hex) return hex;
  const match =
    /^hsla?\(\s*(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i.exec(
      css.trim()
    );
  if (!match) return undefined;
  const h = (((Number(match[1]) % 360) + 360) % 360) / 360;
  const s = Math.min(1, Number(match[2]) / 100);
  const l = Math.min(1, Number(match[3]) / 100);
  if ([h, s, l].some(Number.isNaN)) return undefined;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return { r: channel(h + 1 / 3), g: channel(h), b: channel(h - 1 / 3) };
}

/**
 * A brand colour as a chart mark draws it in `mode`: unchanged when it already
 * reads at 3:1 on every surface a mark is drawn on, and otherwise moved in
 * lightness alone until it does (`readableOn`), so the chart stays the brand's
 * hue and never becomes unreadable. A colour that cannot be read as one is
 * drawn as given.
 */
export function chartColourFor(css: string, mode: "light" | "dark"): string {
  const colour = parseBrandColour(css);
  if (!colour) return css;
  const readable = readableOn(
    colour,
    CHART_SURFACES[mode].map(oklchToRgb),
    CHART_MARK_CONTRAST
  );
  return readable === colour ? css : toHex(readable);
}

/**
 * The stylesheet that writes the brand's colours over the theme's tokens, or
 * `undefined` when the brand sets none: separate from the effect that injects
 * it, so what it writes for each mode can be read without a document.
 */
export function brandingCss(
  colors: ResolvedBrandingColors | undefined
): string | undefined {
  if (!colors || (!colors.primary && !colors.accent)) return undefined;

  const rules: string[] = [];

  // The /admin-meta API resolves these to complete CSS colors (e.g.
  // "hsl(239 84.3% 64.7%)"), which is what the `--nx-*` tokens hold.
  const primaryHsl = colors.primary;
  const accentHsl = colors.accent;

  if (primaryHsl) {
    rules.push(`--nx-primary: ${primaryHsl};`);
    // Only when the API resolved one. The fallback was the bare triplet
    // "0 0% 100%", which lands in `color: var(--nx-primary-foreground)` as an
    // invalid value: the declaration is dropped and the text inherits the
    // ambient foreground, which on a branded surface is the page's dark text.
    // Emitting nothing instead leaves the theme's own token in force, which is
    // a real colour chosen for the mode rather than one invented here.
    if (colors.primaryForeground) {
      rules.push(`--nx-primary-foreground: ${colors.primaryForeground};`);
    }
    // Derived tokens that reference --nx-primary HSL triplet
    rules.push(`--nx-ring: ${primaryHsl};`);
    rules.push(`--nx-focus-ring: ${primaryHsl};`);
    rules.push(`--nx-sidebar-ring: ${primaryHsl};`);
  }

  if (accentHsl) {
    rules.push(`--nx-accent: ${accentHsl};`);
    // Conditional for the same reason as the primary foreground above.
    if (colors.accentForeground) {
      rules.push(`--nx-accent-foreground: ${colors.accentForeground};`);
    }
  }

  // The chart slots per mode: a brand colour drawn as a chart mark is held to
  // 3:1 on that mode's surfaces, so one too light for the light theme, or too
  // dark for the dark one, is adjusted for that mode alone.
  const chartRules = (mode: "light" | "dark") =>
    [
      primaryHsl ? `--nx-chart-1: ${chartColourFor(primaryHsl, mode)};` : "",
      accentHsl ? `--nx-chart-2: ${chartColourFor(accentHsl, mode)};` : "",
    ]
      .filter(Boolean)
      .join(" ");

  // Scoped to .nextly-admin so we never leak styles to the host application.
  // The brand tokens are the same in both modes; the chart slots alone are
  // written per mode, each adjusted for that mode's surfaces. Keep this
  // selector and the token names in step with `getBrandingCss`, which
  // server-renders the unadjusted declarations to avoid a flash of unbranded
  // color before this runs; charts draw only once their data has loaded on
  // the client, by when these have replaced them.
  return (
    `.nextly-admin, .nextly-admin.dark { ${rules.join(" ")} } ` +
    `.nextly-admin { ${chartRules("light")} } ` +
    `.nextly-admin.dark { ${chartRules("dark")} }`
  );
}

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
    const css = brandingCss(colors);
    if (css === undefined) return;

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
 * theme (`useTheme`) — favicons can't reliably react to JS theme toggles
 * across browsers, so the in-app dark-mode switch won't update the favicon.
 */
const DEFAULT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${DEFAULT_MARK_VIEWBOX}"><style>path{fill:#000}@media (prefers-color-scheme: dark){path{fill:#fff}}</style>${DEFAULT_MARK_PATHS.map(d => `<path d="${d}"/>`).join("")}</svg>`;
const DEFAULT_FAVICON_DATA_URL = `data:image/svg+xml;utf8,${encodeURIComponent(DEFAULT_FAVICON_SVG)}`;

// ============================================================================
// Provider
// ============================================================================

interface BrandingProviderProps {
  children: React.ReactNode;
}

export function BrandingProvider({ children }: BrandingProviderProps) {
  // Both queries below are cached for five minutes, and a schema change makes
  // them stale — the workspace half carries the widget declarations, including
  // the cards core derives per collection. This provider owns them, so it is
  // the one that re-reads them.
  useSchemaUpdateInvalidation(ADMIN_META_KEY);

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

  /*
   * The half that describes the installation rather than its appearance, from a
   * SESSION-GATED route.
   *
   * Both the session state and the settled-ness of the session query are load
   * bearing, and for different reasons.
   *
   * `signedIn` is in the KEY, not in a refetch effect. A request made before a
   * session existed answers 401, and this query does not retry — so signing in
   * has to produce a DIFFERENT cache entry rather than revive a dead one.
   * Expressing that as an invalidation instead leaves a window: the 401 can land
   * after the sign-in effect has already run, and the query then stays failed
   * with nothing left to trigger it. A key cannot lose that race, because the
   * new key has no result yet whenever it appears.
   *
   * `enabled` waits for the session query to SETTLE rather than to succeed. It
   * stops the anonymous 401 being fired speculatively on every load, and a
   * session query that itself failed still releases this one — reporting
   * unavailable, which is true, instead of holding every reader on a skeleton
   * for a fact that will never arrive.
   */
  const { data: session, isPending: sessionPending } = useAuthSession();
  const signedIn = session?.isAuthenticated === true;

  const {
    data: workspaceData,
    isPending: workspacePending,
    isLoadingError: workspaceUnavailable,
  } = useQuery<AdminBranding>({
    queryKey: [...ADMIN_WORKSPACE_KEY, signedIn],
    queryFn: () => protectedApi.get<AdminBranding>("/admin-meta/workspace"),
    staleTime: 5 * 60 * 1000,
    retry: false,
    enabled: !sessionPending,
  });

  useColorInjection(brandingData?.colors);
  useFaviconInjection(
    brandingData?.favicon?.trim() || DEFAULT_FAVICON_DATA_URL
  );

  // The dev-reload subscription is the SERVER's call, not the bundle's. The
  // workspace half carries the running server's answer (`devReload`, computed
  // from the same runtime comparison that gates the route), and only an
  // explicit `true` opens the stream: `undefined` means the answer has not
  // arrived yet, and dialing on it would hit a route that may not exist. The
  // stream itself is dev-only, so this stays inert in every production host —
  // which is the point: the fold this replaces once silenced consumer dev
  // builds as a side effect of silencing production.
  const workspaceDevReload = workspaceData?.devReload;
  useEffect(() => {
    if (workspaceDevReload === true) {
      enableDevReload();
    }
  }, [workspaceDevReload]);

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
      // True while the session is still resolving as well. Until it settles this
      // query has not been allowed to run, and reporting anything else would
      // let a reader conclude something from a list that was never requested.
      isPending: sessionPending || workspacePending,
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
    sessionPending,
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
