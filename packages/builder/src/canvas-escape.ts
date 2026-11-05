/**
 * Who owns Escape while the editor is on screen.
 *
 * The page builder mounts as a full-screen surface INSIDE an entry form, and
 * the admin binds Escape on that form to "cancel and go back". Both use the
 * same shortcut manager, so with nothing claiming Escape for the editor the
 * form's binding wins by default — and an author who pressed Escape over a
 * canvas full of work was navigated away from the entry entirely, discarding
 * every block edit made since the editor was opened. Nothing warned them,
 * because the form was never told the document had changed.
 *
 * ## Why this is a PRIORITY question, not a depth one
 *
 * The shell renders its own `ShortcutProvider`, which the manager resolves to
 * the parent's manager when it sits on the same target — so the editor's
 * layers and the host page's layers are in ONE stack, ordered by
 * `(priority, depth, sequence)`. Depth cannot settle it: the editor's provider
 * takes the parent's depth rather than adding to it, and the host decides how
 * deeply its own shortcuts are scoped, so any depth chosen here can be tied or
 * beaten by a host that nests one scope further. `sequence` — which layer
 * registered later — happens to favour the editor today because the form is on
 * screen before the editor opens, but the manager's own documentation calls
 * equal-depth ordering incidental and says to express real requirements as
 * precedence. So this is precedence, deliberately.
 *
 * ## The editor claims it; a MODAL still outranks the editor
 *
 * Escape's meaning is "dismiss the innermost thing", which is why a rule that
 * simply took the key for the canvas would be wrong: with the command palette
 * open, Escape belongs to the palette. Rather than couple to that one
 * component, the claim stands down whenever an open dialog is in the document.
 * Any modal a host adds inherits the same deference, and there is no list to
 * keep in step with the components.
 *
 * @module canvas-escape
 */

import { deepActiveElement, isInput, isTextArea } from "./dom-kind";

/** The priority that puts the editor's claim above a host page's bindings. */
export const CANVAS_ESCAPE_PRIORITY = 1;

/**
 * Whether a modal is open, and therefore owns Escape.
 *
 * Read from the DOM rather than from editor state, because the components that
 * matter — the command palette today, whatever a host mounts tomorrow — portal
 * to the body and are outside every React tree this could subscribe to. The
 * attribute pair is what the dialog primitive already publishes, so this reads
 * a contract rather than a convention.
 */
export function modalIsOpen(root: Document | undefined): boolean {
  if (root === undefined) return false;
  return root.querySelector('[role="dialog"][data-state="open"]') !== null;
}

/**
 * Whether focus is somewhere that Escape means something else.
 *
 * A field's own dismissal — closing a combobox, abandoning an IME composition,
 * reverting an edit in progress — is what Escape means while typing, and
 * clearing the canvas selection out from under it would answer a question the
 * author did not ask.
 *
 * The claim is still made in that case, and that is the point: standing down
 * would let the keystroke fall through to the form's "cancel and go back",
 * which is the data loss this module exists to stop. So the answer here decides
 * what Escape DOES, never whether the editor consumes it.
 */
export function isTextEntry(element: Element | null): boolean {
  if (element === null) return false;
  // By tag rather than by `instanceof`: a field inside a canvas mounted in an
  // iframe was built by that window, whose constructors are not this one's.
  if (isTextArea(element)) return true;
  /*
   * `closest`, not `isContentEditable`.
   *
   * Editability is INHERITED, and a rich-text editor puts focus on whichever
   * inner node the caret is in rather than on the element carrying the
   * attribute — so reading the attribute off the focused element alone answers
   * "no" for most of the time an author is actually typing. `closest` follows
   * the inheritance the same way the browser does.
   */
  if (isEditableText(element)) return true;
  if (!isInput(element)) return false;
  // Buttons, checkboxes and radios are inputs that nobody types into, and
  // Escape over one of those is an ordinary "clear the selection".
  return !NON_TEXT_INPUT_TYPES.has(element.type);
}

/**
 * Whether `contenteditable` makes an element editable, read the way the
 * browser reads the attribute.
 *
 * The NEAREST recognised value decides: a `false` island inside editable text
 * makes a control inside it a control again. The recognised values are ASCII
 * case-insensitive (`TRUE` is `true`), and `plaintext-only` is editable too:
 * it is how the canvas's own line editor is. Any other value is the inherit
 * state, so the walk carries on outwards past it.
 */
export function isEditableText(element: Element): boolean {
  for (
    let host = element.closest("[contenteditable]");
    host !== null;
    host = host.parentElement?.closest("[contenteditable]") ?? null
  ) {
    const value = host.getAttribute("contenteditable")?.toLowerCase();
    if (value === "" || value === "true" || value === "plaintext-only") {
      return true;
    }
    if (value === "false") return false;
  }
  return false;
}

const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * Whether focus is inside something floating over the editor: a picker's
 * list, a unit menu, a select's options.
 *
 * Each closes on Escape, and the editor moving its selection on the same press
 * would do two things for one key: the list closes AND the canvas selects the
 * block's parent. Most of them mark the key as handled, which the shortcut
 * manager already honours; this covers every one that does not, by where focus
 * is rather than by a list of components. The wrapper is the one every floating
 * layer of the design system is positioned in, so a new menu inherits the rule.
 */
function inFloatingLayer(element: Element | null): boolean {
  return element?.closest("[data-radix-popper-content-wrapper]") != null;
}

/** What pressing Escape over the editor should do. */
export type EscapeOutcome =
  | "defer-to-modal"
  | "leave-to-field"
  | "navigate-selection";

/**
 * The whole rule, as one decision a test can make without a keyboard.
 *
 * `"leave-to-field"` and `"navigate-selection"` are both CONSUMED by the editor; they
 * differ only in what happens afterwards. Only `"defer-to-modal"` declines the
 * key, and it declines to something that is itself dismissing on Escape.
 *
 * **The selection is deliberately not an input.** This answers who OWNS the
 * key, and the editor owns it whether or not a block is selected — an editor
 * that released Escape once the canvas happened to have nothing selected would
 * lose the author's work in exactly the state a click on background produces.
 * What it does with the selection — up to the block holding it, or clear at
 * the top — and whether there is a selection at all are the caller's
 * questions, asked after this one.
 */
export function escapeOutcome(root: Document | undefined): EscapeOutcome {
  if (modalIsOpen(root)) return "defer-to-modal";
  // Through any focused frame: from the host, focus inside the canvas frame is
  // the iframe itself, which is no field, and Escape would deselect under an
  // author who is typing.
  const active = root === undefined ? null : deepActiveElement(root);
  // A field, or a menu or list floating over the editor: Escape belongs to
  // the focused control, and is still consumed so the page cannot take it.
  if (isTextEntry(active) || inFloatingLayer(active)) {
    return "leave-to-field";
  }
  // Moving the selection with nothing selected is a no-op that still consumes
  // the key — which is the whole point. An editor that let Escape through once
  // the canvas happened to have no selection would lose the author's work in
  // exactly the state where they had clicked away from a block before pressing
  // it.
  return "navigate-selection";
}
