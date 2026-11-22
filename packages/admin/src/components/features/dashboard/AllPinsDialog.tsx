"use client";

/**
 * "View all pins": every pin the reader keeps, newest first, each opening its
 * document where every other link to it opens, each with "Unpin"; and, where
 * some pins name documents the reader may no longer read, how many there are
 * with "Remove them", so they stop holding a place under the limit.
 *
 * Read from the reader's pins (`GET /dashboard/pins`), the same answer the
 * entry page's Pin and Unpin read, so a pin made or removed anywhere shows
 * here at once. Opened through `openAllPins` and drawn by `AllPinsHost`, which
 * loads this module only when it first opens.
 *
 * @module components/features/dashboard/AllPinsDialog
 */

import { Pin } from "lucide-react";
import type { JSX } from "react";

import { resolveIconName } from "@admin/components/features/widgets/archetypes/icon";
import { useCollectionLabel } from "@admin/components/features/widgets/frame/collection-label";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Spinner,
  toast,
} from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import {
  targetOfPin,
  useDashboardPins,
  useRemoveUnreadablePins,
  type ShownPin,
} from "@admin/hooks/queries/useDashboardPins";
import { formatRelativeTime } from "@admin/lib/dashboard";
import {
  useDocumentAddress,
  type DocumentAddressOf,
} from "@admin/lib/navigation/useDocumentAddress";

import { allPinsReturnFocus, closeAllPins } from "./all-pins";
import { usePinRowItem } from "./pin-action";

/** How the dialog says how many pins the reader may no longer open. */
export function unreadableText(count: number): string {
  return count === 1
    ? "1 pin you can no longer open"
    : `${count} pins you can no longer open`;
}

/** Where a pin opens: where every other link to its document opens. */
function pinHref(pin: ShownPin, addressOf: DocumentAddressOf): string {
  return pin.targetType === "single"
    ? addressOf({ kind: "single", slug: pin.targetSlug })
    : addressOf({ kind: "collection", slug: pin.targetSlug, id: pin.entryId });
}

/** One pin: its icon, its title leading to it, where it lives and when it was pinned, and Unpin. */
function PinRow({
  pin,
  href,
  where,
  unpin,
}: {
  pin: ShownPin;
  href: string;
  where: string;
  unpin: () => void;
}): JSX.Element {
  const fallback = pin.targetType === "single" ? "FileText" : "Database";
  return (
    <li
      data-testid="all-pins-row"
      className="flex min-w-0 items-center gap-3 py-2.5"
    >
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
      >
        {resolveIconName(pin.icon) ?? resolveIconName(fallback)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <Link
          href={href}
          onClick={closeAllPins}
          className="truncate text-sm font-medium text-foreground hover:underline"
        >
          {pin.title}
        </Link>
        <span className="truncate text-xs text-muted-foreground">
          {where} · pinned{" "}
          <time dateTime={pin.pinnedAt}>
            {formatRelativeTime(pin.pinnedAt)}
          </time>
        </span>
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={unpin}
        aria-label={`Unpin ${pin.title}`}
      >
        Unpin
      </Button>
    </li>
  );
}

/** The pins of documents the reader may no longer read: how many, and the way to remove them. */
function UnreadablePins({
  count,
  remove,
  removing,
}: {
  count: number;
  remove: () => void;
  removing: boolean;
}): JSX.Element {
  return (
    <div
      data-testid="all-pins-unreadable"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted px-3 py-2"
    >
      <span className="text-sm text-foreground">{unreadableText(count)}</span>
      <Button variant="outline" size="sm" onClick={remove} disabled={removing}>
        Remove them
      </Button>
    </div>
  );
}

/** What the dialog holds once the pins are read: the list, the unreadable ones, or that there are none. */
function PinsBody(): JSX.Element {
  const pins = useDashboardPins();
  const remove = useRemoveUnreadablePins();
  const pinItem = usePinRowItem();
  const addressOf = useDocumentAddress();
  const labelOf = useCollectionLabel();
  if (pins.isPending) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }
  if (pins.isError) {
    return (
      <div className="flex flex-col items-start gap-2 py-4">
        <p className="text-sm text-foreground">Your pins could not be read.</p>
        <Button variant="outline" size="sm" onClick={() => void pins.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  const { shown, unreadableCount } = pins.data;
  return (
    <div className="flex min-h-0 flex-col gap-3">
      {unreadableCount > 0 && (
        <UnreadablePins
          count={unreadableCount}
          remove={() =>
            // The server finds and removes them; the answer names none.
            remove.mutate(undefined, {
              // The list is read again either way; this says why some stayed.
              onError: () =>
                toast.error("Some pins could not be removed. Try again."),
            })
          }
          removing={remove.isPending}
        />
      )}
      {shown.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          No pins yet. Choose “Pin to dashboard” in an entry’s ⋯ menu to keep it
          here.
        </p>
      ) : (
        <ul
          data-testid="all-pins-list"
          aria-label="Pins, newest first"
          className="flex min-h-0 flex-col divide-y divide-border overflow-y-auto"
        >
          {shown.map(pin => (
            <PinRow
              key={`${pin.targetType}:${pin.targetSlug}:${pin.entryId}`}
              pin={pin}
              href={pinHref(pin, addressOf)}
              where={
                pin.targetType === "single" ? "Single" : labelOf(pin.targetSlug)
              }
              unpin={pinItem(targetOfPin(pin), true).onSelect}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export function AllPinsDialog({ open }: { open: boolean }): JSX.Element {
  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) closeAllPins();
      }}
    >
      <DialogContent
        size="md"
        data-testid="all-pins-dialog"
        className="flex max-h-[80vh] flex-col"
        onCloseAutoFocus={event => {
          // Back to what opened it (the card's footer, a toast's button)
          // while that is still on the page.
          const back = allPinsReturnFocus();
          if (back === null) return;
          event.preventDefault();
          back.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pin aria-hidden="true" className="size-4 text-muted-foreground" />
            Your pins
          </DialogTitle>
          <DialogDescription>
            Newest first. Pins show first in “Continue where you left off”.
          </DialogDescription>
        </DialogHeader>
        <PinsBody />
      </DialogContent>
    </Dialog>
  );
}
