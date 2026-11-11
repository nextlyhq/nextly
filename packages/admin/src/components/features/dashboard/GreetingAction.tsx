"use client";

/**
 * The one place at the right end of the dashboard's greeting row, which the
 * widget grid fills with its cog, "Customize dashboard".
 *
 * The greeting and the grid are separate parts of the dashboard's place, and
 * a plugin's block may stand between them, so the grid cannot draw beside the
 * greeting in its own tree. It renders the cog where it renders everything
 * else, keeping its state and context, and the cog is drawn into the row.
 *
 * Where the page has no greeting row, the action is drawn where its owner
 * says instead (`withoutRow`), by default where it stands: outside the
 * dashboard page (a grid rendered on its own, as a test does), and on a page
 * whose greeting a plugin replaced, which draws no row.
 *
 * @module components/features/dashboard/GreetingAction
 */
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface GreetingActionValue {
  /** The row's element, once the greeting has mounted. */
  target: HTMLElement | null;
  setTarget: (element: HTMLElement | null) => void;
  /**
   * Whether the page's first commit is done. A greeting there has set the
   * target by then, so a target still missing means the page has no row.
   */
  settled: boolean;
}

const GreetingActionContext = createContext<GreetingActionValue | null>(null);

/** Holds the row's place, above both the greeting and the grid. */
export function GreetingActionProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [settled, setSettled] = useState(false);
  // A parent's layout effect runs after its children's refs are set, in the
  // same commit, so the row (if any) has set the target before this. Both
  // updates land in one render before the first paint.
  useLayoutEffect(() => setSettled(true), []);
  const value = useMemo(
    () => ({ target, setTarget, settled }),
    [target, settled]
  );
  return (
    <GreetingActionContext.Provider value={value}>
      {children}
    </GreetingActionContext.Provider>
  );
}

/**
 * Draw `children` at the greeting row's right end for as long as this is
 * mounted. Where the page has no row, draws them through `withoutRow`, by
 * default here.
 */
export function GreetingAction({
  children,
  withoutRow = action => action,
}: {
  children: ReactNode;
  /** Where the action goes on a page with no greeting row. */
  withoutRow?: (action: ReactNode) => ReactNode;
}): ReactNode {
  const place = useContext(GreetingActionContext);
  if (place?.target) return createPortal(children, place.target);
  // Nothing until the page's first commit is done: the greeting sets the
  // place in that commit, before the first paint.
  if (place !== null && !place.settled) return null;
  return withoutRow(children);
}

/** The element the action is drawn into, rendered by the greeting row. */
export function GreetingActionTarget(): JSX.Element {
  const setTarget = useContext(GreetingActionContext)?.setTarget;
  return (
    <div
      ref={setTarget}
      data-testid="dashboard-greeting-action"
      className="flex shrink-0 items-center"
    />
  );
}
