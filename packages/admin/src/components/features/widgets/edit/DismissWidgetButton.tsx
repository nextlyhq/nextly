"use client";

/**
 * The control that sends one card away, on the card, outside edit mode.
 *
 * ## Why a card carries its own control rather than borrowing edit mode's
 *
 * Hiding any card is already possible from `WidgetEditControls`, and that is
 * the wrong route for the cards this control is for. A first-run card addresses
 * a reader who has just arrived and has no reason to know the dashboard can be
 * edited, so routing "I am done with this" through a mode they must discover
 * first means the card stays until they finish the work it describes. Shopify's
 * Setup Guide, Strapi's guided tour and this admin's own `SeedDemoContentCard`
 * all put dismiss on the card for the same reason.
 *
 * It is drawn only where the WIDGET declared `dismissible`. The capability is
 * the declaration's to grant: a permanent card sent away by one click, with the
 * way back inside a mode the reader never opened, is a dashboard that loses
 * cards.
 *
 * ## Always visible, never revealed on hover
 *
 * 🔴 No `opacity-0 group-hover:opacity-100`. A control revealed on hover is
 * unreachable by touch, invisible to a keyboard reader who has tabbed onto it,
 * and absent for anyone who does not think to point at the card — and this one
 * is the only route out of the card for a reader not in edit mode.
 *
 * @module components/features/widgets/edit/DismissWidgetButton
 */

import { Button } from "@nextlyhq/ui";

import * as Icons from "@admin/components/icons";

export interface DismissWidgetButtonProps {
  /** What the reader calls this card, which the label names. */
  title: string;
  onDismiss: () => void;
}

export function DismissWidgetButton({
  title,
  onDismiss,
}: DismissWidgetButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      // Top RIGHT is free here by construction: the drag handle takes the left
      // and renders only while editing, which is exactly when this does not.
      className="absolute right-2 top-2 z-10 size-7 text-muted-foreground hover:text-foreground"
      onClick={onDismiss}
      // Names the CARD and what dismissing costs. Several cards can carry this
      // control, so "Dismiss" alone is the same label repeated down a column --
      // and a reader deciding whether to press it needs to know the card is
      // recoverable rather than gone.
      aria-label={`Dismiss ${title}. You can bring it back by editing the dashboard.`}
      // Marks this as the cell's own chrome rather than the widget's body, so
      // a cell holding nothing else still collapses. The cell's class names the
      // attribute; renaming it here alone would reinstate the blank row.
      data-widget-chrome=""
      data-testid="widget-dismiss"
    >
      <Icons.X aria-hidden className="size-4" />
    </Button>
  );
}
