// @vitest-environment jsdom

/**
 * Who owns Escape, decided without a keyboard.
 *
 * The property that matters is not "Escape deselects" — it is that the editor
 * CONSUMES the key in every state except an open modal. A rule that declined it
 * in any other case would let the keystroke reach the entry form's "cancel and
 * go back", which discards the author's uncommitted blocks, so the cases below
 * are written to catch a rule that stands down too readily.
 *
 * @module canvas-escape.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { escapeOutcome, isTextEntry, modalIsOpen } from "./canvas-escape";

afterEach(() => {
  document.body.innerHTML = "";
});

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  const first = document.body.firstElementChild;
  if (!(first instanceof HTMLElement)) throw new Error("expected an element");
  return first;
}

describe("modalIsOpen", () => {
  it("sees an open dialog", () => {
    mount('<div role="dialog" data-state="open"></div>');
    expect(modalIsOpen(document)).toBe(true);
  });

  it("ignores a CLOSED dialog left in the document", () => {
    // The dialog primitive keeps a closed dialog mounted. A rule that matched
    // the role alone would hand Escape to a component that is not on screen,
    // and the canvas would stop deselecting for the rest of the session.
    mount('<div role="dialog" data-state="closed"></div>');
    expect(modalIsOpen(document)).toBe(false);
  });

  it("answers false with no document at all", () => {
    // A server render has no DOM, and the editor's bindings are registered
    // before the first paint.
    expect(modalIsOpen(undefined)).toBe(false);
  });
});

describe("isTextEntry", () => {
  it("recognises the things people type into", () => {
    expect(isTextEntry(mount("<textarea></textarea>"))).toBe(true);
    expect(isTextEntry(mount('<input type="text" />'))).toBe(true);
    expect(isTextEntry(mount('<input type="search" />'))).toBe(true);
    // No `type` at all is a text input.
    expect(isTextEntry(mount("<input />"))).toBe(true);
    const editable = mount('<div contenteditable="true"></div>');
    expect(isTextEntry(editable)).toBe(true);
  });

  it("follows editability down to the node the caret is actually in", () => {
    /*
     * Where the first version of this was wrong. A rich-text editor puts focus
     * on the inner node holding the caret, not on the element carrying the
     * attribute, so reading it off the focused element answers "no" for most of
     * the time someone is typing. `isContentEditable` would have covered this
     * in a browser and silently answered false in jsdom, so the case would have
     * looked tested and not been.
     */
    const editable = mount(
      '<div contenteditable="true"><p><span id="deep">x</span></p></div>'
    );

    expect(isTextEntry(editable.querySelector("#deep"))).toBe(true);
  });

  it("does not count an explicitly NON-editable region", () => {
    expect(isTextEntry(mount('<div contenteditable="false"></div>'))).toBe(
      false
    );
  });

  it("does NOT count inputs nobody types into", () => {
    // The control. Without it "is it an input" would pass every case above
    // while making Escape inert over a checkbox, which is an ordinary
    // deselect.
    expect(isTextEntry(mount('<input type="checkbox" />'))).toBe(false);
    expect(isTextEntry(mount('<input type="radio" />'))).toBe(false);
    expect(isTextEntry(mount('<input type="button" />'))).toBe(false);
  });

  it("answers false for a plain element and for nothing", () => {
    expect(isTextEntry(mount("<div></div>"))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});

describe("escapeOutcome", () => {
  it("defers to an open modal, which is dismissing on the same key", () => {
    mount('<div role="dialog" data-state="open"></div>');
    expect(escapeOutcome(document)).toBe("defer-to-modal");
  });

  it("leaves the key to a field, without releasing it to the page", () => {
    const field = mount('<input type="text" />') as HTMLInputElement;
    field.focus();
    expect(escapeOutcome(document)).toBe("leave-to-field");
  });

  it("claims the key whenever nothing else is", () => {
    /*
     * Note what is NOT a parameter: the selection. There may be nothing to
     * deselect, and the editor still owns the key — which is precisely the
     * state an author is in after clicking canvas background, one click away
     * from any block. A rule written around what Escape ACHIEVES would release
     * it there, and the keystroke would reach the entry form's cancel and take
     * every uncommitted block edit with it.
     */
    expect(escapeOutcome(document)).toBe("deselect");
  });

  it("prefers the modal over a field inside it", () => {
    // A palette is a dialog containing a search input, so both conditions hold
    // at once and the order they are asked in decides. The modal wins: its own
    // Escape closes it, and consuming the key for the canvas would strand it
    // open.
    const dialog = mount(
      '<div role="dialog" data-state="open"><input type="text" /></div>'
    );
    const field = dialog.querySelector("input");
    field?.focus();

    expect(escapeOutcome(document)).toBe("defer-to-modal");
  });
});
