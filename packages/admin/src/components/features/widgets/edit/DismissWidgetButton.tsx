"use client";

/**
 * The control that sends one card away, on the card, outside edit mode.
 *
 * ## Why a card carries its own control rather than borrowing edit mode's
 *
 * Removing any card is already possible from its menu in customise mode, and
 * that is the wrong route for the cards this control is for. A first-run card addresses
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
 * ## Offered only where the way back is
 *
 * 🔴 `md` and up, the SAME breakpoint `DashboardEditBar` uses for the control
 * that begins customising. Customise mode is the lasting route to putting a
 * removed card back, so on a narrower screen this button's own promise — bring
 * it back from Customize — is one the product cannot keep once the Undo notice
 * is gone. A control that can act but cannot be undone is worse than none.
 *
 * ## Unavailable, with the reason, while the stored layout is unreadable
 *
 * The server refuses every single-card write to a stored arrangement it could
 * not read. The control stays on the card and says why it cannot act, rather
 * than vanishing and leaving the reader to wonder where it went.
 *
 * @module components/features/widgets/edit/DismissWidgetButton
 */

import { Button } from "@nextlyhq/ui";
import type { JSX } from "react";
import { useId } from "react";

import * as Icons from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

export interface DismissWidgetButtonProps {
  /** What the reader calls this card, which the label names. */
  title: string;
  /**
   * Whether a dismissal is already in flight — on THIS card or any other.
   *
   * 🔴 Shared rather than per-card, because the write is a whole-layout
   * snapshot taken against one cached version. Two dismissals in flight carry
   * the same guard, so the server can honour only one and the other comes back
   * as a conflict the reader never caused.
   */
  isDismissing: boolean;
  /**
   * Why the control cannot act right now, or absent when it can.
   *
   * Present, the button stays focusable and announces the reason instead of
   * acting: `aria-disabled` rather than `disabled`, because a disabled button
   * leaves the Tab order and its reason with it.
   */
  unavailableReason?: string;
  /**
   * Whether the cell positions this control itself.
   *
   * A framed card places it in its own header, where space is reserved. An
   * unframed one has no header to place it in, so the cell floats it in the
   * corner the drag handle leaves free while not customising.
   */
  floating?: boolean;
  /** Registers the button, so focus can return here after an Undo. */
  buttonRef?: (element: HTMLElement | null) => void;
  onDismiss: () => void;
}

export function DismissWidgetButton({
  title,
  isDismissing,
  unavailableReason,
  floating = false,
  buttonRef,
  onDismiss,
}: DismissWidgetButtonProps): JSX.Element {
  const reasonId = useId();
  const unavailable = unavailableReason !== undefined;
  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          "size-7 text-muted-foreground hover:text-foreground",
          // Hidden below `md`, where nothing lasting can bring the card back.
          // `hidden` rather than `disabled`: a control that is present and
          // refuses says the capability exists and is unavailable, and here it
          // simply does not apply at that width.
          "hidden md:inline-flex",
          unavailable && "cursor-not-allowed opacity-50",
          // Floated only where no header reserved space for it. Top RIGHT is
          // free by construction while not customising: the drag handle takes
          // the left and renders only while customising.
          floating && "absolute right-2 top-2 z-10"
        )}
        disabled={isDismissing}
        aria-disabled={unavailable || undefined}
        aria-describedby={unavailable ? reasonId : undefined}
        title={unavailableReason}
        onClick={unavailable ? undefined : onDismiss}
        // Names the CARD and what dismissing costs. Several cards can carry
        // this control, so "Dismiss" alone is the same label repeated down the
        // page -- and a reader deciding whether to press it needs to know the
        // card is recoverable rather than gone.
        aria-label={`Dismiss ${title}. You can bring it back from Customize.`}
        // Marks this as the cell's own chrome rather than the widget's body, so
        // a cell holding nothing else still collapses. The cell's class names
        // the attribute; renaming it here alone would reinstate the blank row.
        data-widget-chrome=""
        data-testid="widget-dismiss"
      >
        <Icons.X aria-hidden className="size-4" />
      </Button>
      {unavailable ? (
        <span id={reasonId} className="sr-only">
          {unavailableReason}
        </span>
      ) : null}
    </>
  );
}
