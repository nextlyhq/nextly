/**
 * The pin control a document offers: "Pin to dashboard" or "Unpin from
 * dashboard", as the reader's pins currently say, and what choosing it does.
 *
 * One description for every place a pin is offered (the edit page's menu, a
 * row's menu on the dashboard), so the verb and its effect cannot differ
 * between them. A saved choice is confirmed in a toast; a refusal (the limit,
 * or pins not available yet) is shown in the server's own words, which name
 * the limit or the command.
 *
 * @experimental Until the dashboard draws its pins.
 */
import { useCallback } from "react";

import { toast } from "@admin/components/ui";
import {
  type PinTarget,
  usePinned,
  useSetPinned,
} from "@admin/hooks/queries/useDashboardPins";

import type { ContributedAction } from "../entries/EntryForm/DocumentActionBar";
import type { EntityRowMenuItem } from "../widgets/frame/entity-row";

/** A pin the server refused, in its own words: the limit, or the command to run. */
function showRefusal(error: unknown): void {
  toast.error(
    error instanceof Error && error.message
      ? error.message
      : "The pin could not be saved. Try again."
  );
}

/** The verb for a target that is, or is not, pinned. */
function pinLabel(pinned: boolean): string {
  return pinned ? "Unpin from dashboard" : "Pin to dashboard";
}

/**
 * Choose `pinned` for a target that is `was`: write it, then confirm it in a
 * toast whose Undo puts back the state from before the choice, or show the
 * server's refusal. Said once it is saved: choosing closes the menu, and
 * nothing else on the page changes at once to show the pin was kept.
 */
function choosePin(
  set: (pinned: boolean) => Promise<unknown>,
  was: boolean
): void {
  set(!was).then(
    () =>
      toast.success(
        was ? "Unpinned from your dashboard." : "Pinned to your dashboard.",
        {
          action: {
            label: "Undo",
            onClick: () => {
              set(was).catch(showRefusal);
            },
          },
        }
      ),
    showRefusal
  );
}

/**
 * The edit page's menu item for `target`, or none while the reader's pins are
 * still being read, so the menu never offers the wrong verb.
 */
export function usePinAction(
  target: PinTarget | null
): ContributedAction | null {
  const { pinned, set, pending } = usePinned(target);
  if (pinned === null) return null;
  return {
    action: {
      id: "pin-to-dashboard",
      label: pinLabel(pinned),
      placement: "menu",
      group: "document",
      ...(pending ? { disabledReason: "Saving your pin…" } : {}),
    },
    binding: { onSelect: () => choosePin(set, pinned) },
  };
}

/**
 * A dashboard row's "…" menu item for its document: the same verb, toast and
 * Undo as the edit page's, for a row whose answer says whether it is pinned.
 * One hook for every row of a card, since a row's state comes from the card's
 * answer rather than from a read of the reader's pins per row.
 */
export function usePinRowItem(): (
  target: PinTarget,
  pinned: boolean
) => EntityRowMenuItem {
  const { mutateAsync } = useSetPinned();
  return useCallback(
    (target: PinTarget, pinned: boolean): EntityRowMenuItem => ({
      id: "pin-to-dashboard",
      label: pinLabel(pinned),
      onSelect: () =>
        choosePin(wanted => mutateAsync({ target, pinned: wanted }), pinned),
    }),
    [mutateAsync]
  );
}
