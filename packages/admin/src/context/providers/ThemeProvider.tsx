"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

/**
 * The admin's theme: light, dark, or the system's setting, saved per browser.
 *
 * The admin keeps this itself rather than through a library that writes the
 * theme onto `<html>`. `<html>` belongs to the host app's own root layout, and
 * changing it before React hydrates is a hydration mismatch in every app whose
 * layout does not opt out. Everything the admin draws sits in a `.nextly-admin`
 * container (its portal root included), so that container is the only element
 * the theme is applied to.
 */

/** The query whose answer is the system's setting. */
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** What a theme resolves to once "system" is answered. */
export type ResolvedTheme = "light" | "dark";

/** How the provider picks a theme from what was saved. */
interface ThemeConfig {
  storageKey: string;
  defaultTheme: string;
  enableSystem: boolean;
  forcedTheme?: string;
}

/** What the provider makes of a saved value. */
interface PickedTheme {
  /** The themes this provider offers. */
  offered: string[];
  /** The user's choice: the saved theme when it is offered, else the default. */
  selected: string;
  /** The theme the page shows: the forced one when set, else the selection. */
  effective: string;
}

/**
 * Reads a saved value. Kept free of closures and imports because the
 * pre-paint script runs its source text too.
 */
function pickTheme(saved: string | null, config: ThemeConfig): PickedTheme {
  const offered = config.enableSystem
    ? ["light", "dark", "system"]
    : ["light", "dark"];
  const selected =
    saved && offered.indexOf(saved) !== -1 ? saved : config.defaultTheme;
  return { offered, selected, effective: config.forcedTheme || selected };
}

/**
 * Light or dark for a theme, given the system's setting; undefined while that
 * setting is not known, as during server rendering. Self-contained, like
 * `pickTheme`, for the same reason.
 */
function resolveTheme(
  theme: string,
  systemDark: boolean | undefined
): ResolvedTheme | undefined {
  if (theme === "light" || theme === "dark") return theme;
  if (theme !== "system" || systemDark === undefined) return undefined;
  return systemDark ? "dark" : "light";
}

/**
 * Applies the saved theme to every admin container on the page. Runs as an
 * inline script before the first paint, with `pickTheme` and `resolveTheme`
 * passed in as its arguments, so the script and the React state cannot
 * disagree about what a saved value means.
 */
function paintAdmin(
  pick: typeof pickTheme,
  resolve: typeof resolveTheme,
  config: ThemeConfig,
  targets: string
): void {
  try {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(config.storageKey);
    } catch {
      saved = null;
    }
    const systemDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    const dark = resolve(pick(saved, config).effective, systemDark) === "dark";
    document.querySelectorAll(targets).forEach(element => {
      element.classList.toggle("dark", dark);
    });
  } catch {
    // A script that cannot read storage or the system setting paints
    // nothing; React applies the theme as soon as it hydrates.
  }
}

/**
 * A value as JSON that is safe inside an inline `<script>`: `<` is escaped,
 * so a string such as `</script>` in a storage key cannot end the script and
 * start markup.
 */
const scriptJson = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c");

/** The inline script's source: `paintAdmin` called with the two rules and the config. */
function paintScript(config: ThemeConfig): string {
  return `(${paintAdmin.toString()})(${pickTheme.toString()},${resolveTheme.toString()},${scriptJson(config)},${scriptJson(THEME_SYNC_TARGETS)})`;
}

/**
 * Everything showing the theme in this tab. The browser's `storage` event only
 * reaches other tabs, so a choice made here is announced here by hand.
 */
const listeners = new Set<() => void>();

/**
 * Follows changes to the system's setting. Safari before 14 gives a media
 * query only the older `addListener`, so that is used where
 * `addEventListener` is missing.
 */
function followSystem(listener: () => void): () => void {
  const system = window.matchMedia(DARK_QUERY);
  if (typeof system.addEventListener === "function") {
    system.addEventListener("change", listener);
    return () => system.removeEventListener("change", listener);
  }
  system.addListener(listener);
  return () => system.removeListener(listener);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  const stopFollowingSystem = followSystem(listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
    stopFollowingSystem();
  };
}

/**
 * Choices storage refused to keep (a private window, a full quota), by key.
 * They apply in this tab until the page reloads, ahead of whatever storage
 * still holds.
 */
const unsaved = new Map<string, string>();

function readSaved(storageKey: string): string | null {
  const kept = unsaved.get(storageKey);
  if (kept !== undefined) return kept;
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function save(storageKey: string, theme: string): void {
  try {
    window.localStorage.setItem(storageKey, theme);
    unsaved.delete(storageKey);
  } catch {
    unsaved.set(storageKey, theme);
  }
  for (const listener of listeners) listener();
}

const readSystemDark = () => window.matchMedia(DARK_QUERY).matches;
const unknownOnServer = () => undefined;
const nothingSaved = () => null;
const neverChanges = () => () => {};
const onTheClient = () => false;
const onTheServer = () => true;

/** What `useTheme` returns. */
export interface UseThemeProps {
  /** The theme in force: "light", "dark" or "system". */
  theme?: string;
  /** Saves a theme for this browser and applies it everywhere it is shown. */
  setTheme: Dispatch<SetStateAction<string>>;
  /** Light or dark, with "system" answered; undefined until it is known. */
  resolvedTheme?: ResolvedTheme;
  /** The system's setting; undefined until it is known. */
  systemTheme?: ResolvedTheme;
  /** The themes this provider offers. */
  themes: string[];
  /** The theme every page uses, when one is forced. */
  forcedTheme?: string;
}

const ThemeContext = createContext<
  UseThemeProps & { config?: ThemeConfig; nonce?: string }
>({
  setTheme: () => {},
  themes: [],
});

/** The admin's theme and the way to change it. */
export function useTheme(): UseThemeProps {
  return useContext(ThemeContext);
}

/**
 * Paints the saved theme onto the admin's containers before the first paint.
 * Render it inside a server-rendered `.nextly-admin` element: the script runs
 * as the browser parses it, so that element already exists. It is emitted
 * only by the server and kept through hydration; a later client render drops
 * it, since React never runs a script it inserts and the theme is then
 * already in React state.
 *
 * `RootLayout` renders it already. A host that puts `ThemeProvider` around
 * admin content of its own renders it first inside its `.nextly-admin`
 * element:
 *
 * ```tsx
 * <ThemeProvider>
 *   <div className="nextly-admin" suppressHydrationWarning>
 *     <ThemePaintScript />
 *     {content}
 *   </div>
 * </ThemeProvider>
 * ```
 */
export function ThemePaintScript({ nonce }: { nonce?: string }) {
  const { config, nonce: providerNonce } = useContext(ThemeContext);
  const serverOrHydrating = useSyncExternalStore(
    neverChanges,
    onTheClient,
    onTheServer
  );
  if (!config || !serverOrHydrating) return null;
  return (
    <script
      nonce={nonce ?? providerNonce}
      dangerouslySetInnerHTML={{ __html: paintScript(config) }}
    />
  );
}

/**
 * Admin containers this provider drives.
 *
 * A container can opt out with `data-theme-sync="off"`, which means "I set my
 * own light/dark class and nothing else may change it". Without the opt-out
 * there is no way to render two admin scopes in opposite modes on one page:
 * the sync applies ONE resolved mode to every `.nextly-admin` it finds, so a
 * deliberately-light element next to a deliberately-dark one collapses to
 * whichever mode the page is in. Side-by-side comparisons and any embedded
 * preview of the opposite mode need this; ordinary admin containers carry no
 * attribute and stay synchronised.
 */
export const THEME_SYNC_TARGETS = '.nextly-admin:not([data-theme-sync="off"])';

/** Whether a single element is one this provider may retheme. */
export function isThemeSyncTarget(element: Element): boolean {
  return element.matches(THEME_SYNC_TARGETS);
}

/**
 * Theme Sync Component
 *
 * Syncs the theme state with .nextly-admin container classes.
 * This allows scoped theme switching for the admin panel.
 *
 * Performance optimizations:
 * - Debounced MutationObserver (50ms) to prevent excessive DOM queries
 * - SSR safety check for document.body availability
 * - Error boundary around observer setup for graceful degradation
 * - Only observes when necessary (avoids overhead during SSR)
 */
function ThemeSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    // SSR safety check
    if (typeof window === "undefined" || !document.body) {
      return;
    }

    const isDark = resolvedTheme === "dark";
    let timeoutId: NodeJS.Timeout | null = null;

    // Apply theme to every admin container that has not opted out
    const applyTheme = () => {
      const containers = document.querySelectorAll(THEME_SYNC_TARGETS);
      containers.forEach(container => {
        container.classList.toggle("dark", isDark);
      });
    };

    // Initial application
    applyTheme();

    // Debounced handler for mutation events (50ms debounce)
    const handleMutations = (mutations: MutationRecord[]) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(() => {
        mutations.forEach(mutation => {
          mutation.addedNodes.forEach(node => {
            if (node instanceof HTMLElement && isThemeSyncTarget(node)) {
              node.classList.toggle("dark", isDark);
            }
            // Also check children of added nodes. The opt-out has to hold on
            // this path too: a preview mounted after the first pass would
            // otherwise be rethemed the moment it appears, which is the same
            // defect arriving a frame later.
            if (node instanceof HTMLElement) {
              const children = node.querySelectorAll(THEME_SYNC_TARGETS);
              children.forEach(child => {
                child.classList.toggle("dark", isDark);
              });
            }
          });
        });
        timeoutId = null;
      }, 50); // Balance between responsiveness and performance
    };

    // Watch for dynamically added .nextly-admin containers (e.g., portals)
    let observer: MutationObserver | null = null;

    try {
      observer = new MutationObserver(handleMutations);

      // Observe document body for added nodes
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    } catch (error) {
      // Graceful degradation if MutationObserver fails
      console.warn(
        "ThemeSync: MutationObserver failed to initialize. Dynamic theme changes for portals may not work.",
        error
      );
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (observer) {
        observer.disconnect();
      }
    };
  }, [resolvedTheme]);

  return null;
}

/** The ThemeProvider's settings. */
export interface ThemeProviderProps {
  children?: ReactNode;
  /** The theme until one is saved. @default "system", or "light" with `enableSystem` off */
  defaultTheme?: string;
  /** The localStorage key the choice is saved under. @default "nextly-theme" */
  storageKey?: string;
  /** Whether "system" is offered, following the system's setting. @default true */
  enableSystem?: boolean;
  /** A theme every page uses, whatever was saved. */
  forcedTheme?: string;
  /** The nonce a `script-src` Content Security Policy needs for the pre-paint script. */
  nonce?: string;
}

/**
 * Theme Provider for Nextly Admin
 *
 * Holds the admin's theme, saved in localStorage under `storageKey` and shared
 * across tabs, and applies it to every `.nextly-admin` container. It never
 * touches `<html>` or `<body>`, which belong to the host app's layout.
 *
 * **IMPORTANT**: the admin's type is supplied by the host, not by this package.
 * The consuming app is responsible for:
 * - Loading Geist and Geist Mono via next/font/google
 * - Exposing them as the `--font-geist` and `--font-geist-mono` variables
 * - Importing Nextly styles
 *
 * The theme names those variables FIRST in its font stacks and falls back to a
 * generic sans, so a host that skips this renders in the system face rather
 * than breaking. `next/font` self-hosts a face and exposes it only as a
 * variable, which is why the variable rather than the family name is what the
 * host has to provide.
 *
 * @example
 * ```tsx
 * <ThemeProvider defaultTheme="dark" storageKey="my-app-theme">
 *   {children}
 * </ThemeProvider>
 * ```
 */
export function ThemeProvider(props: ThemeProviderProps) {
  // Inside another ThemeProvider, as when a host wraps the admin's root
  // layout in its own, the outer one's settings and state hold: a second
  // store would compete with it for the same containers.
  const outer = useContext(ThemeContext);
  if (outer.config) return <>{props.children}</>;
  return <ThemeStore {...props} />;
}

function ThemeStore({
  children,
  enableSystem = true,
  // With system mode off, "system" is not a theme this provider offers.
  defaultTheme = enableSystem ? "system" : "light",
  storageKey = "nextly-theme",
  forcedTheme,
  nonce,
}: ThemeProviderProps) {
  const saved = useSyncExternalStore(
    subscribe,
    () => readSaved(storageKey),
    nothingSaved
  );
  const systemDark = useSyncExternalStore(
    subscribe,
    readSystemDark,
    unknownOnServer
  );
  const config = useMemo<ThemeConfig>(
    () => ({ storageKey, defaultTheme, enableSystem, forcedTheme }),
    [storageKey, defaultTheme, enableSystem, forcedTheme]
  );
  const picked = useMemo(() => pickTheme(saved, config), [saved, config]);
  // A functional update reads the store's latest choice, not this render's,
  // so two updates in a row compose as React's own setters do.
  const setTheme = useCallback<Dispatch<SetStateAction<string>>>(
    next =>
      save(
        storageKey,
        typeof next === "function"
          ? next(pickTheme(readSaved(storageKey), config).selected)
          : next
      ),
    [storageKey, config]
  );
  const value = useMemo(
    () => ({
      theme: picked.selected,
      setTheme,
      resolvedTheme: resolveTheme(picked.effective, systemDark),
      systemTheme: enableSystem
        ? resolveTheme("system", systemDark)
        : undefined,
      themes: picked.offered,
      forcedTheme,
      config,
      nonce,
    }),
    [picked, setTheme, systemDark, enableSystem, forcedTheme, config, nonce]
  );
  return (
    <ThemeContext.Provider value={value}>
      <ThemeSync />
      {children}
    </ThemeContext.Provider>
  );
}
