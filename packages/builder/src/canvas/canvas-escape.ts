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
 * ## Where the press STARTED decides what it does
 *
 * Escape moves the canvas selection only when the press starts on the canvas,
 * or with nothing focused at all. Pressed on a control in the inspector or a
 * side panel, it leaves that control instead: focus goes back to the canvas
 * and the selection stays, so the next Escape starts on the canvas and goes up
 * from there.
 *
 * The case that needed it: picking a colour variable closes the picker and
 * hands focus back to the field's button. An author pressing Escape there is
 * done with the panel, and moving the selection under them emptied the very
 * inspector they were working in. Popovers and menus that are still open
 * already answer Escape themselves (they mark it handled, which the shortcut
 * manager honours), so what was left was a press from a panel control with
 * nothing open, and that is the press this rule gives a meaning of its own.
 *
 * Read from the EVENT, never from the page afterwards: by the time a binding
 * runs, a layer that closed on the same keystroke has already moved focus, so
 * where focus is then says nothing about where the press began.
 *
 * @module canvas-escape
 */

import { isElement, isInput, isTextArea } from "./dom-kind";
import { CANVAS_FRAME_BOX_ATTRIBUTE } from "./geometry-dom";

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
 * Whether a press started inside something floating over the editor: a
 * picker's list, a unit menu, a select's options.
 *
 * Each closes on Escape, and the editor acting on the same press would do two
 * things for one key. Most of them mark the key as handled, which the shortcut
 * manager already honours; this covers every one that does not, by where the
 * press began rather than by a list of components. The wrapper is the one
 * every floating layer of the design system is positioned in, so a new menu
 * inherits the rule.
 */
function inFloatingLayer(element: Element): boolean {
  return element.closest("[data-radix-popper-content-wrapper]") !== null;
}

/**
 * Where an Escape press started, and the canvas it may have started on.
 *
 * Both halves come from outside the DOM's present state on purpose: the origin
 * from the keydown itself, and the frame from the editor's own record of the
 * canvas, so the answer cannot depend on what a closing layer did to focus
 * between the keystroke and the rule reading it.
 */
export interface EscapePress {
  /**
   * The element the keydown was dispatched on, from {@link pressOrigin};
   * `null` when it was dispatched on no element at all.
   */
  readonly origin: Element | null;
  /**
   * The frame the canvas is drawn in, or `null` while the canvas shares the
   * editor's own document and there is no separate place to send focus.
   */
  readonly canvasFrame: HTMLIFrameElement | null;
}

/**
 * The element a keydown started on.
 *
 * The composed path first, because an event leaving an open shadow root is
 * retargeted to its host, and a field inside a custom element would otherwise
 * read as the element around it. Read by node type rather than `instanceof`,
 * since a press on the canvas was built by the frame's window, whose
 * constructors are not this one's.
 */
export function pressOrigin(event: Event): Element | null {
  const path =
    typeof event.composedPath === "function" ? event.composedPath() : [];
  const first = path[0] ?? event.target;
  return isElement(first) ? first : null;
}

/**
 * Whether a press started on the canvas.
 *
 * Three places count. Anything in the frame's own document is the page
 * itself. The box holding the frame counts too: the block toolbar and the
 * canvas's own add buttons are drawn over the page in the editor's document,
 * and they act on what is selected there, so Escape on them moves the
 * selection as it does on the page beneath. And an element holding the frame:
 * the canvas's region takes focus itself while the page is zoomed past it (F6
 * stops there so the keyboard can scroll it), and it is the canvas as much as
 * the page inside it is. The body holds the frame as well, and answers the
 * same through "nothing focused".
 */
function startedOnCanvas(
  origin: Element,
  canvasFrame: HTMLIFrameElement
): boolean {
  if (origin.closest(`[${CANVAS_FRAME_BOX_ATTRIBUTE}]`) !== null) return true;
  if (origin.contains(canvasFrame)) return true;
  return origin.ownerDocument === canvasFrame.contentDocument;
}

/**
 * Whether a press started with nothing focused: the browser then delivers it
 * to the document's body, or to its root element where there is no body.
 */
function startedOnNothing(origin: Element | null): boolean {
  if (origin === null) return true;
  const owner = origin.ownerDocument;
  return origin === owner.body || origin === owner.documentElement;
}

/** What pressing Escape over the editor should do. */
export type EscapeOutcome =
  | "defer-to-modal"
  | "leave-to-field"
  | "return-to-canvas"
  | "navigate-selection";

/**
 * The whole rule, as one decision a test can make without a keyboard.
 *
 * Everything but `"defer-to-modal"` is CONSUMED by the editor, and they differ
 * only in what happens afterwards: the focused field or floating layer keeps
 * the key's meaning, focus goes back to the canvas, or the selection moves.
 * Only `"defer-to-modal"` declines the key, and it declines to something that
 * is itself dismissing on Escape.
 *
 * **The selection is deliberately not an input.** This answers who OWNS the
 * key, and the editor owns it whether or not a block is selected — an editor
 * that released Escape once the canvas happened to have nothing selected would
 * lose the author's work in exactly the state a click on background produces.
 * What it does with the selection — up to the block holding it, or clear at
 * the top — and whether there is a selection at all are the caller's
 * questions, asked after this one.
 */
export function escapeOutcome(
  root: Document | undefined,
  press: EscapePress
): EscapeOutcome {
  if (modalIsOpen(root)) return "defer-to-modal";
  const { origin, canvasFrame } = press;
  // A field, or a menu or list floating over the editor: Escape belongs to
  // that control, and is still consumed so the page cannot take it. A field
  // on the canvas, such as a block's text being edited in place, is the same:
  // its own Escape finishes the edit.
  if (origin !== null && (isTextEntry(origin) || inFloatingLayer(origin))) {
    return "leave-to-field";
  }
  // On the canvas, or with nothing focused: the selection moves. Moving it
  // with nothing selected is a no-op that still consumes the key — which is
  // the whole point, since an editor that let Escape through there would lose
  // the author's work in exactly the state where they had clicked away from a
  // block before pressing it. With no frame there is nowhere separate to send
  // focus, so every press moves the selection, as it always has.
  if (
    canvasFrame === null ||
    startedOnNothing(origin) ||
    (origin !== null && startedOnCanvas(origin, canvasFrame))
  ) {
    return "navigate-selection";
  }
  // On a control anywhere else in the editor, with nothing open: the press
  // leaves the control, and the selection stays for the next one.
  return "return-to-canvas";
}

/**
 * The attribute the canvas's frame carries while focus has been brought back
 * to it from the keyboard, which the editor's stylesheet draws as a focus
 * outline.
 *
 * An attribute rather than `:focus-visible` because, while focus is inside a
 * frame, the browser matches the frame element only with `:focus-within`, and
 * that holds after a click into the page just as much: drawn from it, every
 * click on a block would show a keyboard outline.
 */
export const CANVAS_KEYBOARD_FOCUS_ATTRIBUTE = "data-nx-keyboard-focus";

/**
 * Send focus back to the canvas's frame, and show that it went there.
 *
 * Without scrolling, because an author who has scrolled the canvas to the
 * block they are styling would otherwise be thrown back to the frame's top
 * edge. The outline stays while the keyboard works the canvas and goes when
 * focus leaves the frame or a pointer is pressed in it, which is when
 * `:focus-visible` would stop matching too.
 */
export function returnFocusToCanvas(canvasFrame: HTMLIFrameElement): void {
  canvasFrame.focus({ preventScroll: true });
  // Marked only once focus has really landed: an outline with no focus behind
  // it would never see the blur that clears it.
  if (canvasFrame.ownerDocument.activeElement !== canvasFrame) return;
  if (canvasFrame.hasAttribute(CANVAS_KEYBOARD_FOCUS_ATTRIBUTE)) return;
  canvasFrame.setAttribute(CANVAS_KEYBOARD_FOCUS_ATTRIBUTE, "");
  const page = canvasFrame.contentDocument;
  const clear = (): void => {
    canvasFrame.removeAttribute(CANVAS_KEYBOARD_FOCUS_ATTRIBUTE);
    canvasFrame.removeEventListener("blur", clear);
    page?.removeEventListener("pointerdown", clear, true);
  };
  canvasFrame.addEventListener("blur", clear);
  page?.addEventListener("pointerdown", clear, true);
}
