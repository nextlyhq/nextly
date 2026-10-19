"use client";

/**
 * Everything a reader can do to one card while customising, behind ONE menu.
 *
 * ## The moves are not a convenience
 *
 * 🔴 WCAG 2.2 SC 2.5.7 (Dragging Movements, AA) requires that anything achieved
 * by dragging can also be achieved with a single pointer. The four moves here
 * are that alternative for the drag handle, and they are reachable by keyboard
 * through the menu as well, so one control answers both criteria.
 *
 * ## One button, not a toolbar
 *
 * A row of seven icon buttons per card was seven Tab stops per card and a
 * header too crowded for a narrow card. One named button opens every action,
 * and the card's width is shown beside it as a fraction so the reader can see
 * what the Width submenu will change without opening it.
 *
 * @module components/features/widgets/edit/CardActionsMenu
 */

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  MoveHorizontal,
  Settings,
  Trash2,
} from "lucide-react";
import { useRef, type ComponentType } from "react";

import * as Icons from "@admin/components/icons";
import type { WidgetWidth } from "@admin/types/dashboard/widgets";

import type { MoveDirection } from "../layout-editor";
import { WIDTH_NAMES, isWidgetWidth } from "../sizes";

export interface CardActionsMenuProps {
  /** What the reader calls this card, which the button's name says. */
  title: string;
  /** The width the card is DRAWN at, which the Width submenu checks. */
  width: WidgetWidth;
  /** The widths its widget allows, narrowest first; none known offers none. */
  allowedWidths: readonly WidgetWidth[] | undefined;
  /** Which moves would move the card; the rest are disabled. */
  can: Record<MoveDirection, boolean>;
  /** Whether a layout write is in flight, which every action waits for. */
  disabled: boolean;
  /** Registers the menu button, so focus can be sent back to it. */
  triggerRef: (element: HTMLElement | null) => void;
  on: {
    move: (direction: MoveDirection) => void;
    setWidth: (width: WidgetWidth) => void;
    remove: () => void;
    /** ABSENT when the widget declares no settings: no item is drawn. */
    openSettings?: () => void;
  };
}

/** The four moves, in menu order, with what each is called. */
const MOVES: ReadonlyArray<{
  direction: MoveDirection;
  label: string;
  icon: ComponentType<{ "aria-hidden"?: boolean; className?: string }>;
}> = [
  { direction: "start", label: "Move to start", icon: ArrowUpToLine },
  { direction: "earlier", label: "Move earlier", icon: ArrowUp },
  { direction: "later", label: "Move later", icon: ArrowDown },
  { direction: "end", label: "Move to end", icon: ArrowDownToLine },
];

/**
 * The card's width as a short fraction, with its full name for a screen
 * reader. Shown beside the menu button while customising.
 */
export function CardWidthLabel({ width }: { width: WidgetWidth }) {
  const { name, fraction } = WIDTH_NAMES[width];
  return (
    <span
      className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-border px-1 text-xs text-muted-foreground"
      data-testid="card-width-label"
    >
      {/* The glyph is for sight; the name is what is read, so "½" is not
          announced as "one half" beside a menu that says "Half width". */}
      <span aria-hidden>{fraction}</span>
      <span className="sr-only">{name}</span>
    </span>
  );
}

/** The Width submenu: the widget's allowed widths, the drawn one checked. */
function WidthSubmenu({
  width,
  allowedWidths,
  onChoose,
}: {
  width: WidgetWidth;
  allowedWidths: readonly WidgetWidth[];
  onChoose: (width: WidgetWidth) => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid="card-width-menu">
        <MoveHorizontal aria-hidden />
        Width
        <span aria-hidden className="ml-auto text-xs text-muted-foreground">
          {WIDTH_NAMES[width].fraction}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Width
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={width}
          // Narrowed rather than asserted: the value comes back from the DOM.
          onValueChange={value => {
            if (isWidgetWidth(value)) onChoose(value);
          }}
        >
          {allowedWidths.map(option => (
            <DropdownMenuRadioItem
              key={option}
              value={option}
              data-testid={`card-width-${option}`}
            >
              {WIDTH_NAMES[option].name}
              {/* Full needs no fraction: its name already says it. */}
              {option === "full" ? null : (
                <span
                  aria-hidden
                  className="ml-auto pl-4 text-xs text-muted-foreground"
                >
                  {WIDTH_NAMES[option].fraction}
                </span>
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function CardActionsMenu({
  title,
  width,
  allowedWidths,
  can,
  disabled,
  triggerRef,
  on,
}: CardActionsMenuProps) {
  // 🔴 Set by the actions that send focus somewhere themselves -- a move back
  // to this button once it has moved, a removal to the next card, Settings to
  // its panel. The menu's own close returns focus to its trigger a tick later,
  // which would undo each of those.
  const focusIsHandled = useRef(false);
  const handled = (action: () => void) => () => {
    focusIsHandled.current = true;
    action();
  };

  return (
    // `modal={false}`: Settings opens a sheet from inside this menu, and a
    // modal menu closing underneath a dialog opening leaves the page refusing
    // pointer input.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
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
        {allowedWidths && allowedWidths.length > 0 ? (
          <WidthSubmenu
            width={width}
            allowedWidths={allowedWidths}
            onChoose={on.setWidth}
          />
        ) : null}
        {on.openSettings ? (
          <DropdownMenuItem
            onSelect={handled(on.openSettings)}
            data-testid="card-settings"
          >
            <Settings aria-hidden className="size-4" />
            Settings
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={handled(on.remove)}
          // The destructive token, highlighted or not: the one item here that
          // takes something away.
          className="text-destructive data-[highlighted]:text-destructive"
          data-testid="card-remove"
        >
          <Trash2 aria-hidden className="size-4" />
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
