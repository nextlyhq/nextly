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

import type { Provider, JSX } from "react";
import { createContext, useContext, useId } from "react";

import { SegmentedChoice } from "@admin/components/ui/segmented-choice";
import { useDashboardUser } from "@admin/hooks/useDashboardUser";
import { usePersistedState } from "@admin/hooks/usePersistedState";
import type { FieldDiff } from "@admin/services/versionApi";

import { resolveFieldDiff } from "./field-diff-registry";

export type ChangesLayout = "inline" | "split";

const ChangesLayoutContext = createContext<ChangesLayout>("inline");

/** Sets the layout every field change below it is drawn in. */
export const ChangesLayoutProvider: Provider<ChangesLayout> =
  ChangesLayoutContext.Provider;

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

/**
 * Whether a change is drawn differently side by side: a changed text or value,
 * or a group or list holding one. A relationship's added and removed targets,
 * a withheld or unknown field, and any kind a registered renderer draws (rich
 * text, JSON and code) are drawn one way only.
 */
export function honoursSideBySide(node: FieldDiff): boolean {
  if (node.status === "unchanged" || resolveFieldDiff(node.kind)) return false;
  switch (node.kind) {
    case "text":
    case "value":
      return true;
    case "group":
      return node.fields.some(honoursSideBySide);
    case "list":
      return node.items.some(item => item.fields.some(honoursSideBySide));
    default:
      return false;
  }
}

/**
 * The layout a comparison is drawn in: the reader's choice where any of its
 * changes has a side-by-side view, else inline, so no column headings stand
 * over changes drawn in one run.
 */
export function layoutFor(
  preference: ChangesLayout,
  changes: Iterable<FieldDiff>
): { layout: ChangesLayout; splittable: boolean } {
  const splittable = [...changes].some(honoursSideBySide);
  return { layout: splittable ? preference : "inline", splittable };
}

/** Why side by side cannot be chosen, said to everyone who reaches it. */
const NO_SPLIT_REASON = "This comparison has no side-by-side view";

/** The two layouts, as the choice names them. */
const LAYOUT_OPTIONS = [
  { value: "inline", label: "Inline" },
  { value: "split", label: "Side by side" },
] as const;

/**
 * How changes are shown: Inline or Side by side, both in view as one choice,
 * so the one not chosen is a press away and the chosen one reads as chosen.
 * For a comparison none of whose changes has a side-by-side view, Side by side
 * cannot be chosen, with the reason, and Inline, which is what is drawn, reads
 * as chosen: a choice that changed nothing would read as broken.
 */
export function ChangesLayoutToggle({
  layout,
  onChange,
  splittable = true,
}: {
  layout: ChangesLayout;
  onChange: (next: ChangesLayout) => void;
  splittable?: boolean;
}): JSX.Element {
  const reasonId = useId();
  const drawn: ChangesLayout = splittable ? layout : "inline";
  return (
    <>
      <SegmentedChoice
        aria-label="How changes are shown"
        options={LAYOUT_OPTIONS.map(option =>
          option.value === "split" && !splittable
            ? { ...option, disabled: true }
            : option
        )}
        value={drawn}
        onSelect={next => {
          if (isChangesLayout(next)) onChange(next);
        }}
        title={splittable ? undefined : NO_SPLIT_REASON}
        aria-describedby={splittable ? undefined : reasonId}
      />
      {splittable ? null : (
        <span id={reasonId} className="sr-only">
          {NO_SPLIT_REASON}
        </span>
      )}
    </>
  );
}
