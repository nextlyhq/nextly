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
 * Registered one scope DEEPER than a host's, and above its depth rather than
 * merely deep: layers at equal depth are ordered by registration, so whether
 * the modal wins would otherwise depend on whether the host mounted its
 * shortcuts first. `priority: 1` settles it however deeply a host scoped its
 * own.
 *
 * The manager already exempts text insertion and Tab, so a form's fields and
 * its focus trap keep working underneath this.
 *
 * `name` identifies the holder in the manager's own diagnostics, so two modals
 * open at once are told apart by something other than their depth.
 */
export function useModalKeyboardHold(name: string, active: boolean): void {
  useShortcuts([], { name, enabled: active, priority: 1, blocking: true });
}
