/**
 * Where focus goes as a card's settings panel closes, whether the panel had loaded or was still
 * standing in for it (`LazyWidgetSettingsSheet`): the control the panel was opened from, as the
 * card draws it now. The menu or popover item that opened it has closed itself by then, so left
 * to the sheet, focus would go to a removed node and be lost.
 *
 * Its own module, so the stand-in, drawn before the panel's code arrives, takes the same rule
 * without loading that code.
 *
 * @module components/features/widgets/edit/panel-close-focus
 */

/**
 * The sheet's close handler: focus on `returnFocusTo()`'s control, or, where it names none, the
 * sheet's own choice.
 */
export function closeFocusTo(
  returnFocusTo: (() => HTMLElement | null) | undefined
): (event: Event) => void {
  return event => {
    const target = returnFocusTo?.();
    if (!target) return;
    event.preventDefault();
    target.focus();
  };
}
