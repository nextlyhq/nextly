/**
 * The control a dialog hands focus back to when it closes.
 *
 * A dialog opened from a menu row has lost its opener by the time it closes:
 * the row went with the menu, and focus would fall to the top of the page,
 * leaving a keyboard user to find their place again. The menu's own trigger
 * is the control they reached it from, and Radix names a menu by its trigger
 * (`aria-labelledby`), so that is where focus goes back to.
 *
 * Anything other than a menu row is its own opener: a button in the panel
 * stays on screen and takes focus back as it is.
 *
 * @module components/features/releases/dialog-opener
 */
export function dialogOpenerOf(active: Element | null): HTMLElement | null {
  if (!(active instanceof HTMLElement)) return null;
  const menu = active.closest('[role="menu"]');
  if (menu === null) return active;
  const triggerId = menu.getAttribute("aria-labelledby");
  const trigger =
    triggerId === null ? null : active.ownerDocument.getElementById(triggerId);
  return trigger instanceof HTMLElement ? trigger : null;
}

/**
 * Focus the opener on close, where it is still on the page; otherwise leave
 * the dialog's own handling alone.
 */
export function returnFocusTo(opener: HTMLElement | null, event: Event): void {
  if (opener === null || !opener.isConnected) return;
  event.preventDefault();
  opener.focus();
}

/**
 * Where focus goes once a schedule has landed: the place that shows its
 * outcome, where the opener sits inside one, otherwise the opener.
 *
 * The Publishing section's own offer is drawn under "Not scheduled." and so
 * goes the moment the new release shows, taking focus with it to the top of
 * the page. The section itself stays, and names the release next.
 */
export function focusAfterScheduling(
  opener: HTMLElement | null
): HTMLElement | null {
  const outcome = opener?.closest(`[${SCHEDULE_OUTCOME_ATTRIBUTE}]`);
  return outcome instanceof HTMLElement ? outcome : opener;
}

/** Marks the element that shows a schedule's outcome and can take focus. */
export const SCHEDULE_OUTCOME_ATTRIBUTE = "data-schedule-outcome";
