"use client";

/**
 * Where the document's status pill is drawn: beside the title while the title
 * is on screen, and in the sticky document bar once it has scrolled away, so
 * the status is always in sight and never on screen twice.
 *
 * The title block and the bar are siblings, so the editor holds the one
 * answer for both: the title block reports whether it carries the pill and
 * whether it is in view, and the bar draws its pill only when the title's is
 * not seen. A bar with no such editor above it (a Single's, which draws no
 * pill by its title) keeps its pill.
 *
 * @module components/features/entries/EntryForm/title-in-view
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from "react";

interface TitlePillState {
  /** Whether the title block is drawing the pill beside the title. */
  titleCarriesPill: boolean;
  /** Whether that title is in view, below the sticky bar. */
  titleInView: boolean;
  report: (next: { carriesPill: boolean; inView: boolean }) => void;
}

const TitlePillContext = createContext<TitlePillState | null>(null);

/** Holds where the pill is drawn, for the title block and bar inside it. */
export function TitlePillProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [state, setState] = useState({ carriesPill: false, inView: true });
  const report = useCallback(
    (next: { carriesPill: boolean; inView: boolean }) =>
      setState(current =>
        current.carriesPill === next.carriesPill &&
        current.inView === next.inView
          ? current
          : next
      ),
    []
  );
  const value = useMemo(
    () => ({
      titleCarriesPill: state.carriesPill,
      titleInView: state.inView,
      report,
    }),
    [state, report]
  );
  return (
    <TitlePillContext.Provider value={value}>
      {children}
    </TitlePillContext.Provider>
  );
}

/** Whether the bar draws the pill: unless the title's own pill is in view. */
export function useBarShowsPill(): boolean {
  const state = useContext(TitlePillContext);
  if (!state) return true;
  return !(state.titleCarriesPill && state.titleInView);
}

/** Whether the title block draws the pill: only under a provider. */
export function useTitleMayCarryPill(): boolean {
  return useContext(TitlePillContext) !== null;
}

/**
 * The sticky bar's height, as the editor's frame publishes it; before the bar
 * has measured itself, its one-row height, as the panel under it reads it.
 */
function barHeight(element: HTMLElement): number {
  const height = Number.parseFloat(
    getComputedStyle(element).getPropertyValue("--document-bar-height")
  );
  return Number.isFinite(height) ? height : ONE_ROW_BAR_HEIGHT;
}

/** The bar's height in one row (3.25rem), in pixels. */
const ONE_ROW_BAR_HEIGHT = 52;

/**
 * A ref for the title row: reports, while `carriesPill`, whether the row is in
 * view below the sticky bar. Where the browser has no IntersectionObserver the
 * row counts as in view, which keeps the one pill beside the title.
 */
export function useTitlePillRef(
  carriesPill: boolean
): (element: HTMLElement | null) => void {
  const state = useContext(TitlePillContext);
  const report = state?.report;
  const [element, setElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!report) return;
    if (!carriesPill || !element) {
      report({ carriesPill: false, inView: true });
      return;
    }
    report({ carriesPill: true, inView: true });
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      entries => {
        const entry = entries.at(-1);
        if (entry) report({ carriesPill: true, inView: entry.isIntersecting });
      },
      // The bar sticks over the top of the scroll area, so a title under it
      // is out of view.
      { rootMargin: `-${barHeight(element)}px 0px 0px 0px` }
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      report({ carriesPill: false, inView: true });
    };
  }, [carriesPill, element, report]);

  return setElement;
}
