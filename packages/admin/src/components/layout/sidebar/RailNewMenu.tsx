"use client";

/**
 * "+ New" at the head of the icon rail.
 *
 * It is the rail's first entry, so the entries below it wait for its answer
 * (what the reader may create) as they wait for each other's
 * (`railBehindNewMenu`): drawn before it, they would move when it arrived or,
 * where the reader may create nothing, when it was taken away. The phone's
 * drawer draws it as its own row above the rail instead, so there the rail
 * neither draws it nor waits on it.
 *
 * @module components/layout/sidebar/RailNewMenu
 */
import type { JSX } from "react";

import {
  NewMenuView,
  useNewMenuTypes,
} from "@admin/components/features/new-menu/NewMenu";

/** What the reader may create, and whether that is known yet. */
export type RailNewMenuState = ReturnType<typeof useNewMenuTypes>;

/** "+ New"'s answer, read once for the rail and its button. */
export const useRailNewMenu: () => RailNewMenuState = useNewMenuTypes;

/**
 * The button, once it is known what the reader may create; nothing where they
 * may create nothing, and nothing on a phone, where the drawer draws it.
 */
export function RailNewMenu({
  onPhone,
  state,
}: {
  onPhone?: boolean;
  state: RailNewMenuState;
}): JSX.Element | null {
  if (onPhone === true || !state.isReady) return null;
  return (
    <NewMenuView
      variant="rail"
      types={state.types}
      isReady
      className="shrink-0"
    />
  );
}
