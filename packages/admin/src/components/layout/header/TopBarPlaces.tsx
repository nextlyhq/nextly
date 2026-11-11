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
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/** The bar's two places: its left part and its right part. */
export type TopBarPlaceName = "start" | "end";

interface TopBarPlacesValue {
  /** The bar's element for each place, once the bar has mounted. */
  targets: Readonly<Record<TopBarPlaceName, HTMLElement | null>>;
  setTarget: (name: TopBarPlaceName, element: HTMLElement | null) => void;
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
  const value = useMemo(() => ({ targets, setTarget }), [targets, setTarget]);
  return (
    <TopBarPlacesContext.Provider value={value}>
      {children}
    </TopBarPlacesContext.Provider>
  );
}

/** What a page hands one of the bar's places. */
export interface TopBarPlaceProps {
  /** `start`, the bar's left part, or `end`, its right part. */
  name: TopBarPlaceName;
  /** Drawn in the bar, inside the page's own tree and context. */
  children: ReactNode;
}

/**
 * Draw `children` into the bar's `name` place for as long as this is mounted.
 * Outside the shell, draws them here instead.
 */
export function TopBarPlace({
  name,
  children,
}: TopBarPlaceProps): JSX.Element | null {
  const places = useContext(TopBarPlacesContext);
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

/** Whether the shell's bar is there to be drawn into. */
export function useInTopBar(): boolean {
  return useContext(TopBarPlacesContext) !== null;
}
