"use client";

/**
 * A card's menu at rest, outside customise mode, in the same place on every card, holding in
 * this order:
 *
 * 1. Settings: the card's quick popover, or its settings sheet where it has nothing quick;
 * 2. Size: its width and height, within its widget's bounds, saved at once with Undo;
 * 3. Refresh: asks again for this card alone;
 * 4. Remove: takes the card off at once, asking nothing, with Undo in the removal notice. It is
 *    the reader's own dismissal of the card, the same for every card, so a reader following the
 *    default dashboard keeps following it. A card may name it otherwise (`removeLabel`): the
 *    setup card's is "Hide setup".
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
import { EyeOff, RefreshCw, Settings, Trash2 } from "lucide-react";
import type { GridSize, WidgetSizeBounds } from "nextly/config";
import type { JSX } from "react";
import { useId, useRef } from "react";

import * as Icons from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import { AxisSection, REMOVE_ITEM_CLASS, sizeAxes } from "./CardActionsMenu";
import { settingsIntent } from "./settings-sheet-code";

export interface CardMenuProps {
  title: string;
  /** Registers the menu button, so focus can be sent back to it. */
  triggerRef?: ((element: HTMLElement | null) => void) | undefined;
  /** Open the card's quick popover, or its settings sheet, where it offers either. */
  onOpenSettings?: (() => void) | undefined;
  /** The card's size and a way to change it, where it may be resized from here. */
  size?:
    | {
        size: GridSize;
        bounds: WidgetSizeBounds;
        /** Lists the sizes in the menu itself rather than in submenus: at one column. */
        inPlace: boolean;
        onSetSize: (size: GridSize) => void;
      }
    | undefined;
  /** Ask again for this card's data alone, when it asks for any. */
  onRefresh?: (() => void) | undefined;
  /** Take the card off the dashboard, once an arrangement has been read. */
  onRemove?: (() => void) | undefined;
  /**
   * What Remove is called on this card, where not "Remove": drawn with a hide icon, for a card
   * that is hidden rather than deleted, such as the setup card's "Hide setup".
   */
  removeLabel?: string | undefined;
  /** A layout write is in flight, or the card cannot be saved now: Settings and Size wait. */
  settingsDisabled: boolean;
  /** A layout write is in flight, which Remove waits for. */
  removeDisabled?: boolean;
  /**
   * Why the card cannot be removed now, when it cannot: Remove stays in reach and says so,
   * rather than leaving the menu with no word of where it went.
   */
  removeUnavailable?: string | undefined;
}

/**
 * What a card's Remove is called where not "Remove", by widget: the setup card is hidden rather
 * than deleted, and comes back from Add widget.
 */
const REMOVE_LABELS: ReadonlyMap<string, string> = new Map([
  ["core/setup", "Hide setup"],
]);

/** The name of Remove on a card of `widgetId`, where it is not "Remove". */
export function removeLabelFor(widgetId: string): string | undefined {
  return REMOVE_LABELS.get(widgetId);
}

/** Settings: opens the card's quick popover or its sheet, which takes focus itself. */
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
  label,
}: {
  disabled: boolean;
  unavailable: string | undefined;
  onRemove: () => void;
  label: string | undefined;
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
        {label === undefined ? (
          <Trash2 aria-hidden className="size-4" />
        ) : (
          <EyeOff aria-hidden className="size-4" />
        )}
        {label ?? "Remove"}
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
  size,
  onRefresh,
  onRemove,
  removeLabel,
  settingsDisabled,
  removeDisabled = false,
  removeUnavailable,
}: CardMenuProps): JSX.Element {
  // Set by Settings, which sends focus into its popover or sheet: the menu's own close would
  // otherwise return focus to its trigger a tick later and take it back out.
  const focusIsHandled = useRef(false);
  const axes = size
    ? sizeAxes(size.size, size.bounds, chosen => size.onSetSize(chosen))
    : [];
  const hasAbove =
    onOpenSettings !== undefined || axes.length > 0 || onRefresh !== undefined;

  return (
    // `modal={false}`, as the customise menu: Settings opens a popover or a sheet from inside
    // this menu, and a modal menu closing underneath one opening leaves the page refusing
    // pointer input.
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
          // Settings is in this menu: its sheet's code starts loading as the reader heads for it.
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
        {/* Disabled while a write is in flight: each choice is a write of its own. */}
        {axes.map(axis => (
          <AxisSection
            key={axis.kind}
            axis={axis}
            inPlace={size?.inPlace === true}
            disabled={settingsDisabled}
          />
        ))}
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
            label={removeLabel}
          />
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
