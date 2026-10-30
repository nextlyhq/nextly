"use client";

/**
 * What the dashboard's header needs from its grid, handed across the page.
 *
 * The header sits above the grid and holds the page's Customize, its freshness
 * line and the summary's links to cards, while the arrangement, the cards'
 * answers and focus all live in the grid. The page holds this provider; the
 * grid publishes to it, and the header reads it.
 *
 * What the grid publishes is plain values, set only when one of them changes,
 * so a publish never renders the page into another publish. Its actions are
 * called through the latest the grid handed, so they never go stale and never
 * change identity.
 *
 * @module components/features/dashboard/header/dashboard-chrome
 */

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";

/** A ref callback that registers an element as a place focus can be sent. */
type Register = (element: HTMLElement | null) => void;

/** What the grid tells the header. */
export interface DashboardChromeState {
  /** Whether the reader may customise: the grid draws an arrangement of theirs. */
  customizable: boolean;
  /** Whether customise mode is open: its bar then holds the controls. */
  editing: boolean;
  /** Whether a layout write is in flight, which beginning an edit waits for. */
  writing: boolean;
  /** When the oldest answer a card shows arrived, in milliseconds, or none yet. */
  oldestAnswerAt: number | null;
  /** Each widget's cards on the dashboard, their placement ids in its order, by widget id. */
  cards: Readonly<Record<string, readonly string[]>>;
}

/** What the grid does for the header. */
export interface DashboardChromeActions {
  /** Open customise mode. */
  begin: () => void;
  /** Ask every card again. */
  refresh: () => void;
  /** Registers Customize, where focus returns as customise mode closes. */
  customizeRef: Register;
}

export type DashboardChrome = DashboardChromeState & DashboardChromeActions;

interface ChromeChannel {
  state: DashboardChromeState | null;
  setState: (state: DashboardChromeState | null) => void;
  latest: { current: DashboardChromeActions | null };
  actions: DashboardChromeActions;
}

const ChromeContext = createContext<ChromeChannel | null>(null);

export function DashboardChromeProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [state, setState] = useState<DashboardChromeState | null>(null);
  const latest = useRef<DashboardChromeActions | null>(null);
  // Stable for the page's life: each calls whatever the grid last handed.
  const actions = useMemo<DashboardChromeActions>(
    () => ({
      begin: () => latest.current?.begin(),
      refresh: () => latest.current?.refresh(),
      customizeRef: element => latest.current?.customizeRef(element),
    }),
    []
  );
  const channel = useMemo(
    () => ({ state, setState, latest, actions }),
    [state, actions]
  );
  return (
    <ChromeContext.Provider value={channel}>{children}</ChromeContext.Provider>
  );
}

/**
 * The grid's side: hands the header its state and actions. Outside a provider
 * (the grid drawn on its own) it hands nothing.
 */
export function usePublishDashboardChrome(
  state: DashboardChromeState,
  actions: DashboardChromeActions
): void {
  const channel = useContext(ChromeContext);
  // The latest actions, before the state that lets the header draw a control
  // calling them.
  useLayoutEffect(() => {
    if (channel !== null) channel.latest.current = actions;
  });
  // Compared by value: a new object with the same values publishes nothing.
  const published = JSON.stringify(state);
  const setState = channel?.setState;
  useLayoutEffect(() => {
    setState?.(JSON.parse(published) as DashboardChromeState);
  }, [setState, published]);
  // A grid taken off the page takes its controls with it.
  useLayoutEffect(() => () => setState?.(null), [setState]);
}

/** The header's side: what the grid published, or none until it has. */
export function useDashboardChrome(): DashboardChrome | null {
  const channel = useContext(ChromeContext);
  if (channel === null || channel.state === null) return null;
  return { ...channel.state, ...channel.actions };
}
