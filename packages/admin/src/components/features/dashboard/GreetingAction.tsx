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
 * Outside the dashboard page (a grid rendered on its own, as a test does)
 * there is no row, and the action draws where it stands.
 *
 * @module components/features/dashboard/GreetingAction
 */
import {
  createContext,
  useContext,
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
}

const GreetingActionContext = createContext<GreetingActionValue | null>(null);

/** Holds the row's place, above both the greeting and the grid. */
export function GreetingActionProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ target, setTarget }), [target]);
  return (
    <GreetingActionContext.Provider value={value}>
      {children}
    </GreetingActionContext.Provider>
  );
}

/**
 * Draw `children` at the greeting row's right end for as long as this is
 * mounted. Outside a provider, draws them here instead.
 */
export function GreetingAction({
  children,
}: {
  children: ReactNode;
}): JSX.Element | null {
  const place = useContext(GreetingActionContext);
  if (place === null) return <>{children}</>;
  // The greeting sets the place while it mounts, in the same commit as the
  // grid, so this re-renders into it before the first paint.
  return place.target === null ? null : createPortal(children, place.target);
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
