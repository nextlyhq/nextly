"use client";

/**
 * How a comparison lays out a field's change: inline, as tracked changes in
 * one run (removed struck through, added underlined, each in colour), or side
 * by side, the two versions in columns.
 *
 * Inline is the default because a reader asks what changed, and one run with
 * the change marked in place answers that without matching two columns by eye.
 * Side by side is a choice each person makes and keeps: it is remembered for
 * the signed-in person, on this browser, as every other remembered choice in
 * the admin is.
 *
 * @module components/features/versions/diff/changes-layout
 */

import { Columns2 } from "lucide-react";
import { createContext, useContext } from "react";

import { Button } from "@admin/components/ui";
import { useDashboardUser } from "@admin/hooks/useDashboardUser";
import { usePersistedState } from "@admin/hooks/usePersistedState";

export type ChangesLayout = "inline" | "split";

const ChangesLayoutContext = createContext<ChangesLayout>("inline");

/** Sets the layout every field change below it is drawn in. */
export const ChangesLayoutProvider = ChangesLayoutContext.Provider;

/** The layout a field change is drawn in: inline unless a surface says so. */
export function useChangesLayout(): ChangesLayout {
  return useContext(ChangesLayoutContext);
}

function isChangesLayout(value: string): value is ChangesLayout {
  return value === "inline" || value === "split";
}

/**
 * The signed-in person's chosen layout, and the way to change it. Keyed by
 * their id, so two people sharing a browser keep their own choice.
 */
export function useChangesLayoutPreference(): [
  ChangesLayout,
  (next: ChangesLayout) => void,
] {
  const { user } = useDashboardUser();
  return usePersistedState(
    `nextly:admin:history-changes-layout:${user?.id ?? "signed-out"}`,
    "inline",
    isChangesLayout
  );
}

/** The side-by-side toggle, pressed while the two versions are in columns. */
export function ChangesLayoutToggle({
  layout,
  onChange,
}: {
  layout: ChangesLayout;
  onChange: (next: ChangesLayout) => void;
}) {
  const split = layout === "split";
  return (
    <Button
      type="button"
      variant={split ? "default" : "outline"}
      size="sm"
      aria-pressed={split}
      onClick={() => onChange(split ? "inline" : "split")}
    >
      <Columns2 className="h-4 w-4" aria-hidden="true" />
      Side by side
    </Button>
  );
}
