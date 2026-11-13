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
  useLayoutEffect,
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

/**
 * Marks what a page draws in a place while the page itself is still on its way
 * (an editor's outline), on the stand-in's own root element.
 *
 * The bar's `end` place takes its width from what is left of the bar after the
 * `start` part, so its box begins where the page's trail ends, and a trail that
 * arrives with the page would move it. While a place holds only a stand-in it
 * draws no box of its own (`STAND_IN_PLACE`), and the stand-in lays itself out
 * in the bar directly, from the bar's right end: the place's box first appears
 * with the page, beside the trail that came with it, and nothing on screen is
 * pushed along.
 */
export const STAND_IN_ATTRIBUTE = "data-top-bar-stand-in";

/**
 * The classes a place's element takes so that, holding a stand-in, it has no
 * box (`display: contents`). Written out in full, as Tailwind reads class names
 * from the source text, and kept beside {@link STAND_IN_ATTRIBUTE}, which it
 * names.
 */
export const STAND_IN_PLACE = "has-[>[data-top-bar-stand-in]]:contents";

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

/**
 * The width of the bar itself, in pixels, while it is drawn; `null` outside the
 * shell or before it has been measured. Unlike a place's, it does not follow
 * what the page draws, such as how long its trail is.
 */
export function useTopBarWidth(): number | null {
  const places = useContext(TopBarPlacesContext);
  const end = places?.targets.end ?? null;
  return useMeasuredWidth(end?.closest("header") ?? null);
}

/**
 * `element`'s width, again whenever it changes. Measured in a layout effect,
 * before the browser paints, so what a page decides from it is already decided
 * in the first frame drawn, never one frame late.
 */
function useMeasuredWidth(element: Element | null): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (element === null || typeof ResizeObserver === "undefined") {
      setWidth(null);
      return;
    }
    // A width of 0 is an element not laid out yet, not a narrow one.
    const measured = (width: number) => (width > 0 ? width : null);
    setWidth(measured(element.getBoundingClientRect().width));
    const observer = new ResizeObserver(entries => {
      const entry = entries.at(-1);
      if (entry) setWidth(measured(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return width;
}

/** Whether the shell's bar is there to be drawn into. */
export function useInTopBar(): boolean {
  return useContext(TopBarPlacesContext) !== null;
}
