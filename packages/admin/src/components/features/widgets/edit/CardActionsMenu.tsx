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
 * and the card's size is shown beside it in columns by rows, so the reader can
 * see what the Width and Height submenus will change without opening them.
 *
 * ## Sizes within the widget's bounds, and only those
 *
 * The widths offered are the common steps (3, 4, 6, 8 and 12 columns) that lie
 * within the widget's bounds, and the bounds' own ends; the heights are every
 * one the bounds allow. A card can never be resized past its bounds from here,
 * and the editor refuses one that is (`setPlacementSize`).
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
  MoveVertical,
  Settings,
  Trash2,
} from "lucide-react";
import type { GridSize, WidgetSizeBounds } from "nextly/config";
import { useRef, type ComponentType, type JSX } from "react";

import * as Icons from "@admin/components/icons";

import type { MoveDirection } from "../layout-editor";
import {
  heightChoices,
  rowsName,
  sizeName,
  widthChoiceName,
  widthChoices,
} from "../sizes";

export interface CardActionsMenuProps {
  /** What the reader calls this card, which the button's name says. */
  title: string;
  /** The size the card is DRAWN at, which the Width and Height choices check. */
  size: GridSize;
  /** Its widget's bounds, which the choices are taken from. */
  bounds: WidgetSizeBounds;
  /** Which moves would move the card; the rest are disabled. */
  can: Record<MoveDirection, boolean>;
  /** Whether a layout write is in flight, which every action waits for. */
  disabled: boolean;
  /** Registers the menu button, so focus can be sent back to it. */
  triggerRef: (element: HTMLElement | null) => void;
  /** Lists the sizes in the menu itself rather than in submenus: where it draws one column. */
  sizesInPlace?: boolean;
  on: {
    move: (direction: MoveDirection) => void;
    setSize: (size: GridSize) => void;
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
 * The card's size as columns by rows, with its full name for a screen reader.
 * Shown beside the menu button while customising.
 */
export function CardSizeLabel({ size }: { size: GridSize }): JSX.Element {
  return (
    <span
      className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-border px-1 text-xs tabular-nums text-muted-foreground"
      data-testid="card-size-label"
    >
      {/* The glyphs are for sight; the name is what is read, so "6×4" is not
          announced as "six times four" beside a menu that says "6 columns". */}
      <span aria-hidden>
        {size.w}×{size.h}
      </span>
      <span className="sr-only">{sizeName(size)}</span>
    </span>
  );
}

/** One direction of the card's size: what it is called, its choices and how each reads. */
interface SizeAxis {
  kind: "width" | "height";
  label: string;
  icon: ComponentType<{ "aria-hidden"?: boolean; className?: string }>;
  /** The value the card is drawn at in this direction. */
  value: number;
  choices: number[];
  /** How a choice reads: its label, a detail beneath it, and the whole name it is announced by. */
  name: (value: number) => { label: string; detail?: string; spoken: string };
  choose: (value: number) => void;
}

/** One direction's choices under its label, the drawn one checked. */
function AxisChoices({ axis }: { axis: SizeAxis }) {
  return (
    <>
      <DropdownMenuLabel className="text-xs text-muted-foreground">
        {axis.label}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={String(axis.value)}
        // Narrowed rather than asserted: the value comes back from the DOM, and
        // only a value this menu offered is chosen.
        onValueChange={value => {
          const chosen = Number(value);
          if (axis.choices.includes(chosen)) axis.choose(chosen);
        }}
      >
        {axis.choices.map(option => {
          const name = axis.name(option);
          return (
            <DropdownMenuRadioItem
              key={option}
              value={String(option)}
              data-testid={`card-${axis.kind}-${option}`}
              aria-label={name.spoken}
            >
              {name.detail === undefined ? (
                name.label
              ) : (
                // The share first and the columns beneath it, for sight. Hidden
                // from screen readers: the item's label already says both.
                <span aria-hidden className="flex flex-col leading-tight">
                  <span>{name.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {name.detail}
                  </span>
                </span>
              )}
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
    </>
  );
}

/**
 * One direction's choices, as a submenu, or in place in the card menu itself.
 *
 * In place where the dashboard draws one column: on a phone the card menu sits mid-screen, and
 * a submenu beside it has room on neither side, so it was drawn partly off the screen. In place,
 * the choices share the menu's own box, which already fits.
 */
function AxisSection({ axis, inPlace }: { axis: SizeAxis; inPlace: boolean }) {
  if (inPlace) return <AxisChoices axis={axis} />;
  const Icon = axis.icon;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid={`card-${axis.kind}-menu`}>
        <Icon aria-hidden />
        {axis.label}
        <span aria-hidden className="ml-auto text-xs text-muted-foreground">
          {axis.value}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <AxisChoices axis={axis} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * The directions a card may be resized in: each whose bounds offer more than the one size it
 * has, so a widget of one fixed height offers no Height at all.
 */
function sizeAxes(
  size: GridSize,
  bounds: WidgetSizeBounds,
  setSize: (size: GridSize) => void
): SizeAxis[] {
  const axes: SizeAxis[] = [
    {
      kind: "width",
      label: "Width",
      icon: MoveHorizontal,
      value: size.w,
      choices: widthChoices(bounds, size.w),
      name: widthChoiceName,
      // The other direction kept as drawn, which already lies within the bounds.
      choose: w => setSize({ w, h: size.h }),
    },
    {
      kind: "height",
      label: "Height",
      icon: MoveVertical,
      value: size.h,
      choices: heightChoices(bounds),
      name: h => ({ label: rowsName(h), spoken: rowsName(h) }),
      choose: h => setSize({ w: size.w, h }),
    },
  ];
  return axes.filter(axis => axis.choices.length > 1);
}

export function CardActionsMenu({
  title,
  size,
  bounds,
  can,
  disabled,
  triggerRef,
  sizesInPlace = false,
  on,
}: CardActionsMenuProps): JSX.Element {
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
        {sizeAxes(size, bounds, on.setSize).map(axis => (
          <AxisSection key={axis.kind} axis={axis} inPlace={sizesInPlace} />
        ))}
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
