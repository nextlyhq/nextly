/**
 * Holding the keyboard while something modal is over the editor.
 *
 * A focus trap keeps TAB inside a dialog and does nothing about shortcuts: the
 * canvas's bindings are registered on the document, so Delete, Mod+D and
 * Alt+Arrow still reach the page behind the modal, and Mod+K still opens the
 * command palette over it. An author correcting a name in a form can destroy
 * the block they are naming.
 *
 * One implementation, because two surfaces need it — the palette, which has had
 * it since it shipped, and any dialog the editor raises over the canvas. Written
 * twice it would agree until one of them learned something about depth, which is
 * the part that is easy to get wrong.
 *
 * @module modal-keyboard-hold
 */

import { useShortcuts } from "@nextlyhq/ui";

/**
 * Block the editor's shortcuts for as long as `active`.
 *
 * Registered at the CALLER's own depth. `useShortcuts` reads the depth from the
 * surrounding context and only a `ShortcutScope` increments it, so nothing here
 * nests the hold — and nesting is not what would make it work anyway. The host
 * chooses how deeply its own shortcuts are scoped, so any depth this picked
 * could be tied or beaten by a scope the host nests one level further.
 *
 * `priority: 1` is what carries it: the manager sorts priority ABOVE depth, so
 * the hold outranks an ordinary layer however deeply that layer sits. Priority
 * is the one axis the host does not control.
 *
 * The manager already exempts text insertion and Tab, so a form's fields and
 * its focus trap keep working underneath this.
 *
 * `name` identifies the holder in the manager's own diagnostics, which is worth
 * having now that more than one layer raises its priority: two holds at equal
 * priority fall back to depth, and a name is what tells them apart in a trace.
 */
export function useModalKeyboardHold(name: string, active: boolean): void {
  useShortcuts([], { name, enabled: active, priority: 1, blocking: true });
}
