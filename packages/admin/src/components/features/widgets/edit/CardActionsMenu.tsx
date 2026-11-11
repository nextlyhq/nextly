"use client";

/**
 * Everything a reader can do to one card while customising, behind ONE menu: the card menu at
 * rest (`CardMenu`) with the moves added, in the same order — Settings…, Refresh, then Move
 * earlier and Move later, then Remove.
 *
 * ## The moves are not a convenience
 *
 * 🔴 WCAG 2.2 SC 2.5.7 (Dragging Movements, AA) requires that anything achieved
 * by dragging can also be achieved with a single pointer. Move earlier and Move
 * later are that alternative for the drag handle, on phones where there is no
 * dragging, and they are reachable by keyboard through the menu as well, so one
 * control answers both criteria.
 *
 * ## One button, not a toolbar
 *
 * One named button opens every action, and the card's width is shown beside it as a share of
 * the row. The width itself is changed in the card's settings drawer, or by dragging its edge.
 *
 * @module components/features/widgets/edit/CardActionsMenu
 */

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import {
  ArrowDown,
  ArrowUp,
  EyeOff,
  RefreshCw,
  Settings,
  Trash2,
} from "lucide-react";
import type { GridSize } from "nextly/config";
import { useRef, type ComponentType, type JSX } from "react";

import * as Icons from "@admin/components/icons";

import type { MoveDirection } from "../layout-editor";
import { sizeName, widthPercent } from "../sizes";

import { settingsIntent } from "./settings-sheet-code";

export interface CardActionsMenuProps {
  /** What the reader calls this card, which the button's name says. */
  title: string;
  /** Which moves would move the card; the rest are disabled. */
  can: Record<MoveDirection, boolean>;
  /** Whether a layout write is in flight, which every action waits for. */
  disabled: boolean;
  /** Registers the menu button, so focus can be sent back to it. */
  triggerRef: (element: HTMLElement | null) => void;
  /**
   * What Remove is called on this card, where not "Remove" (`removeLabelFor`): drawn with a hide
   * icon, as the menu at rest draws it.
   */
  removeLabel?: string | undefined;
  on: {
    move: (direction: MoveDirection) => void;
    remove: () => void;
    /** Opens the card's settings drawer. */
    openSettings: () => void;
    /** Ask again for this card's data alone, where it asks for any. */
    refresh?: (() => void) | undefined;
  };
}

/** The moves the menu offers, in menu order, with what each is called. */
const MOVES: ReadonlyArray<{
  direction: MoveDirection;
  label: string;
  icon: ComponentType<{ "aria-hidden"?: boolean; className?: string }>;
}> = [
  { direction: "earlier", label: "Move earlier", icon: ArrowUp },
  { direction: "later", label: "Move later", icon: ArrowDown },
];

/**
 * The card's width as a share of the row ("50%"), with its full size for a screen reader.
 * Shown beside the menu button while customising.
 */
export function CardSizeLabel({ size }: { size: GridSize }): JSX.Element {
  return (
    <span
      className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-border px-1 text-xs tabular-nums text-muted-foreground"
      data-testid="card-size-label"
    >
      {/* The percentage is for sight; the whole size is what is read. */}
      <span aria-hidden>{widthPercent(size.w)}</span>
      <span className="sr-only">{sizeName(size)}</span>
    </span>
  );
}

/**
 * How Remove is drawn in a card's menu, at rest and while customising: in the destructive colour,
 * highlighted or not, as the one item that takes something away. The deeper shade in light mode,
 * where the reference red is under 4.5:1 on the menu's surface; the reference red in dark mode,
 * where the deeper shade is the one that falls short.
 */
export const REMOVE_ITEM_CLASS =
  "text-destructive-700 data-[highlighted]:text-destructive-700 dark:text-destructive dark:data-[highlighted]:text-destructive";

export function CardActionsMenu({
  title,
  can,
  disabled,
  triggerRef,
  removeLabel,
  on,
}: CardActionsMenuProps): JSX.Element {
  const RemoveIcon = removeLabel === undefined ? Trash2 : EyeOff;
  // 🔴 Set by the actions that send focus somewhere themselves -- a move back
  // to this button once it has moved, a removal to the next card, Settings to
  // its drawer. The menu's own close returns focus to its trigger a tick later,
  // which would undo each of those.
  const focusIsHandled = useRef(false);
  const handled = (action: () => void) => () => {
    focusIsHandled.current = true;
    action();
  };

  return (
    // `modal={false}`: Settings opens a drawer from inside this menu, and a
    // modal menu closing underneath a dialog opening leaves the page refusing
    // pointer input.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          // The drawer's code starts loading as the reader heads for the menu.
          {...settingsIntent}
          type="button"
          variant="ghost"
          size="icon"
          // 28px: past the 24px minimum target WCAG 2.5.8 asks of a control
          // this small, and the size the card header already reserves.
          className="size-7 text-muted-foreground hover:text-foreground"
          disabled={disabled}
          aria-label={`Card actions for ${title}`}
          data-testid="card-actions"
        >
          <Icons.MoreHorizontal aria-hidden className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-48"
        onCloseAutoFocus={event => {
          if (!focusIsHandled.current) return;
          focusIsHandled.current = false;
          event.preventDefault();
        }}
      >
        <DropdownMenuItem
          onSelect={handled(on.openSettings)}
          data-testid="card-settings"
        >
          <Settings aria-hidden className="size-4" />
          Settings…
        </DropdownMenuItem>
        {on.refresh ? (
          <DropdownMenuItem
            onSelect={() => on.refresh?.()}
            data-testid="card-refresh"
          >
            <RefreshCw aria-hidden className="size-4" />
            Refresh
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        {MOVES.map(({ direction, label, icon: Icon }) => (
          <DropdownMenuItem
            key={direction}
            // Disabled rather than left out at the ends: the menu keeps one
            // shape on every card, and a reader learns where each move lives.
            disabled={!can[direction]}
            onSelect={handled(() => on.move(direction))}
            data-testid={`card-move-${direction}`}
          >
            <Icon aria-hidden className="size-4" />
            {label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={handled(on.remove)}
          className={REMOVE_ITEM_CLASS}
          data-testid="card-remove"
        >
          <RemoveIcon aria-hidden className="size-4" />
          {removeLabel ?? "Remove"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
