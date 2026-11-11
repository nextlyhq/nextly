/**
 * The setup card's buttons, one size for every step's line, its Singles and its sample-content
 * panel: 28 px tall, over the 24 px a target may be at least, with a control's border so each
 * reads as a button at 3:1 against the card in both themes, never as underlined text.
 *
 * @module components/features/dashboard/setup/step-buttons
 */

/** A step's own action: Create, Add entry, Show, Invite, Fill in, Add samples. */
export const STEP_BUTTON =
  "h-7 shrink-0 rounded-[7px] border-control-border bg-card px-2.5 text-[12.5px] font-medium";

/** A step's quieter action beside it: Skip, Restore, No thanks. */
export const STEP_GHOST_BUTTON =
  "h-7 shrink-0 rounded-[7px] px-2.5 text-[12.5px] font-medium text-muted-foreground hover:text-foreground";
