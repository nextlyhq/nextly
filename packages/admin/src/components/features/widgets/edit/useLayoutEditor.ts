"use client";

/**
 * The arrangement a reader is customising, and the one write that commits it.
 *
 * ## Why customise mode batches instead of saving each gesture
 *
 * Every write is guarded twice — by `version`, which catches another tab, and
 * by `scope`, which catches the visible widget set moving underneath the
 * snapshot in hand. Both refuse with a 409 whose only remedy is to re-read, and
 * re-reading DISCARDS whatever is in progress. Saving on every move would
 * therefore turn each gesture into its own chance to lose the arrangement.
 *
 * So the editor holds a draft — the ordered list as read, plus the reader's
 * staged changes — every gesture edits that, and Save commits it in one PUT.
 * Cancel throws it away and the dashboard is the one that was opened.
 *
 * @module components/features/widgets/edit/useLayoutEditor
 */

import { MAX_PLACEMENTS } from "nextly/config";
import { useCallback, useMemo, useState } from "react";

import type { UseDashboardLayoutResult } from "@admin/hooks/queries/useDashboardLayout";
import type {
  WidgetPlacement,
  WidgetWidthFacts,
} from "@admin/types/dashboard/widgets";

import {
  addedPlacementId,
  addPlacement,
  hasChanges,
  type IsDrawn,
} from "../layout-editor";

import { useLayoutLifecycle, type LayoutLifecycle } from "./useLayoutLifecycle";
import {
  usePlacementMutations,
  type PlacementMutations,
} from "./usePlacementMutations";

export interface LayoutEditor extends PlacementMutations, LayoutLifecycle {
  /** Whether the reader is customising. Cards are only manipulable while true. */
  isEditing: boolean;
  /** The list to DRAW from — the draft while customising, else the server's. */
  placements: WidgetPlacement[];
  /**
   * Widget ids the add panel offers as NEW cards: ones this reader may see that
   * are not in the draft, and ones that allow several cards.
   */
  available: string[];
  /** The widths each widget allows, as the server answered them. */
  factsFor: (widgetId: string) => WidgetWidthFacts | undefined;
  /**
   * Whether the list already holds as many cards as a write may carry.
   *
   * 🔴 Exposed rather than left for the add panel to compute, and refused in
   * {@link LayoutEditor.add} rather than only rendered: a draft past the limit
   * is one the server was always going to refuse.
   */
  atCapacity: boolean;
  hasUnsavedChanges: boolean;
  /** Whether the draft holds a staged reset to the default dashboard. */
  isResetStaged: boolean;
  isSaving: boolean;
  /**
   * Whether any write against this layout is in flight, including one this
   * editor did not start. What the controls are DISABLED on.
   */
  isWriting: boolean;
  /**
   * Whether the last commit lost a race, on either guard. The recovery is one
   * action for both causes: re-read, which necessarily discards the draft.
   */
  isConflict: boolean;
  /**
   * The remedy a conflict offers: take the server's arrangement, discard this
   * one.
   *
   * 🔴 THREE pieces of state, because a conflict is three and clearing one
   * leaves the other two contradicting the reader: the draft (which would
   * otherwise keep being drawn over the refetched arrangement), the failed
   * mutations (which keep the alert up), and the query.
   */
  reload: () => void;
  /**
   * Append a new card of this widget, at its default width. Answers the new card's id, so it
   * can be highlighted and focused, or `null` when nothing was added: not customising, or the
   * dashboard already holds as many cards as it can.
   */
  add: (widgetId: string, settings?: Record<string, unknown>) => string | null;
}

/**
 * An arrangement being edited, and the guards it is a modification of.
 *
 * One object, so a list can never be sent against a version and a scope it was
 * not derived from.
 */
export interface LayoutDraft {
  placements: WidgetPlacement[];
  version: number;
  scope: string;
  /**
   * The default list a staged reset put in the draft, or `null`.
   *
   * Kept so Save can tell an untouched staged reset (which is the saved RESET,
   * a delete) from a default the reader went on to change (which is their own
   * arrangement now, and a write).
   */
  stagedReset: WidgetPlacement[] | null;
}

/**
 * The widgets the add panel may offer as new cards, against the DRAFT.
 *
 * Every widget the read says this reader may see, the server's own `available`
 * order first: a widget not in the draft, or one that allows several cards.
 * Asked of the draft rather than taken from `available` alone, because a card
 * added a moment ago is placed now, and a staged reset can take out a widget
 * the server counted as placed when it answered.
 */
function offerable(
  draft: readonly WidgetPlacement[],
  served: readonly string[],
  widgets: Readonly<Record<string, WidgetWidthFacts>>
): string[] {
  const placed = new Set(draft.map(placement => placement.widgetId));
  return [...new Set([...served, ...Object.keys(widgets)])].filter(widgetId =>
    Object.hasOwn(widgets, widgetId)
      ? widgets[widgetId].allowsSeveral || !placed.has(widgetId)
      : // A served id the width map does not describe is still the server's
        // answer to "may add": kept while unplaced, as it always was.
        !placed.has(widgetId)
  );
}

export function useLayoutEditor(
  layout: UseDashboardLayoutResult,
  isDrawn: IsDrawn
): LayoutEditor {
  // `null` means "not customising" and a draft means "customising", so the two
  // facts cannot disagree the way a separate boolean and an array would.
  const [draft, setDraft] = useState<LayoutDraft | null>(null);

  const server = useMemo(
    () => layout.layout?.placements ?? [],
    [layout.layout]
  );
  const widgets = useMemo(() => layout.layout?.widgets ?? {}, [layout.layout]);

  const factsFor = useCallback(
    (widgetId: string) =>
      Object.hasOwn(widgets, widgetId) ? widgets[widgetId] : undefined,
    [widgets]
  );

  const lifecycle = useLayoutLifecycle(layout, draft, setDraft);
  const mutations = usePlacementMutations(setDraft, isDrawn, factsFor);

  const reload = useCallback(() => {
    // The draft goes first: it is the thing the reader was warned they would
    // lose, and it is what stands between the refetched arrangement and being
    // drawn. BOTH mutations, because `isConflict` reads both errors.
    setDraft(null);
    layout.save.reset();
    layout.reset.reset();
    void layout.reload();
  }, [layout]);

  const add = useCallback(
    (widgetId: string, settings?: Record<string, unknown>): string | null => {
      // Answered from the draft as drawn, so the caller learns the id before the list moves
      // on; `addPlacement` refuses the same cases again inside the update.
      if (draft === null || draft.placements.length >= MAX_PLACEMENTS) {
        return null;
      }
      const id = addedPlacementId(draft.placements, widgetId);
      // A widget the read did not describe starts full, which is how the server reads a
      // widget that says nothing.
      const width = factsFor(widgetId)?.defaultWidth ?? "full";
      setDraft(current =>
        current
          ? {
              ...current,
              placements: addPlacement(
                current.placements,
                widgetId,
                width,
                id,
                settings
              ),
            }
          : current
      );
      return id;
    },
    [draft, factsFor]
  );

  const placements = draft?.placements ?? server;

  const available = useMemo(
    () => offerable(placements, layout.layout?.available ?? [], widgets),
    [placements, layout.layout, widgets]
  );

  return {
    ...lifecycle,
    ...mutations,
    isEditing: draft !== null,
    placements,
    available,
    factsFor,
    atCapacity: placements.length >= MAX_PLACEMENTS,
    // A staged reset is a change even when the default happens to match the
    // reader's own list: saving it stops them following their own row.
    hasUnsavedChanges:
      draft !== null &&
      (draft.stagedReset !== null || hasChanges(server, draft.placements)),
    isResetStaged: draft?.stagedReset != null,
    isSaving: layout.save.isPending || layout.reset.isPending,
    isWriting: layout.isWriting,
    isConflict: layout.isConflict,
    reload,
    add,
  };
}
