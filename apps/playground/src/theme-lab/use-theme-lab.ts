"use client";

/**
 * State and persistence for the theme lab's three self-contained axes:
 * theme, layout, and density. Mode (light/dark) is a fourth axis but is
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
import type { DensityId, LayoutId, ThemeDefinition } from "./types";

const STORAGE_KEY = "nextly-theme-lab";

export interface Selection {
  theme: string;
  layout: LayoutId;
  density: DensityId;
}

export const DEFAULT_SELECTION: Selection = {
  theme: "mono",
  layout: "rail-panel",
  density: "default",
};

// Every theme this build knows about, Nextly originals and tweakcn presets
// alike. Built from the arrays rather than a literal count anywhere, so the
// set can grow (or a preset can be retired) without this file changing.
const ALL_THEMES: ThemeDefinition[] = [...NEXTLY_THEMES, ...TWEAKCN_THEMES];
const KNOWN_THEMES = new Set(ALL_THEMES.map(theme => theme.id));
const THEMES_BY_ID = new Map(ALL_THEMES.map(theme => [theme.id, theme]));

/**
 * Reads the stored selection, falling back to the control for anything
 * unrecognised. A stale id from a renamed or removed theme would otherwise
 * render the admin with no tokens set at all, which looks like a broken
 * build rather than the stale preference it is.
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
      layout: parsed.layout ?? DEFAULT_SELECTION.layout,
      density: parsed.density ?? DEFAULT_SELECTION.density,
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
 * Applies the selection as data attributes on the admin root, which is what
 * the generated theme/layout/density stylesheets are all scoped to.
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
      const root = document.querySelector(".nextly-admin");
      if (!(root instanceof HTMLElement)) return;
      // Only touch attributes that actually changed: the same `apply` runs
      // from the MutationObserver below on any attribute mutation, and
      // writing an unchanged value would otherwise retrigger that observer.
      if (root.dataset.theme !== selection.theme) {
        root.dataset.theme = selection.theme;
      }
      if (root.dataset.layout !== selection.layout) {
        root.dataset.layout = selection.layout;
      }
      if (root.dataset.density !== selection.density) {
        root.dataset.density = selection.density;
      }
    };

    apply();
    writeSelection(selection);

    const observer = new MutationObserver(apply);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-theme", "data-layout", "data-density"],
    });

    return () => observer.disconnect();
  }, [selection]);

  const setTheme = useCallback((theme: string) => {
    setSelection(prev => {
      const nextTheme = THEMES_BY_ID.get(theme);
      if (!nextTheme) return prev;
      const prevTheme = THEMES_BY_ID.get(prev.theme);

      // Picking a theme applies its intended complete look (recommended
      // layout + density) -- but only along axes the user hasn't already
      // steered away from what the PREVIOUS theme recommended. This is
      // derived from the persisted selection rather than a separate "user
      // touched this" flag: an axis still sitting at what the last theme
      // recommended is "following" and moves with the new theme; one that
      // has drifted from it is a deliberate choice and is left alone across
      // the switch, so it can't be silently overridden by picking a theme.
      const layout =
        prevTheme && prev.layout === prevTheme.recommendedLayout
          ? nextTheme.recommendedLayout
          : prev.layout;
      const density =
        prevTheme && prev.density === prevTheme.recommendedDensity
          ? nextTheme.recommendedDensity
          : prev.density;

      return { theme, layout, density };
    });
  }, []);

  const setLayout = useCallback((layout: LayoutId) => {
    setSelection(prev => ({ ...prev, layout }));
  }, []);

  const setDensity = useCallback((density: DensityId) => {
    setSelection(prev => ({ ...prev, density }));
  }, []);

  const reset = useCallback(() => setSelection(DEFAULT_SELECTION), []);

  return {
    ...selection,
    setTheme,
    setLayout,
    setDensity,
    reset,
  };
}
