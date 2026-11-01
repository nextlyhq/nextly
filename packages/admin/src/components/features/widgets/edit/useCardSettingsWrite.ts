"use client";

/**
 * Saving one change to one card at once, outside customise mode: its settings (the quick setting
 * on the card, the quick popover, and the settings sheet's Done when the reader is not
 * customising) or its size (the card menu's and the popover's Size).
 *
 * The same single-card write a dismissal makes (`single-card-write`), on its own channel: the
 * whole arrangement with this one card changed, under the read's own version and scope, sent as
 * not arranged so the reader keeps following the default. It is the request customise mode's
 * Save sends for the same change, through the same server write, apart from that flag. A write
 * raced against another tab is refused, the dashboard is read again, and the reader is told
 * nothing was saved; it is not retried, because the change it carried was made against a
 * dashboard that has since moved.
 *
 * @module components/features/widgets/edit/useCardSettingsWrite
 */

import type { GridSize, WidgetSizeBounds } from "nextly/config";
import { useCallback } from "react";

import { toast } from "@admin/components/ui";
import {
  isConflictError,
  type UseDashboardLayoutResult,
} from "@admin/hooks/queries/useDashboardLayout";
import type { WidgetPlacement } from "@admin/types/dashboard/widgets";

import { setPlacementConfig, setPlacementSize } from "../layout-editor";

import { sameSettingValue } from "./content-settings";
import { landed, singleCardWrite } from "./single-card-write";

/**
 * One change to one card: its settings, as `toStoredConfig` builds them (only what departs from
 * a default), or its size, held to its widget's bounds as the customise menu's resize is.
 */
export type CardChange =
  | {
      readonly kind: "settings";
      readonly config: Record<string, unknown>;
      /**
       * The title the reader gave the card, where the change sets it: the settings panel's
       * Title. Absent, the card keeps the title it has.
       */
      readonly ownTitle?: string;
    }
  | {
      readonly kind: "size";
      readonly size: GridSize;
      readonly bounds: WidgetSizeBounds;
    };

export interface CardSettingsWriteInput {
  placementId: string;
  /** The card's title, for what the reader is told. */
  title: string;
  change: CardChange;
}

export interface CardSettingsWriteCallbacks {
  /** The write landed and the dashboard the client holds now shows it. */
  onLanded?: () => void;
  /** The write did not land; the message says why, for the control that made it. */
  onFailed?: (message: string) => void;
  /**
   * The control that made the write shows a failure itself, in place, so it is not also put in a
   * toast: the settings sheet says why beside the form it kept open.
   */
  showsFailure?: boolean;
}

export interface CardSettingsWrite {
  write: (
    input: CardSettingsWriteInput,
    callbacks?: CardSettingsWriteCallbacks
  ) => void;
  /** A card's settings write is in flight; every settings control waits for it. */
  isWriting: boolean;
  /**
   * Why a card's settings cannot be saved now, or `undefined` when they can. The control says
   * this rather than accepting a change it would then drop.
   */
  unavailable: string | undefined;
}

const UNREADABLE =
  "Your saved dashboard cannot be read, so card settings cannot be saved. Reload the page or reset the dashboard.";
const NOT_READ = "Your dashboard has not loaded yet.";
const CONFLICT = (title: string) =>
  `${title} changed elsewhere, so this change was not saved.`;
const FAILED = (title: string, what: string, reason: string) =>
  `Could not save ${title}'s ${what}: ${reason}`;
const REFRESH_FAILED = (title: string) =>
  `${title} was saved, but the dashboard could not be refreshed. Reload the page to see it.`;
const BUSY =
  "Another change to your dashboard is still saving. Try again in a moment.";
const GONE = (title: string, what: string) =>
  `${title} is no longer on your dashboard, so its ${what} ${what === "size" ? "was" : "were"} not saved.`;
const OUT_OF_BOUNDS = (title: string) =>
  `${title} can't be that size, so it was not resized.`;

/**
 * `change` applied to the stored list, how the card in it shows the change, and what the reader
 * is told the change was to. The list is changed by the customise editor's own functions, so a
 * change saved at once is the change customise mode would stage for Save.
 */
function applied(
  placements: readonly WidgetPlacement[],
  placementId: string,
  change: CardChange
): {
  placements: WidgetPlacement[];
  shows: (placement: WidgetPlacement) => boolean;
  what: string;
} {
  if (change.kind === "size") {
    return {
      placements: setPlacementSize(
        placements,
        placementId,
        change.size,
        change.bounds
      ),
      shows: placement =>
        placement.w === change.size.w && placement.h === change.size.h,
      what: "size",
    };
  }
  return {
    placements: setPlacementConfig(
      placements,
      placementId,
      change.config,
      change.ownTitle
    ),
    // Compared by value: the settings come back from the server as a new object. The title as
    // the write stores it, trimmed, absent when nothing is left.
    shows: placement =>
      sameSettingValue(placement.config ?? {}, change.config) &&
      (change.ownTitle === undefined ||
        (placement.title ?? "") === change.ownTitle.trim()),
    what: "settings",
  };
}

/** Why a card's settings cannot be written from this layout, or `undefined` when they can. */
function unavailableFor(layout: UseDashboardLayoutResult): string | undefined {
  // The server refuses a single-card write to an unreadable row, and with no read there are no
  // stored placements to write the card's settings into.
  if (layout.isUnreadable) return UNREADABLE;
  if (!layout.layout) return NOT_READ;
  return undefined;
}

export function useCardSettingsWrite(
  layout: UseDashboardLayoutResult
): CardSettingsWrite {
  const unavailable = unavailableFor(layout);

  const write = useCallback(
    (input: CardSettingsWriteInput, callbacks?: CardSettingsWriteCallbacks) => {
      // The CACHED copy, which is the arrangement after the last write landed and carries the
      // version it produced: the hook's own snapshot can be a render old.
      const stored = layout.cached() ?? layout.layout;
      // Every way this ends answers the caller: a control waiting on its save, the sheet's Done,
      // would otherwise wait for good.
      const fail = (message: string) => {
        if (!callbacks?.showsFailure) toast.error(message);
        callbacks?.onFailed?.(message);
      };
      if (!stored || layout.isUnreadable) {
        fail(layout.isUnreadable ? UNREADABLE : NOT_READ);
        return;
      }
      // One at a time: two writes in flight carry the same version guard, and the server can
      // honour only one.
      if (layout.isWriting) {
        fail(BUSY);
        return;
      }
      const next = applied(stored.placements, input.placementId, input.change);
      if (!stored.placements.some(p => p.id === input.placementId)) {
        fail(GONE(input.title, next.what));
        return;
      }
      // A size outside the widget's bounds leaves the list as it was (`setPlacementSize`), and
      // a write of an unchanged list would be reported as one that did not show.
      const drawn = next.placements.find(p => p.id === input.placementId);
      if (drawn === undefined || !next.shows(drawn)) {
        fail(OUT_OF_BOUNDS(input.title));
        return;
      }

      // Cleared before the attempt, so a retry that succeeds does not leave a failure reported.
      layout.cardSettings.reset();
      layout.cardSettings.mutate(singleCardWrite(stored, next.placements), {
        onSuccess: () => {
          if (!landed(layout, input.placementId, next.shows)) {
            fail(REFRESH_FAILED(input.title));
            return;
          }
          callbacks?.onLanded?.();
        },
        onError: error => {
          if (isConflictError(error)) {
            // Read again, so the next change is made against the dashboard as it now is.
            void layout.reload();
            fail(CONFLICT(input.title));
            return;
          }
          fail(FAILED(input.title, next.what, error.message));
        },
      });
    },
    [layout]
  );

  return {
    write,
    isWriting: layout.cardSettings.isPending,
    unavailable,
  };
}
