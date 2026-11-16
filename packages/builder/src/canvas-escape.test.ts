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

import {
  escapeOutcome,
  isTextEntry,
  modalIsOpen,
  pressOrigin,
  returnFocusToCanvas,
  CANVAS_KEYBOARD_FOCUS_ATTRIBUTE,
} from "./canvas-escape";
import { CANVAS_FRAME_BOX_ATTRIBUTE } from "./geometry-dom";

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
    // A control inside a non-editable island in editable text is a control
    // again: the NEAREST contenteditable decides, as the browser's does.
    const island = mount(
      '<div contenteditable="true"><span contenteditable="false"><button>Go</button></span></div>'
    );
    expect(isTextEntry(island.querySelector("button"))).toBe(false);
    // The canvas's own line editor is plain-text-only editable.
    expect(
      isTextEntry(mount('<span contenteditable="plaintext-only"></span>'))
    ).toBe(true);
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

  it("reads contenteditable's values as the browser does: any case, and an unknown one inherits", () => {
    // Recognised values are ASCII case-insensitive.
    for (const value of ["TRUE", "True", "PlainText-Only"]) {
      expect(
        isTextEntry(mount(`<div contenteditable="${value}"></div>`)),
        value
      ).toBe(true);
    }
    // An unrecognised value is the inherit state: inside editable text it is
    // editable, and on its own it is not.
    const inherited = mount(
      '<div contenteditable="true"><span contenteditable="yes"><b id="in">x</b></span></div>'
    );
    expect(isTextEntry(inherited.querySelector("#in"))).toBe(true);
    expect(isTextEntry(mount('<div contenteditable="yes"></div>'))).toBe(false);
    // `FALSE` is still false, and stops the walk outwards.
    const island = mount(
      '<div contenteditable="true"><span contenteditable="FALSE"><button>Go</button></span></div>'
    );
    expect(isTextEntry(island.querySelector("button"))).toBe(false);
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

/**
 * The canvas's frame, as the shell places it: inside the box that also holds
 * the chrome drawn over the page, in the editor's document.
 */
function canvasFrame(): HTMLIFrameElement {
  const box = document.createElement("div");
  box.setAttribute(CANVAS_FRAME_BOX_ATTRIBUTE, "");
  const frame = document.createElement("iframe");
  box.append(frame);
  document.body.append(box);
  return frame;
}

/** A press starting on `origin`, with or without a canvas frame to return to. */
function outcomeFrom(
  origin: Element | null,
  frame: HTMLIFrameElement | null = null
): ReturnType<typeof escapeOutcome> {
  return escapeOutcome(document, { origin, canvasFrame: frame });
}

describe("escapeOutcome", () => {
  it("defers to an open modal, which is dismissing on the same key", () => {
    mount('<div role="dialog" data-state="open"></div>');
    expect(outcomeFrom(null)).toBe("defer-to-modal");
  });

  it("leaves the key to a field, without releasing it to the page", () => {
    const field = mount('<input type="text" />');
    expect(outcomeFrom(field, canvasFrame())).toBe("leave-to-field");
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
    expect(outcomeFrom(null, canvasFrame())).toBe("navigate-selection");
  });

  it("leaves the key to a menu or list floating over the editor", () => {
    /*
     * A unit menu, a select's list or a picker's list portals into a floating
     * layer and closes on Escape. Moving the canvas selection on the same key
     * would do two things for one press, so a press starting inside one is
     * consumed and does nothing more. A list that is NOT floating is the
     * control below.
     */
    const layer = mount(
      '<div data-radix-popper-content-wrapper=""><ul role="listbox" tabindex="0"></ul></div>'
    );
    expect(outcomeFrom(layer.querySelector("ul"), canvasFrame())).toBe(
      "leave-to-field"
    );
  });

  it("reads the floating layer from where the press STARTED, not from where focus is now", () => {
    /*
     * A layer that closes on the keystroke has moved focus away before any
     * binding runs, so a rule that read focus afterwards would see the panel
     * and act on the press a second time. The press's own origin is still the
     * list, wherever focus has gone since.
     */
    const layer = mount(
      '<div data-radix-popper-content-wrapper=""><ul role="listbox"></ul></div>'
    );
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    elsewhere.focus();

    expect(outcomeFrom(layer.querySelector("ul"), canvasFrame())).toBe(
      "leave-to-field"
    );
  });

  it("prefers the modal over a field inside it", () => {
    // A palette is a dialog containing a search input, so both conditions hold
    // at once and the order they are asked in decides. The modal wins: its own
    // Escape closes it, and consuming the key for the canvas would strand it
    // open.
    const dialog = mount(
      '<div role="dialog" data-state="open"><input type="text" /></div>'
    );

    expect(outcomeFrom(dialog.querySelector("input"), canvasFrame())).toBe(
      "defer-to-modal"
    );
  });
});

describe("escapeOutcome: where the press started", () => {
  it("sends focus back to the canvas from a control in a panel", () => {
    /*
     * The case this exists for: a colour picker closes on a pick and hands
     * focus back to its button in the inspector. Escape there leaves the
     * panel; it does not move the selection the panel is showing.
     */
    const control = mount('<button type="button">Colour</button>');
    expect(outcomeFrom(control, canvasFrame())).toBe("return-to-canvas");
  });

  it("control: the same control moves the selection when there is no frame to return to", () => {
    // With the canvas in the editor's own document there is nowhere separate
    // to send focus, and a press that did nothing would leave the author no
    // way up from a panel at all.
    const control = mount('<button type="button">Colour</button>');
    expect(outcomeFrom(control, null)).toBe("navigate-selection");
  });

  it("moves the selection from a press on the canvas page itself", () => {
    // The frame's own document is where a key pressed on the page arrives.
    const frame = canvasFrame();
    const page = frame.contentDocument;
    if (page === null) throw new Error("the frame has no document");
    const block = page.createElement("div");
    page.body.append(block);

    expect(outcomeFrom(page.body, frame)).toBe("navigate-selection");
    expect(outcomeFrom(block, frame)).toBe("navigate-selection");
  });

  it("moves the selection from the chrome drawn over the canvas", () => {
    // The block toolbar sits in the frame's box, in the editor's document,
    // and acts on the selection there: Escape on it is a press on the canvas.
    const frame = canvasFrame();
    const toolbarButton = document.createElement("button");
    frame.parentElement?.append(toolbarButton);

    expect(outcomeFrom(toolbarButton, frame)).toBe("navigate-selection");
    expect(outcomeFrom(frame, frame)).toBe("navigate-selection");
  });

  it("moves the selection from the canvas's region, which F6 focuses while the page is zoomed past it", () => {
    // The region wraps the frame's box rather than sitting inside it, so the
    // box alone would read a press there as a panel's and send focus into the
    // frame instead of going up.
    const frame = canvasFrame();
    const box = frame.parentElement;
    if (box === null) throw new Error("the frame has no box");
    const region = document.createElement("section");
    region.tabIndex = 0;
    box.replaceWith(region);
    region.append(box);

    expect(outcomeFrom(region, frame)).toBe("navigate-selection");
  });

  it("moves the selection from a press with nothing focused", () => {
    expect(outcomeFrom(document.body, canvasFrame())).toBe(
      "navigate-selection"
    );
    expect(outcomeFrom(document.documentElement, canvasFrame())).toBe(
      "navigate-selection"
    );
  });

  it("does not count a field on the canvas as the canvas: its own Escape finishes the edit", () => {
    const frame = canvasFrame();
    const page = frame.contentDocument;
    if (page === null) throw new Error("the frame has no document");
    const editing = page.createElement("p");
    editing.setAttribute("contenteditable", "plaintext-only");
    page.body.append(editing);

    expect(outcomeFrom(editing, frame)).toBe("leave-to-field");
  });
});

describe("pressOrigin", () => {
  it("reads the element a keydown was dispatched on", () => {
    const control = mount('<button type="button">Go</button>');
    let origin: Element | null | undefined;
    control.addEventListener("keydown", event => {
      origin = pressOrigin(event);
    });
    control.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );

    expect(origin).toBe(control);
  });

  it("reads through an open shadow root to the element inside it", () => {
    /*
     * Past the shadow boundary the event is retargeted to the host, so
     * `event.target` alone would name the custom element around a field and
     * the rule would miss that a field had the key.
     */
    const host = mount("<div></div>");
    const field = document.createElement("input");
    host.attachShadow({ mode: "open" }).append(field);
    let origin: Element | null | undefined;
    document.addEventListener(
      "keydown",
      event => {
        origin = pressOrigin(event);
      },
      { once: true }
    );
    field.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        composed: true,
      })
    );

    expect(origin).toBe(field);
  });

  it("answers null for a keydown dispatched on the document itself", () => {
    let origin: Element | null | undefined;
    document.addEventListener(
      "keydown",
      event => {
        origin = pressOrigin(event);
      },
      { once: true }
    );
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(origin).toBeNull();
  });
});

describe("returnFocusToCanvas", () => {
  it("focuses the frame and marks it, until focus leaves the frame", () => {
    const frame = canvasFrame();
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);

    returnFocusToCanvas(frame);

    expect(document.activeElement).toBe(frame);
    expect(frame.hasAttribute(CANVAS_KEYBOARD_FOCUS_ATTRIBUTE)).toBe(true);
    elsewhere.focus();
    expect(frame.hasAttribute(CANVAS_KEYBOARD_FOCUS_ATTRIBUTE)).toBe(false);
  });

  it("drops the mark on a pointer press in the page, which is no keyboard focus", () => {
    const frame = canvasFrame();
    const page = frame.contentDocument;
    if (page === null) throw new Error("the frame has no document");

    returnFocusToCanvas(frame);
    page.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(document.activeElement).toBe(frame);
    expect(frame.hasAttribute(CANVAS_KEYBOARD_FOCUS_ATTRIBUTE)).toBe(false);
  });

  it("does not mark a frame that focus did not reach", () => {
    // A frame no longer in the page cannot take focus, and a mark left on it
    // would wait for a blur that never comes.
    const frame = canvasFrame();
    frame.parentElement?.remove();

    returnFocusToCanvas(frame);

    expect(frame.hasAttribute(CANVAS_KEYBOARD_FOCUS_ATTRIBUTE)).toBe(false);
  });
});
