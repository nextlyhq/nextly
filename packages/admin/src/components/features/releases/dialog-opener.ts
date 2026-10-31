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
