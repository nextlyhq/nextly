"use client";

/**
 * A card's menu at rest, outside customise mode, in the same place on every card, holding in
 * this order:
 *
 * 1. Settings…: the card's settings drawer, every setting it has, its title and its width;
 * 2. Refresh: asks again for this card alone;
 * 3. Remove: takes the card off at once, asking nothing, with Undo in the removal notice. It is
 *    the reader's own dismissal of the card, the same for every card, so a reader following the
 *    default dashboard keeps following it.
 *
 * Each where the card has it. The customise-mode menu (`CardActionsMenu`) keeps the same order
 * with the moves added before Remove.
 *
 * @module components/features/widgets/edit/CardMenu
 */

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { RefreshCw, Settings, Trash2 } from "lucide-react";
import type { JSX } from "react";
import { useId, useRef } from "react";

import * as Icons from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import { REMOVE_ITEM_CLASS } from "./CardActionsMenu";
import { settingsIntent } from "./settings-sheet-code";

export interface CardMenuProps {
  title: string;
  /** Registers the menu button, so focus can be sent back to it. */
  triggerRef?: ((element: HTMLElement | null) => void) | undefined;
  /** Open the card's settings drawer, once its settings can be saved. */
  onOpenSettings?: (() => void) | undefined;
  /** Ask again for this card's data alone, when it asks for any. */
  onRefresh?: (() => void) | undefined;
  /** Take the card off the dashboard, once an arrangement has been read. */
  onRemove?: (() => void) | undefined;
  /** A layout write is in flight, or the card cannot be saved now: Settings waits. */
  settingsDisabled: boolean;
  /** A layout write is in flight, which Remove waits for. */
  removeDisabled?: boolean;
  /**
   * Why the card cannot be removed now, when it cannot: Remove stays in reach and says so,
   * rather than leaving the menu with no word of where it went.
   */
  removeUnavailable?: string | undefined;
}

/** Settings…: opens the card's settings drawer, which takes focus itself. */
function SettingsItem({
  disabled,
  onOpen,
}: {
  disabled: boolean;
  onOpen: () => void;
}): JSX.Element {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={onOpen}
      data-testid="card-menu-settings"
    >
      <Settings aria-hidden className="size-4" />
      Settings…
    </DropdownMenuItem>
  );
}

/**
 * Remove: asks nothing, since the removal notice offers Undo, and focus moves to it once the card
 * has gone. Until then focus returns to the menu's button, on a card still drawn.
 *
 * Unavailable, it stays focusable and says why: `aria-disabled` rather than `disabled`, which
 * would take it, and its reason, out of the keyboard's reach.
 */
function RemoveItem({
  disabled,
  unavailable,
  onRemove,
}: {
  disabled: boolean;
  unavailable: string | undefined;
  onRemove: () => void;
}): JSX.Element {
  const reasonId = useId();
  const refused = unavailable !== undefined;
  return (
    <>
      <DropdownMenuItem
        disabled={disabled}
        aria-disabled={refused || undefined}
        aria-describedby={refused ? reasonId : undefined}
        title={unavailable}
        onSelect={event => {
          if (refused) {
            event.preventDefault();
            return;
          }
          onRemove();
        }}
        className={cn(
          REMOVE_ITEM_CLASS,
          refused && "cursor-not-allowed opacity-50"
        )}
        data-testid="card-menu-remove"
      >
        <Trash2 aria-hidden className="size-4" />
        Remove
      </DropdownMenuItem>
      {refused ? (
        <span id={reasonId} className="sr-only">
          {unavailable}
        </span>
      ) : null}
    </>
  );
}

export function CardMenu({
  title,
  triggerRef,
  onOpenSettings,
  onRefresh,
  onRemove,
  settingsDisabled,
  removeDisabled = false,
  removeUnavailable,
}: CardMenuProps): JSX.Element {
  // Set by Settings, which sends focus into its drawer: the menu's own close would otherwise
  // return focus to its trigger a tick later and take it back out.
  const focusIsHandled = useRef(false);
  const hasAbove = onOpenSettings !== undefined || onRefresh !== undefined;

  return (
    // `modal={false}`, as the customise menu: Settings opens a drawer from inside this menu,
    // and a modal menu closing underneath one opening leaves the page refusing pointer input.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="icon"
          // 28px, past the 24px minimum target WCAG 2.5.8 asks of a control this small.
          className="size-7 text-muted-foreground hover:text-foreground"
          aria-label={`Card menu for ${title}`}
          data-testid="card-menu"
          // Settings is in this menu: its drawer's code starts loading as the reader heads for it.
          {...(onOpenSettings ? settingsIntent : {})}
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
        {onOpenSettings ? (
          <SettingsItem
            disabled={settingsDisabled}
            onOpen={() => {
              focusIsHandled.current = true;
              onOpenSettings();
            }}
          />
        ) : null}
        {onRefresh ? (
          <DropdownMenuItem
            onSelect={() => onRefresh()}
            data-testid="card-menu-refresh"
          >
            <RefreshCw aria-hidden className="size-4" />
            Refresh
          </DropdownMenuItem>
        ) : null}
        {onRemove && hasAbove ? <DropdownMenuSeparator /> : null}
        {onRemove ? (
          <RemoveItem
            disabled={removeDisabled}
            unavailable={removeUnavailable}
            onRemove={onRemove}
          />
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
