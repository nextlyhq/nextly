"use client";

/**
 * The top bar's two places, which the page on screen fills.
 *
 * The shell draws the admin's only bar. A page puts what belongs in it there
 * rather than drawing a bar of its own: its breadcrumb in the `start` place, at
 * the bar's left, and its own actions in the `end` place, at its right. The
 * page renders them where it renders everything else, inside its own tree, so
 * they keep the page's state and context; they are drawn into the bar.
 *
 * Outside the shell (a page rendered on its own, as a test does) there is no
 * bar, and a place draws what it was given where it stands.
 *
 * @module components/layout/header/TopBarPlaces
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { useMountRegistry } from "../lib/mount-registry";

/** The bar's two places: its left part and its right part. */
export type TopBarPlaceName = "start" | "end";

interface TopBarPlacesValue {
  /** The bar's element for each place, once the bar has mounted. */
  targets: Readonly<Record<TopBarPlaceName, HTMLElement | null>>;
  setTarget: (name: TopBarPlaceName, element: HTMLElement | null) => void;
  /** The places something is drawn into right now, one entry per drawer. */
  filled: readonly TopBarPlaceName[];
  register: (name: TopBarPlaceName) => () => void;
}

const TopBarPlacesContext = createContext<TopBarPlacesValue | null>(null);

/**
 * Holds the bar's places. Above both the bar and the page, as the page that
 * fills a place is the bar's sibling.
 */
export function TopBarPlacesProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [targets, setTargets] = useState<
    Record<TopBarPlaceName, HTMLElement | null>
  >({ start: null, end: null });
  const setTarget = useCallback(
    (name: TopBarPlaceName, element: HTMLElement | null) =>
      setTargets(current =>
        current[name] === element ? current : { ...current, [name]: element }
      ),
    []
  );
  const { entries, register: add } = useMountRegistry<{
    name: TopBarPlaceName;
  }>();
  // A fresh object per drawer, so two drawers in one place are two entries.
  const register = useCallback(
    (name: TopBarPlaceName) => add({ name }),
    [add]
  );
  const filled = useMemo(() => entries.map(entry => entry.name), [entries]);
  const value = useMemo(
    () => ({ targets, setTarget, filled, register }),
    [targets, setTarget, filled, register]
  );
  return (
    <TopBarPlacesContext.Provider value={value}>
      {children}
    </TopBarPlacesContext.Provider>
  );
}

/**
 * A layout effect on the client, so a place is filled, and the bar knows it,
 * before the first paint; a passive one where there is no DOM.
 */
const useRegistrationEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Draw `children` into the bar's `name` place for as long as this is mounted.
 * Outside the shell, draws them here instead.
 */
export function TopBarPlace({
  name,
  children,
}: {
  name: TopBarPlaceName;
  children: ReactNode;
}): JSX.Element | null {
  const places = useContext(TopBarPlacesContext);
  const register = places?.register;
  useRegistrationEffect(() => register?.(name), [register, name]);
  if (places === null) return <>{children}</>;
  const target = places.targets[name];
  // The bar sets its places while it mounts, in the same commit as the page,
  // so this re-renders into it before the first paint.
  return target === null ? null : createPortal(children, target);
}

/** The element a place is drawn into, rendered by the bar. */
export function TopBarPlaceTarget({
  name,
  className,
}: {
  name: TopBarPlaceName;
  className?: string;
}): JSX.Element {
  const places = useContext(TopBarPlacesContext);
  const setTarget = places?.setTarget;
  const ref = useCallback(
    (element: HTMLElement | null) => setTarget?.(name, element),
    [setTarget, name]
  );
  return <div ref={ref} data-top-bar-place={name} className={className} />;
}

/** Whether the page on screen draws anything into the bar's places. */
export function useTopBarPlacesFilled(): boolean {
  const places = useContext(TopBarPlacesContext);
  return (places?.filled.length ?? 0) > 0;
}

/** Whether the shell's bar is there to be drawn into. */
export function useInTopBar(): boolean {
  return useContext(TopBarPlacesContext) !== null;
}
