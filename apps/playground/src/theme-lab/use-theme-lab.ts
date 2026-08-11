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
import { useCallback, useEffect, useSyncExternalStore } from "react";

import { NEXTLY_THEMES, TWEAKCN_THEMES } from "./themes";
import type { DensityId, ThemeDefinition } from "./types";

const STORAGE_KEY = "nextly-theme-lab";

export interface Selection {
  theme: string;
  density: DensityId;
  /**
   * Whether the contributor picked this density themselves.
   *
   * Recorded rather than inferred. Inferring it -- "the density still matches
   * the current theme's recommendation, so nobody chose it" -- has no answer
   * for the shipped selection, which recommends nothing, so passing through
   * the resting state turned a following density into a chosen one and the
   * next theme was shown at the wrong metrics.
   */
  densityChosen: boolean;
}

/**
 * The selection that applies NO lab override, so the admin renders the theme it
 * actually ships with.
 *
 * This is the default on purpose. A lab id as the default means the contributor
 * harness at `/admin` shows a lab palette on every fresh session, and the
 * generated `[data-theme="..."]` rules outrank the shipped base -- so routine
 * development and visual QA exercise a palette that is not the product's, with
 * nothing on screen saying so. Comparing a candidate is the deliberate act; the
 * shipped theme is the resting state.
 */
export const SHIPPED_THEME = "shipped";

export const DEFAULT_SELECTION: Selection = {
  theme: SHIPPED_THEME,
  density: "default",
  densityChosen: false,
};

// Every theme this build knows about, Nextly originals and tweakcn presets
// alike. Built from the arrays rather than a literal count anywhere, so the
// set can grow (or a preset can be retired) without this file changing.
const ALL_THEMES: ThemeDefinition[] = [...NEXTLY_THEMES, ...TWEAKCN_THEMES];
const KNOWN_THEMES = new Set([
  SHIPPED_THEME,
  ...ALL_THEMES.map(theme => theme.id),
]);
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
      // Absent in anything an older build stored, which reads as "not
      // chosen" -- the safe direction: a density that was in fact chosen goes
      // back to following, rather than a following one being frozen forever.
      densityChosen: parsed.densityChosen === true,
    };
  } catch {
    return DEFAULT_SELECTION;
  }
}

export function writeSelection(selection: Selection): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  // `storage` events fire only in OTHER documents, so a same-tab write is
  // invisible to any other hook instance without this. The switcher and the
  // gallery are both mounted on `/theme-lab`.
  window.dispatchEvent(new Event(SELECTION_EVENT));
}

/** Same-document notification that the stored selection changed. */
const SELECTION_EVENT = "nextly-theme-lab-selection";

/**
 * The snapshot `useSyncExternalStore` compares between renders.
 *
 * Cached deliberately: the hook compares snapshots by identity, so returning a
 * fresh object from every read would look like a change on every render and
 * spin. It is replaced only when the serialised value actually differs.
 */
let snapshot: Selection = DEFAULT_SELECTION;
let snapshotSource = JSON.stringify(DEFAULT_SELECTION);

function getSelectionSnapshot(): Selection {
  const current = readSelection();
  const serialised = JSON.stringify(current);
  if (serialised !== snapshotSource) {
    snapshot = current;
    snapshotSource = serialised;
  }
  return snapshot;
}

/**
 * What the server rendered, and therefore what the hydrating client render
 * must produce too. Constant: the server has no storage to read.
 */
function getServerSelectionSnapshot(): Selection {
  return DEFAULT_SELECTION;
}

function subscribeToSelection(onChange: () => void): () => void {
  window.addEventListener(SELECTION_EVENT, onChange);
  // Cross-tab: changing the theme in one tab should not leave another showing
  // a selection that is no longer stored.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SELECTION_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Applies the selection as data attributes on every admin root, which is what
 * the generated theme and density stylesheets are both scoped to.
 * Reapplied via a MutationObserver because the admin shell remounts its root
 * element between route navigations, which would otherwise drop whatever
 * this last set.
 */
export function useThemeLab() {
  // The persisted selection is read AFTER mount, never during the render that
  // hydrates.
  //
  // A lazy initialiser calling `readSelection()` looked safe because that
  // function returns the default when `localStorage` is undefined -- but that
  // guard only covers the server. On the client's first render localStorage
  // exists, so the initialiser returned the STORED value while the server had
  // rendered the default. The gallery renders those two states as different
  // markup (`Active` versus an `Apply` button), so React found a mismatched
  // tree and discarded the subtree it had just hydrated.
  //
  // `useSyncExternalStore` is the shape React provides for exactly this: it
  // uses the server snapshot for the hydrating render on the client too, then
  // re-renders from the client snapshot once mounted. The alternative -- an
  // effect that calls setState -- reaches the same place through an extra
  // render React cannot see coming.
  const stored = useSyncExternalStore(
    subscribeToSelection,
    getSelectionSnapshot,
    getServerSelectionSnapshot
  );

  const selection = stored;

  // Storage is the single source of truth, and a write is what causes a
  // render. No local copy of the selection exists to fall out of step with
  // it: the switcher and the gallery are both mounted on `/theme-lab`, and a
  // local copy in each would be two answers to one question.
  const setSelection = useCallback(
    (next: Selection | ((prev: Selection) => Selection)) => {
      const base = readSelection();
      writeSelection(typeof next === "function" ? next(base) : next);
    },
    []
  );

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
          // The shipped selection REMOVES the attribute rather than setting a
          // value: the generated stylesheet is keyed on `[data-theme="..."]`,
          // so no attribute is what lets the admin's own tokens resolve.
          if (selection.theme === SHIPPED_THEME) {
            if (root.dataset.theme !== undefined) delete root.dataset.theme;
          } else if (root.dataset.theme !== selection.theme) {
            root.dataset.theme = selection.theme;
          }
          if (root.dataset.density !== selection.density) {
            root.dataset.density = selection.density;
          }
        });
    };

    apply();

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

  const setTheme = useCallback(
    (theme: string) => {
      setSelection(prev => {
        // Returning to the shipped theme leaves density alone: it is a separate
        // axis, and dropping a palette override is not a reason to discard a
        // density the contributor chose.
        if (theme === SHIPPED_THEME) return { ...prev, theme };
        const nextTheme = THEMES_BY_ID.get(theme);
        if (!nextTheme) return prev;
        // Picking a theme applies its intended complete look, including its
        // recommended density -- unless the contributor has chosen a density
        // themselves, which a theme switch must not silently discard.
        //
        // Whether they have is RECORDED, not inferred. It used to be derived by
        // comparing the current density against the previous theme's
        // recommendation, and that inference had no answer for the shipped
        // sentinel, which recommends nothing: picking Sand (compact), returning
        // to shipped, then picking Calm left Calm at compact, because compact no
        // longer matched the default and so read as a deliberate choice nobody
        // had made. Passing through the resting state converted a following
        // density into a chosen one.
        const density = prev.densityChosen
          ? prev.density
          : nextTheme.recommendedDensity;

        return { ...prev, theme, density };
      });
    },
    [setSelection]
  );

  const setDensity = useCallback(
    (density: DensityId) => {
      // Choosing a density marks it chosen, which is what stops a later theme
      // switch from replacing it with that theme's recommendation.
      setSelection(prev => ({ ...prev, density, densityChosen: true }));
    },
    [setSelection]
  );

  const reset = useCallback(
    () => setSelection(DEFAULT_SELECTION),
    [setSelection]
  );

  return {
    ...selection,
    setTheme,
    setDensity,
    reset,
  };
}
