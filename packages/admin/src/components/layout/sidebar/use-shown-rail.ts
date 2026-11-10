"use client";

/**
 * What the icon rail draws while the answers that decide it arrive.
 *
 * The entries shown, up to the first one whose answer has not arrived: an
 * entry arriving later then lands below every entry already drawn instead of
 * pushing them down. "+ New" heads the rail, so the entries wait for its answer
 * too (`railBehindNewMenu`). And whether every answer is in, which the rail
 * marks for a reader of the page.
 *
 * @module components/layout/sidebar/use-shown-rail
 */
import { useMemo } from "react";

import {
  railAnswersIn,
  railAnswersPending,
  railBehindNewMenu,
  settledRailItems,
} from "./lib/settled-rail";
import { useRailNewMenu, type RailNewMenuState } from "./RailNewMenu";
import type { MainMenuItem } from "./sidebar-types";

export interface ShownRailInputs<Item extends MainMenuItem> {
  items: readonly Item[];
  isShown: (item: Item) => boolean;
  workspacePending: boolean;
  hydrated: boolean;
  permissionsLoading: boolean;
  contentAnswerPending: boolean;
  collectionsLoading: boolean;
  singlesLoading: boolean;
  /** On a phone the drawer draws "+ New" itself, so the rail does not wait. */
  onPhone?: boolean;
}

export function useShownRail<Item extends MainMenuItem>({
  items,
  isShown,
  workspacePending,
  hydrated,
  permissionsLoading,
  contentAnswerPending,
  collectionsLoading,
  singlesLoading,
  onPhone,
}: ShownRailInputs<Item>): {
  rail: { items: readonly Item[]; settled: boolean };
  newMenu: RailNewMenuState;
} {
  const newMenu = useRailNewMenu();
  const rail = useMemo(() => {
    const pending = railAnswersPending({
      workspacePending,
      hydrated,
      permissionsLoading,
      contentAnswerPending,
      collectionsLoading,
      singlesLoading,
    });
    return {
      items: settledRailItems(items, isShown, pending),
      settled: railAnswersIn(pending),
    };
  }, [
    items,
    isShown,
    workspacePending,
    hydrated,
    permissionsLoading,
    contentAnswerPending,
    collectionsLoading,
    singlesLoading,
  ]);
  return { rail: railBehindNewMenu(rail, newMenu, onPhone), newMenu };
}
