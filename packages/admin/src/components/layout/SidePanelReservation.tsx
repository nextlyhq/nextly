"use client";

import React from "react";

import { useMountRegistry } from "./lib/mount-registry";
import {
  resolveReservedInlineEnd,
  type SidePanelReservation,
} from "./lib/side-panel-reservation";

interface SidePanelReservationContextValue {
  reserved: number;
  register: (reservation: SidePanelReservation) => () => void;
}

/**
 * Defaults to reserving nothing and accepting registrations that do nothing.
 *
 * A panel rendered outside the dashboard layout — a test, a standalone route,
 * Storybook — then calls the hook harmlessly instead of throwing, which is the
 * same bargain `ChromeSuppression` makes and for the same reason: the
 * alternative is every call site guarding the call.
 */
const SidePanelReservationContext =
  React.createContext<SidePanelReservationContextValue>({
    reserved: 0,
    register: () => () => {},
  });

/**
 * Holds what the currently mounted panels have asked to be kept clear.
 *
 * Above the chrome AND above the page, because the panel that makes the claim
 * is rendered deep inside the page while the element that has to honour it is
 * the layout's own content column. React data flows down, so the claim has to
 * be lifted past both.
 */
export function SidePanelReservationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { entries: reservations, register } =
    useMountRegistry<SidePanelReservation>();

  const value = React.useMemo<SidePanelReservationContextValue>(
    () => ({ reserved: resolveReservedInlineEnd(reservations), register }),
    [reservations, register]
  );

  return (
    <SidePanelReservationContext.Provider value={value}>
      {children}
    </SidePanelReservationContext.Provider>
  );
}

/** The width the layout must keep clear right now. For the layout itself. */
export function useReservedInlineEnd(): number {
  return React.useContext(SidePanelReservationContext).reserved;
}

/**
 * Ask the layout to keep `width` pixels of its inline end clear.
 *
 * Pass `null` when the panel is closed, or when it is covering the page
 * deliberately: a panel with nowhere to be put beside the content is a modal
 * drawer, and a modal one needs no reservation because it blocks interaction
 * outright rather than silently swallowing it.
 *
 * Mount-scoped, so navigating away releases the claim with nothing to undo.
 */
export function useReserveSidePanel(width: number | null): void {
  const { register } = React.useContext(SidePanelReservationContext);

  /*
   * A LAYOUT effect on the client, because the space this reserves is missing
   * until the claim lands. In a passive effect the first frame paints the page
   * at full width under the panel — the very overlap being prevented — and the
   * correction lands a frame later as a visible shift of the whole column.
   */
  useRegistrationEffect(() => {
    if (width === null) return;
    return register({ width });
  }, [width, register]);
}

/**
 * Falls back to a passive effect where there is no DOM: a layout effect during
 * a server render warns and cannot run, and nothing has painted there anyway.
 */
const useRegistrationEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;
