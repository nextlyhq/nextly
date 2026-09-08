"use client";

/**
 * What a reader can do to one card while editing: move it, put it away, or
 * take it off.
 *
 * ## The buttons are not a convenience
 *
 * 🔴 WCAG 2.2 SC 2.5.7 (Dragging Movements, AA) requires that anything achieved
 * by dragging can also be achieved with a SINGLE POINTER — a click or a tap. A
 * keyboard alternative does not satisfy it; that is 2.1.1, a different
 * criterion, and the Understanding document says so in as many words. dnd-kit's
 * `KeyboardSensor` therefore closes the keyboard gap and leaves this one wide
 * open, which is how every other drag surface in this admin is currently
 * non-conforming.
 *
 * Move up / Move down are pointer-clickable AND keyboard-reachable, so one pair
 * of controls answers both criteria. They are the reason the drag handle is
 * allowed to exist at all.
 *
 * ## Hide and remove are different, and the wording carries the difference
 *
 * Hiding KEEPS the placement — its position and its settings survive, so
 * unhiding restores the card where it was. Removing drops it, and adding it
 * back later appends a fresh one at the end. Two similar-sounding actions are
 * exactly the pair a reader can confuse, so each label names the consequence
 * rather than the gesture.
 *
 * @module components/features/widgets/edit/WidgetEditControls
 */

import { Button } from "@nextlyhq/ui";
import type { ComponentType } from "react";

import * as Icons from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

/**
 * One control in the toolbar: an icon, a label, and what it does.
 *
 * Every control here is the same button wearing a different icon, and spelling
 * that button out seven times put the component's shape in the way of what it
 * actually offers — a reader counting the controls had to read past four
 * identical presentation props each time to find the next one. Named so the
 * toolbar below reads as the list of affordances it is.
 *
 * The label is REQUIRED rather than optional: each of these is an icon alone,
 * so a missing label leaves a control a screen reader announces as "button".
 */
function ControlButton({
  icon: Icon,
  label,
  testId,
  onClick,
  disabled,
  className,
}: {
  icon: ComponentType<{ "aria-hidden"?: boolean; className?: string }>;
  label: string;
  testId: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("size-7", className)}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-testid={testId}
    >
      <Icon aria-hidden className="size-4" />
    </Button>
  );
}

export interface WidgetEditControlsProps {
  /**
   * What this card is called and where it sits, which every label names.
   *
   * Grouped rather than listed one field at a time: the six travel together
   * because every one of them exists to be said aloud — "Move Posts up,
   * currently position 2 of 5, column 1 of 3" is assembled from all of them,
   * and spreading them across the signature hid that they are one sentence.
   */
  card: {
    title: string;
    position: number;
    count: number;
    /** Which column this card is in, 1-based, for what the labels announce. */
    column: number;
    columnCount: number;
    hidden: boolean;
  };
  /**
   * Which moves are available.
   *
   * `moveAffordance` and `columnAffordance` already answer in exactly this
   * shape; unpacking their pairs only to list the four separately put a
   * spelling between the caller and the helper that decides.
   */
  can: { up: boolean; down: boolean; left: boolean; right: boolean };
  /**
   * What each control does.
   *
   * 🔴 `openSettings` is ABSENT rather than disabled when a widget declares no
   * settings. A disabled control tells a reader something exists that they
   * cannot reach and does not say why; a widget with no settings has nothing
   * to reach, so the honest affordance is no button.
   */
  on: {
    moveUp: () => void;
    moveDown: () => void;
    moveLeft: () => void;
    moveRight: () => void;
    toggleHidden: () => void;
    remove: () => void;
    openSettings?: () => void;
  };
}

/**
 * Sideways moves, which only exist on a multi-column dashboard.
 *
 * Its own component because the whole group is conditional, and a conditional
 * wrapping half a component's JSX is what pushes the parent past what a reader
 * can hold — the parent now reads as a flat list of controls, which is what it
 * is.
 */
function ColumnMoveControls({
  title,
  column,
  columnCount,
  canMoveLeft,
  canMoveRight,
  onMoveLeft,
  onMoveRight,
}: {
  title: string;
  column: number;
  columnCount: number;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMoveLeft: () => void;
  onMoveRight: () => void;
}) {
  if (columnCount <= 1) return null;
  return (
    <>
      <ControlButton
        icon={Icons.ChevronLeft}
        // The column travels in the label for the same reason the position
        // does: the grid does not say which column a card landed in, and a
        // reader who just moved one needs to know.
        label={`Move ${title} to the previous column, currently column ${column} of ${columnCount}`}
        testId="widget-move-left"
        onClick={onMoveLeft}
        disabled={!canMoveLeft}
      />
      <ControlButton
        icon={Icons.ChevronRight}
        label={`Move ${title} to the next column, currently column ${column} of ${columnCount}`}
        testId="widget-move-right"
        onClick={onMoveRight}
        disabled={!canMoveRight}
      />
    </>
  );
}

export function WidgetEditControls({ card, can, on }: WidgetEditControlsProps) {
  const { title, position, count, column, columnCount, hidden } = card;
  /*
   * Both halves of the hide control resolved BEFORE the JSX, rather than as two
   * ternaries inside it. The pair says one thing — which direction this control
   * currently goes — and reading it as a branch in the icon and a second,
   * identical branch in the label made the toolbar's shape depend on a decision
   * that is really about a single word.
   */
  const hiddenLabel = hidden
    ? `Show ${title} again, in the position it was hidden from`
    : `Hide ${title}, keeping its position and settings`;
  const HiddenIcon = hidden ? Icons.Eye : Icons.EyeOff;

  return (
    <div
      // `pl-9` reserves the drag handle's column. The handle is absolutely
      // positioned over this toolbar, so without reserved space it sits ON the
      // first thing here rather than beside it.
      className="flex items-center gap-1 border-b border-border bg-muted/40 py-1 pl-9 pr-2"
      data-testid="widget-edit-controls"
    >
      {/* The name first, so a reader tabbing through a dozen identical control
          groups can tell which card they are on without leaving the group. */}
      <span className="mr-auto truncate text-xs font-medium text-muted-foreground">
        {title}
        <span className="sr-only">{`, position ${position} of ${count}`}</span>
      </span>

      <ControlButton
        icon={Icons.ChevronUp}
        // The position travels in the label, because a reader who has just
        // moved a card needs to know where it landed and the visible grid does
        // not say it. `aria-label` rather than `title`: a title is not reliably
        // announced and is unreachable by touch.
        label={`Move ${title} up, currently position ${position} of ${count}`}
        testId="widget-move-up"
        onClick={on.moveUp}
        disabled={!can.up}
      />
      <ControlButton
        icon={Icons.ChevronDown}
        label={`Move ${title} down, currently position ${position} of ${count}`}
        testId="widget-move-down"
        onClick={on.moveDown}
        disabled={!can.down}
      />

      {/* 🔴 Crossing columns is reachable by CLICK, not only by dragging.
          Dragging a card into another column is new functionality, and SC
          2.5.7 asks for a single-pointer route to anything a drag achieves --
          so these are the conformance rather than a convenience, exactly as
          Move up / Move down are for ordering.

          Rendered only where there is more than one column, because a control
          that can never be enabled is noise in a toolbar a reader tabs
          through. */}
      <ColumnMoveControls
        title={title}
        column={column}
        columnCount={columnCount}
        canMoveLeft={can.left}
        canMoveRight={can.right}
        onMoveLeft={on.moveLeft}
        onMoveRight={on.moveRight}
      />

      <ControlButton
        icon={HiddenIcon}
        // Names the OUTCOME, and says what hiding preserves. "Hide" alone reads
        // as a synonym for "remove" to somebody deciding between the two.
        label={hiddenLabel}
        testId="widget-toggle-hidden"
        onClick={on.toggleHidden}
      />
      {on.openSettings ? (
        <ControlButton
          icon={Icons.Settings}
          // Names the CARD, because several cards carry this control and a
          // screen reader hears them in sequence — "Settings" alone would be
          // the same label repeated down the column.
          label={`Settings for ${title}, applying to this card only`}
          testId="widget-open-settings"
          onClick={on.openSettings}
        />
      ) : null}
      <ControlButton
        icon={Icons.X}
        label={`Remove ${title} from the dashboard, losing its position and settings`}
        testId="widget-remove"
        onClick={on.remove}
        className="text-muted-foreground hover:text-destructive"
      />
    </div>
  );
}
