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

import * as Icons from "@admin/components/icons";

export interface WidgetEditControlsProps {
  /** What the reader calls this card, so every label can name it. */
  title: string;
  position: number;
  count: number;
  hidden: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleHidden: () => void;
  onRemove: () => void;
}

export function WidgetEditControls({
  title,
  position,
  count,
  hidden,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onToggleHidden,
  onRemove,
}: WidgetEditControlsProps) {
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

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={onMoveUp}
        disabled={!canMoveUp}
        // The position travels in the label, because a reader who has just
        // moved a card needs to know where it landed and the visible grid does
        // not say it. `aria-label` rather than `title`: a title is not reliably
        // announced and is unreachable by touch.
        aria-label={`Move ${title} up, currently position ${position} of ${count}`}
        data-testid="widget-move-up"
      >
        <Icons.ChevronUp aria-hidden className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={onMoveDown}
        disabled={!canMoveDown}
        aria-label={`Move ${title} down, currently position ${position} of ${count}`}
        data-testid="widget-move-down"
      >
        <Icons.ChevronDown aria-hidden className="size-4" />
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={onToggleHidden}
        // Names the OUTCOME, and says what hiding preserves. "Hide" alone reads
        // as a synonym for "remove" to somebody deciding between the two.
        aria-label={
          hidden
            ? `Show ${title} again, in the position it was hidden from`
            : `Hide ${title}, keeping its position and settings`
        }
        data-testid="widget-toggle-hidden"
      >
        {hidden ? (
          <Icons.Eye aria-hidden className="size-4" />
        ) : (
          <Icons.EyeOff aria-hidden className="size-4" />
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        aria-label={`Remove ${title} from the dashboard, losing its position and settings`}
        data-testid="widget-remove"
      >
        <Icons.X aria-hidden className="size-4" />
      </Button>
    </div>
  );
}
