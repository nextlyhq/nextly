"use client";

/**
 * Saving one card's settings at once, outside customise mode: the quick setting on the card,
 * and the settings sheet's Done when the reader is not customising.
 *
 * The same single-card write a dismissal makes (`single-card-write`), on its own channel: the
 * whole arrangement with this card's settings changed, under the read's own version and scope,
 * sent as not arranged so the reader keeps following the default. A write raced against
 * another tab is refused, the dashboard is read again, and the reader is told nothing was
 * saved; it is not retried, because the change it carried was made against a dashboard that
 * has since moved.
 *
 * @module components/features/widgets/edit/useCardSettingsWrite
 */

import { useCallback } from "react";

import { toast } from "@admin/components/ui";
import {
  isConflictError,
  type UseDashboardLayoutResult,
} from "@admin/hooks/queries/useDashboardLayout";

import { setPlacementConfig } from "../layout-editor";

import { sameSettingValue } from "./content-settings";
import { landed, singleCardWrite } from "./single-card-write";

export interface CardSettingsWriteInput {
  placementId: string;
  /** The card's title, for what the reader is told. */
  title: string;
  /** The settings to store, as `toStoredConfig` builds them: only what departs from a default. */
  config: Record<string, unknown>;
}

export interface CardSettingsWriteCallbacks {
  /** The write landed and the dashboard the client holds now shows it. */
  onLanded?: () => void;
  /** The write did not land; the message says why, for the control that made it. */
  onFailed?: (message: string) => void;
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
const FAILED = (title: string, reason: string) =>
  `Could not save ${title}'s settings: ${reason}`;
const REFRESH_FAILED = (title: string) =>
  `${title} was saved, but the dashboard could not be refreshed. Reload the page to see it.`;

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
      const fail = (message: string) => {
        toast.error(message);
        callbacks?.onFailed?.(message);
      };
      if (!stored || layout.isUnreadable) {
        fail(layout.isUnreadable ? UNREADABLE : NOT_READ);
        return;
      }
      // One at a time: two writes in flight carry the same version guard, and the server can
      // honour only one.
      if (layout.isWriting) return;
      if (!stored.placements.some(p => p.id === input.placementId)) return;

      // Cleared before the attempt, so a retry that succeeds does not leave a failure reported.
      layout.cardSettings.reset();
      layout.cardSettings.mutate(
        singleCardWrite(
          stored,
          setPlacementConfig(stored.placements, input.placementId, input.config)
        ),
        {
          onSuccess: () => {
            // Compared by value: the settings come back from the server as a new object.
            if (
              !landed(layout, input.placementId, p =>
                sameSettingValue(p.config ?? {}, input.config)
              )
            ) {
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
            fail(FAILED(input.title, error.message));
          },
        }
      );
    },
    [layout]
  );

  return {
    write,
    isWriting: layout.cardSettings.isPending,
    unavailable,
  };
}
