/**
 * The pin control a document offers: "Pin to dashboard" or "Unpin from
 * dashboard", as the reader's pins currently say, and what choosing it does.
 *
 * One description for every place a pin is offered (the edit page's menu, a
 * row's menu on the dashboard, "View all pins"), so the verb and its effect
 * cannot differ between them. A saved choice is confirmed in a toast that says
 * where the pin went only when that is true; a refusal is shown in the
 * server's own words, and the limit's with "View all pins", where the reader
 * can make room.
 */
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { toast } from "@admin/components/ui";
import {
  DASHBOARD_LAYOUT_KEY,
  fetchDashboardLayout,
  isConflictError,
} from "@admin/hooks/queries/useDashboardLayout";
import {
  type PinTarget,
  usePinned,
  useSetPinned,
} from "@admin/hooks/queries/useDashboardPins";

import type { ContributedAction } from "../entries/EntryForm/DocumentActionBar";
import type { EntityRowMenuItem } from "../widgets/frame/entity-row";

import { openAllPins } from "./all-pins";

/** Core's Continue where you left off card, the one place pins are drawn. */
const CONTINUE_WIDGET_ID = "core/continue";

/** The confirmation when the reader's dashboard shows their pins. */
const PINNED_SHOWN = "Pinned to your dashboard.";

/** The confirmation when it does not: the card is not on it, or is hidden for them. */
const PINNED_NOT_SHOWN =
  "Pinned. Add “Continue where you left off” to your dashboard to see your pins.";

/**
 * A pin the server refused, in its own words. The limit (a conflict: the one
 * a pin can meet) offers "View all pins", where the reader can unpin one.
 */
function showRefusal(error: unknown): void {
  const message =
    error instanceof Error && error.message
      ? error.message
      : "The pin could not be saved. Try again.";
  if (error instanceof Error && isConflictError(error)) {
    toast.error(message, {
      action: {
        label: "View all pins",
        onClick: event => {
          // Kept open, so focus can come back to it when the dialog closes.
          event.preventDefault();
          openAllPins();
        },
      },
    });
    return;
  }
  toast.error(message);
}

/**
 * Whether the reader's dashboard shows a Continue where you left off card: a
 * card of it placed and not removed on their layout, which leaves out a card
 * hidden for them (its condition, or their permission). Its tab does not
 * matter: Mine, where pins are, is one click away on its header. The layout
 * the dashboard already read is used where there is one; a layout that cannot
 * be read says no, so the toast never claims a card it cannot see.
 */
async function continueCardShown(queryClient: QueryClient): Promise<boolean> {
  try {
    const layout = await queryClient.ensureQueryData({
      queryKey: DASHBOARD_LAYOUT_KEY,
      queryFn: fetchDashboardLayout,
    });
    return layout.placements.some(
      placement =>
        placement.widgetId === CONTINUE_WIDGET_ID && !placement.removed
    );
  } catch {
    return false;
  }
}

/** The verb for a target that is, or is not, pinned. */
function pinLabel(pinned: boolean): string {
  return pinned ? "Unpin from dashboard" : "Pin to dashboard";
}

/**
 * Choose `pinned` for a target that is `was`: write it, then confirm it in a
 * toast whose Undo puts back the state from before the choice, or show the
 * server's refusal. Said once it is saved: choosing closes the menu, and
 * nothing else on the page changes at once to show the pin was kept. A pin's
 * words follow whether the dashboard shows it.
 */
function choosePin(
  set: (pinned: boolean) => Promise<unknown>,
  was: boolean,
  queryClient: QueryClient
): void {
  set(!was).then(async () => {
    const message = was
      ? "Unpinned from your dashboard."
      : (await continueCardShown(queryClient))
        ? PINNED_SHOWN
        : PINNED_NOT_SHOWN;
    toast.success(message, {
      action: {
        label: "Undo",
        onClick: () => {
          set(was).catch(showRefusal);
        },
      },
    });
  }, showRefusal);
}

/**
 * The edit page's menu item for `target`, or none while the reader's pins are
 * still being read, so the menu never offers the wrong verb.
 */
export function usePinAction(
  target: PinTarget | null
): ContributedAction | null {
  const { pinned, set, pending } = usePinned(target);
  const queryClient = useQueryClient();
  if (pinned === null) return null;
  return {
    action: {
      id: "pin-to-dashboard",
      label: pinLabel(pinned),
      placement: "menu",
      group: "document",
      ...(pending ? { disabledReason: "Saving your pin…" } : {}),
    },
    binding: { onSelect: () => choosePin(set, pinned, queryClient) },
  };
}

/**
 * A row's menu item for its document, on a dashboard card or in "View all
 * pins": the same verb, toast and Undo as the edit page's, for a row that
 * already says whether it is pinned. One hook for every row of a list, since
 * a row's state comes from its list rather than from a read of the reader's
 * pins per row.
 */
export function usePinRowItem(): (
  target: PinTarget,
  pinned: boolean
) => EntityRowMenuItem {
  const { mutateAsync } = useSetPinned();
  const queryClient = useQueryClient();
  return useCallback(
    (target: PinTarget, pinned: boolean): EntityRowMenuItem => ({
      id: "pin-to-dashboard",
      label: pinLabel(pinned),
      onSelect: () =>
        choosePin(
          wanted => mutateAsync({ target, pinned: wanted }),
          pinned,
          queryClient
        ),
    }),
    [mutateAsync, queryClient]
  );
}
