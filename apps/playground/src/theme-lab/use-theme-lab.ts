"use client";

/**
 * State and persistence for the theme lab's two self-contained axes:
 * theme and density. Mode (light/dark) is a third axis but is
 * deliberately not modeled here -- the admin already owns light/dark through
 * next-themes (`packages/admin/src/context/providers/ThemeProvider.tsx`),
 * which persists its own choice and keeps every `.nextly-admin` container's
 * `dark` class in sync, including across the shell's route remounts. Adding
 * a second, competing mechanism for the same concern would just be a second
 * place for the two to disagree; the switcher panel calls that hook directly
 * for mode instead of duplicating it here.
 */
import { useCallback, useEffect, useState } from "react";

import { NEXTLY_THEMES } from "./themes";
import { TWEAKCN_THEMES } from "./themes/tweakcn.generated";
import type { DensityId, ThemeDefinition } from "./types";

const STORAGE_KEY = "nextly-theme-lab";

export interface Selection {
  theme: string;
  density: DensityId;
}

export const DEFAULT_SELECTION: Selection = {
  theme: "mono",
  density: "default",
};

// Every theme this build knows about, Nextly originals and tweakcn presets
// alike. Built from the arrays rather than a literal count anywhere, so the
// set can grow (or a preset can be retired) without this file changing.
const ALL_THEMES: ThemeDefinition[] = [...NEXTLY_THEMES, ...TWEAKCN_THEMES];
const KNOWN_THEMES = new Set(ALL_THEMES.map(theme => theme.id));
const THEMES_BY_ID = new Map(ALL_THEMES.map(theme => [theme.id, theme]));

// Runtime companion to the DensityId union, which is compile-time only and so
// cannot vet a value that arrives as parsed JSON. Guards the stored density
// the same way KNOWN_THEMES guards the stored theme id: anything the
// densities stylesheet has no block for selects nothing, and an admin with no
// density applied reads as a broken build rather than a stale preference.
const KNOWN_DENSITIES = new Set<string>([
  "compact",
  "default",
  "comfortable",
] satisfies DensityId[]);

/**
 * Reads the stored selection, falling back to the control for anything
 * unrecognised. A stale id from a renamed or removed theme would otherwise
 * render the admin with no tokens set at all, which looks like a broken
 * build rather than the stale preference it is.
 *
 * Reads only the keys it knows about, so a selection persisted by an older
 * build with extra keys (the retired layout axis, say) is narrowed to the
 * current shape rather than rejected.
 */
export function readSelection(): Selection {
  if (typeof localStorage === "undefined") return DEFAULT_SELECTION;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_SELECTION;

  try {
    const parsed = JSON.parse(raw) as Partial<Selection>;
    return {
      theme:
        parsed.theme && KNOWN_THEMES.has(parsed.theme)
          ? parsed.theme
          : DEFAULT_SELECTION.theme,
      density:
        parsed.density && KNOWN_DENSITIES.has(parsed.density)
          ? parsed.density
          : DEFAULT_SELECTION.density,
    };
  } catch {
    return DEFAULT_SELECTION;
  }
}

export function writeSelection(selection: Selection): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
}

/**
 * Applies the selection as data attributes on every admin root, which is what
 * the generated theme and density stylesheets are both scoped to.
 * Reapplied via a MutationObserver because the admin shell remounts its root
 * element between route navigations, which would otherwise drop whatever
 * this last set.
 */
export function useThemeLab() {
  // Lazy initialiser reads localStorage synchronously before first paint
  // instead of via a setState call inside an effect, which the
  // react-hooks/set-state-in-effect rule flags: readSelection already
  // returns the default when localStorage doesn't exist (server render), so
  // the server and first client render stay identical and hydration has
  // nothing to reconcile.
  const [selection, setSelection] = useState<Selection>(() => readSelection());

  useEffect(() => {
    const apply = () => {
      // Every `.nextly-admin` element, not just the first. The admin renders
      // two of them (packages/admin/src/layout/RootLayout.tsx): the shell
      // itself, and `#nextly-admin-portal-root`, the container every Radix
      // portal mounts into -- dropdowns, selects, dialogs, tooltips,
      // popovers, the command palette and toasts. The compiled admin
      // stylesheet re-declares the full `--nx-*` token set on EVERY
      // `.nextly-admin` element, so a token only resolves to the theme's
      // value on the element that carries `data-theme`; attributing only the
      // first would leave every overlay rendering the shipped defaults. The
      // admin's own ThemeProvider syncs its `dark` class the same way, for
      // the same reason.
      // `:not([data-theme-preview])` excludes the theme lab's own preview
      // panels, which wear `nextly-admin` to pick up the ui components' base
      // styles but are not admin roots. Attributing them would stamp every
      // preview with the SELECTED theme's density, so each theme would be
      // previewed at whatever density is currently active rather than at its
      // own -- and a preview would change when the selection changed.
      document
        .querySelectorAll(".nextly-admin:not([data-theme-preview])")
        .forEach(root => {
          if (!(root instanceof HTMLElement)) return;
          // Only touch attributes that actually changed: the same `apply` runs
          // from the MutationObserver below on any attribute mutation, and
          // writing an unchanged value would otherwise retrigger that observer.
          if (root.dataset.theme !== selection.theme) {
            root.dataset.theme = selection.theme;
          }
          if (root.dataset.density !== selection.density) {
            root.dataset.density = selection.density;
          }
        });
    };

    apply();
    writeSelection(selection);

    // Observes the whole body subtree deliberately. The portal container is
    // created lazily by a ref callback after the shell's first commit, and
    // route changes remount the shell, so an observer scoped to either root
    // would miss the very elements this needs to attribute.
    const observer = new MutationObserver(apply);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-theme", "data-density"],
    });

    return () => observer.disconnect();
  }, [selection]);

  const setTheme = useCallback((theme: string) => {
    setSelection(prev => {
      const nextTheme = THEMES_BY_ID.get(theme);
      if (!nextTheme) return prev;
      const prevTheme = THEMES_BY_ID.get(prev.theme);

      // Picking a theme applies its intended complete look (its recommended
      // density) -- but only if the user hasn't already steered density away
      // from what the PREVIOUS theme recommended. This is derived from the
      // persisted selection rather than a separate "user touched this" flag:
      // a density still sitting at what the last theme recommended is
      // "following" and moves with the new theme; one that has drifted from
      // it is a deliberate choice and is left alone across the switch, so it
      // can't be silently overridden by picking a theme.
      const density =
        prevTheme && prev.density === prevTheme.recommendedDensity
          ? nextTheme.recommendedDensity
          : prev.density;

      return { theme, density };
    });
  }, []);

  const setDensity = useCallback((density: DensityId) => {
    setSelection(prev => ({ ...prev, density }));
  }, []);

  const reset = useCallback(() => setSelection(DEFAULT_SELECTION), []);

  return {
    ...selection,
    setTheme,
    setDensity,
    reset,
  };
}
