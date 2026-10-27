"use client";

/**
 * A release's row menu: which actions it offers, and the dialogs they open.
 *
 * Shared by every place that lists releases — the list's table, and the
 * calendar's day list — so a release offers the same actions, under the same
 * names, wherever it is listed. What each reader may do comes from the
 * capabilities the server sent with the release; nothing here decides it.
 *
 * @module components/features/releases/ReleaseRowMenu
 */

import type { JSX } from "react";

import { MoreHorizontal } from "@admin/components/icons";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@admin/components/ui";
import type { RowAction } from "@admin/components/ui/table/data-table";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { navigateTo } from "@admin/lib/navigation";
import { cn } from "@admin/lib/utils";
import type { Release } from "@admin/types/releases";

import {
  ReleaseRowActionDialog,
  type ReleaseRowAction,
} from "./ReleaseRowActionDialog";
import { ScheduleReleaseDialog } from "./ScheduleReleaseDialog";

/** The dialog a row's menu opened, and for which release. */
export interface OpenDialog {
  release: Release;
  action: ReleaseRowAction | "schedule";
}

/** One entry of the row menu: when it is offered, and what it is called. */
interface RowMenuEntry {
  id: ReleaseRowAction | "schedule";
  offered: (release: Release) => boolean;
  label: (release: Release) => string;
  destructive?: boolean;
}

const isDraft = (release: Release) => release.state === "draft";

/**
 * The row menu's entries after "Open", in order, each offered from the
 * capabilities the server sent with the release. Nothing here decides what is
 * permitted; it decides only what to call each action and when two would
 * offer the same thing.
 */
const ROW_MENU: readonly RowMenuEntry[] = [
  {
    id: "schedule",
    offered: release => release.can?.schedule === true,
    label: release => (isDraft(release) ? "Schedule…" : "Reschedule…"),
  },
  {
    id: "publish",
    offered: release => release.can?.publishNow === true,
    label: () => "Publish now…",
  },
  {
    // A draft that may be deleted is offered Delete and not Discard: both end
    // with nothing going live, and two ways of getting rid of one draft is a
    // choice with no difference the reader can see from here.
    id: "cancel",
    offered: release =>
      release.can?.cancel === true && !(isDraft(release) && release.can.delete),
    label: release => (isDraft(release) ? "Discard…" : "Cancel release…"),
  },
  {
    id: "delete",
    offered: release => release.can?.delete === true,
    label: () => "Delete…",
    destructive: true,
  },
];

/** The actions a reader may take on a release, for its row menu. */
export function rowActionsFor(
  release: Release,
  open: (dialog: OpenDialog) => void
): RowAction<Release>[] {
  const openRelease: RowAction<Release> = {
    id: "open",
    label: "Open",
    onSelect: () =>
      navigateTo(buildRoute(ROUTES.RELEASES_DETAIL, { id: release.id })),
  };
  const offered = ROW_MENU.filter(entry => entry.offered(release)).map(
    (entry): RowAction<Release> => ({
      id: entry.id,
      label: entry.label(release),
      destructive: entry.destructive,
      onSelect: () => open({ release, action: entry.id }),
    })
  );
  return [openRelease, ...offered];
}

/** The dialog the row menu opened, if any. */
export function ReleaseRowDialogs({
  dialog,
  open,
  onOpenChange,
}: {
  dialog: OpenDialog | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element | null {
  if (!dialog) return null;
  if (dialog.action === "schedule") {
    return (
      <ScheduleReleaseDialog
        // Keyed by release: the dialog seeds its zone from the release it
        // opens on, and must not carry one release's choice to the next.
        key={dialog.release.id}
        release={dialog.release}
        open={open}
        onOpenChange={onOpenChange}
      />
    );
  }
  return (
    <ReleaseRowActionDialog
      key={`${dialog.release.id}:${dialog.action}`}
      release={dialog.release}
      action={dialog.action}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}

/**
 * The row menu as a button of its own, for a list that is not the shared
 * table.
 *
 * Drawn as the table draws its row menu, so the two look and behave alike;
 * named for the release, since a list of several menus each called "Row
 * actions" leaves a screen-reader user guessing which release each one is for.
 */
export function ReleaseRowMenuButton({
  release,
  onOpen,
}: {
  release: Release;
  onOpen: (dialog: OpenDialog) => void;
}): JSX.Element {
  const actions = rowActionsFor(release, onOpen);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Actions for ${release.title}`}
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map(action => (
          <DropdownMenuItem
            key={action.id}
            onSelect={() => action.onSelect(release)}
            className={cn(action.destructive && "text-destructive")}
          >
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
