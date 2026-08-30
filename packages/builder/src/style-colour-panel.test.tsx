// @vitest-environment jsdom

/**
 * The colour control, driven through the Style tab against a real editor.
 *
 * `style-colour.ts` decides what a value resolves to and whether a pair can be
 * measured, and asserts that without a DOM. What is only true HERE is the
 * wiring: that a colour leaf draws a swatch rather than a bare text field, that
 * a stored TOKEN reaches this control instead of the read-only surface, that
 * the name shown is the token's current one while the document keeps its
 * identity, and that a readout appears only where both halves of a pair can be
 * read.
 *
 * @module style-colour-panel.test
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type NodeStyles,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";
import { StyleInspectorPanel } from "./style-inspector-panel";

afterEach(() => {
  cleanup();
  clearBlocks();
});

beforeAll(() => {
  // Radix measures and scrolls; jsdom provides neither, and a missing one
  // throws during render rather than failing an assertion.
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

/**
 * A site whose second token is RENAMED, so identity and name differ.
 *
 * The panel must show one and store the other, and a fixture where they match
 * cannot tell a correct control from one that has them the wrong way round.
 */
const TOKENS: SiteTokenSet = {
  tokens: [
    { name: "color.ink", kind: "color", values: { light: "#111111" } },
    {
      id: "color.primary",
      name: "brand.main",
      kind: "color",
      values: { light: "#ffffff" },
    },
  ],
};

function register(): void {
  registerBlocks(
    [
      {
        name: "acme/box",
        version: 1,
        description: "A box.",
        example: { props: {} },
        editor: { label: "Box" },
        props: { text: { type: "text" } },
        supports: { color: { text: true }, background: { color: true } },
        render: () => null,
      },
    ] as never,
    { source: "style-colour-panel-test" }
  );
}

function editorFor(
  document: BlockDocument
): EditorState & { applyAll: ReturnType<typeof vi.fn> } {
  return {
    document,
    selectedId: "a",
    selection: { ids: ["a"], primary: "a" },
    applyAll: vi.fn(() => document),
    select: vi.fn(),
    apply: vi.fn(() => document),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
  } as unknown as EditorState & { applyAll: ReturnType<typeof vi.fn> };
}

/**
 * Mount the Style tab over one node's stored styles.
 *
 * `null` means the host supplied NO table, and is spelled that way rather than
 * as `undefined` because a default parameter cannot tell an omitted argument
 * from an explicit `undefined` — measured: `mount(styles, undefined)` silently
 * took the default and the no-table test asserted against the full fixture.
 */
function mount(styles?: NodeStyles, tokens: SiteTokenSet | null = TOKENS) {
  register();
  const document_: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id: "a", type: "acme/box", version: 1, props: {}, styles },
    ] as BlockNode[],
  } as BlockDocument;
  const editor = editorFor(document_);
  render(
    <StyleInspectorPanel
      editor={editor}
      {...(tokens === null ? {} : { tokens })}
    />
  );
  return editor;
}

/** Styles holding a text colour, and optionally a background, at base/base. */
function styles(color?: unknown, backgroundColor?: unknown): NodeStyles {
  return {
    base: {
      base: {
        ...(color === undefined ? {} : { color }),
        ...(backgroundColor === undefined ? {} : { backgroundColor }),
      },
    },
  } as unknown as NodeStyles;
}

const swatch = (name: string): HTMLElement =>
  screen.getByRole("button", { name });

/**
 * Let Radix arm the listener that makes a dismissal possible.
 *
 * Not a wait for the write, which happens synchronously inside the close. Radix
 * attaches its outside-pointerdown listener inside a `setTimeout`, so until
 * that has run NOTHING can dismiss the popover — and a test that opens the
 * picker and immediately acts outside it asserts against a popover that never
 * closed, passing for a reason unrelated to what it names. Measured: three such
 * tests were green while the close path had never run.
 */
const settle = (): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, 0);
  });

/** Mount over a whole `NodeStyles` envelope, for properties `styles()` omits. */
function render_with(all: unknown) {
  return mount(all as NodeStyles);
}

describe("a colour leaf draws a colour control", () => {
  it("offers a swatch beside the field, where before there was only a field", () => {
    mount(styles("#3b82f6"));
    // A colour leaf used to fall through to a plain text field, so the swatch
    // beside it is the regression this holds: the control is a colour surface
    // rather than a string box that happens to hold a colour.
    expect(swatch("Colour for Color")).toBeDefined();
    expect(screen.getByRole("textbox", { name: "Color" })).toHaveProperty(
      "value",
      "#3b82f6"
    );
  });

  it("paints the swatch with the colour the value resolves to", () => {
    mount(styles("#3b82f6"));
    expect(
      swatch("Colour for Color").style.getPropertyValue("--nx-swatch")
    ).toBe("#3b82f6");
  });

  it("paints NOTHING for a colour it cannot resolve, and keeps the value", () => {
    // `oklch()` is a valid colour the engine stores and `parseColor` declines.
    // The swatch must not guess, and the text must not be rewritten.
    mount(styles("oklch(0.7 0.1 200)"));
    const button = swatch("Colour for Color");
    expect(button.style.getPropertyValue("--nx-swatch")).toBe("");
    expect(button.getAttribute("data-empty")).toBe("");
    expect(screen.getByRole("textbox", { name: "Color" })).toHaveProperty(
      "value",
      "oklch(0.7 0.1 200)"
    );
  });

  it("paints nothing for a value that resolves somewhere else", () => {
    // `var()` in the panel would resolve against the PANEL's custom properties
    // rather than the canvas's, so a painted swatch would show a colour the
    // page does not have.
    mount(styles("var(--site-color-primary)"));
    expect(
      swatch("Colour for Color").style.getPropertyValue("--nx-swatch")
    ).toBe("");
  });

  it("commits a typed colour on blur", () => {
    const editor = mount(styles("#3b82f6"));
    const field = screen.getByRole("textbox", { name: "Color" });
    fireEvent.change(field, { target: { value: "#ff0000" } });
    expect(editor.applyAll).not.toHaveBeenCalled();
    fireEvent.blur(field);
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
  });

  it("CLEARS rather than storing an empty colour", () => {
    const editor = mount(styles("#3b82f6"));
    const field = screen.getByRole("textbox", { name: "Color" });
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    const op = editor.applyAll.mock.calls[0]?.[0]?.[0] as { patch?: unknown };
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    // The entry is removed, so the property falls back through the cascade.
    // Written as an empty string it would instead pin the property to nothing.
    expect(JSON.stringify(op.patch)).not.toContain('"color":""');
  });
});

describe("a stored token reference", () => {
  it("reaches the colour control rather than the read-only surface", () => {
    // Before this control, `ControlValue` returned the generic token surface for
    // every reference — see-it-or-clear-it, with no way to choose another. The
    // swatch is what says a colour reference is now editable.
    mount(styles({ $token: "color.ink" }));
    expect(swatch("Colour for Color")).toBeDefined();
  });

  it("shows the token's CURRENT name, not the identity the document holds", () => {
    // The renamed token: stored as `color.primary`, displayed as `brand.main`.
    // A control reading the stored string straight onto the screen shows an
    // author a name they already changed.
    mount(styles({ $token: "color.primary" }));
    expect(screen.getByText("brand.main")).toBeDefined();
    expect(screen.queryByText("color.primary")).toBeNull();
  });

  it("paints the swatch with the colour the token resolves to", () => {
    mount(styles({ $token: "color.ink" }));
    expect(
      swatch("Colour for Color").style.getPropertyValue("--nx-swatch")
    ).toBe("#111111");
  });

  it("falls back to the stored identity when the site defines no such token", () => {
    // A dangling reference still compiles — an unknown token is a warning, not
    // an error — so the author is shown the string their document holds rather
    // than an empty space.
    mount(styles({ $token: "color.missing" }));
    expect(screen.getByText("color.missing")).toBeDefined();
  });

  it("shows the identity when the host supplied no table at all", () => {
    // Omitting `tokens` means the question was never asked, so there is no name
    // to resolve to and the identity is the only string available.
    mount(styles({ $token: "color.primary" }), null);
    expect(screen.getByText("color.primary")).toBeDefined();
  });

  it("offers a clear that removes the reference", () => {
    const editor = mount(styles({ $token: "color.ink" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear Color" }));
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
  });
});

describe("the contrast readout", () => {
  it("reports a ratio when both halves of the pair can be read", () => {
    mount(styles("#000000", "#ffffff"));
    expect(screen.getAllByText(/Contrast 21\.0:1/).length).toBeGreaterThan(0);
  });

  it("says a failing pair fails, without refusing the value", () => {
    mount(styles("#777777", "#888888"));
    expect(
      screen.getAllByText(/below AA for body text/).length
    ).toBeGreaterThan(0);
    // Still editable: a low ratio is a warning about a valid value, never a
    // refusal. The same position Gutenberg's contrast checker takes.
    expect(screen.getByRole("textbox", { name: "Color" })).toHaveProperty(
      "value",
      "#777777"
    );
  });

  it("measures a pair written as TOKENS, by resolving both sides", () => {
    mount(styles({ $token: "color.ink" }, { $token: "color.primary" }));
    expect(
      screen.getAllByText(/Contrast 1[0-9]\.[0-9]:1/).length
    ).toBeGreaterThan(0);
  });

  it("reports NOTHING when the partner is unset", () => {
    // The honest half. A colour on its own has no contrast, and inventing a
    // background to measure against would be a number an author acts on.
    mount(styles("#000000"));
    expect(screen.queryByText(/Contrast/)).toBeNull();
  });

  it("reports nothing when either half cannot be read", () => {
    mount(styles("var(--brand)", "#ffffff"));
    expect(screen.queryByText(/Contrast/)).toBeNull();
  });

  it("appears on the BACKGROUND control too, not only the foreground", () => {
    // Each control answers for the pair it is part of, so an author editing the
    // background sees the same verdict as one editing the text. The two sit in
    // different accordion sections and Radix renders only the open one, so this
    // has to open Background rather than counting two readouts at once — which
    // is itself worth knowing: an author never sees both controls together.
    mount(styles("#000000", "#ffffff"));
    fireEvent.click(screen.getByRole("button", { name: /^Background/ }));
    expect(
      screen.getByRole("textbox", { name: "Background color" })
    ).toHaveProperty("value", "#ffffff");
    expect(swatch("Colour for Background color")).toBeDefined();
    expect(screen.getAllByText(/Contrast 21\.0:1/).length).toBeGreaterThan(0);
  });
});

describe("a value no colour surface can represent", () => {
  it("keeps the read-only surface rather than an empty colour field", () => {
    // An object at a scalar position, from an import or the API. Routed to the
    // colour control it projects to an empty draft and reads as UNSET while the
    // value goes on compiling — and the one action that would remove it, Clear,
    // is the one the field does not offer.
    mount(styles({ value: "#fff" }));
    expect(screen.queryByRole("textbox", { name: "Color" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Colour for Color" })
    ).toBeNull();
    // Shown, and removable.
    expect(screen.getByRole("button", { name: "Clear Color" })).toBeDefined();
    expect(screen.getByText(/"value"/)).toBeDefined();
  });

  it("still routes an ordinary literal and a reference to the colour control", () => {
    // The positive control for the guard: it must refuse the shape above and
    // nothing else, or every colour would fall back to read-only.
    mount(styles("#3b82f6"));
    expect(
      screen.getByRole("button", { name: "Colour for Color" })
    ).toBeDefined();
  });
});

describe("the contrast verdict is reachable from the control it describes", () => {
  it("points the field and the swatch at the readout", () => {
    // Without this the verdict is rendered and announced to nobody: focusing
    // the colour control says nothing about the WCAG result beside it.
    mount(styles("#000000", "#ffffff"));
    const note = document.querySelector(".nx-style-inspector__contrast");
    expect(note).not.toBeNull();
    const noteId = note?.getAttribute("id");
    expect(noteId).toBeTruthy();
    const field = screen.getByRole("textbox", { name: "Color" });
    const swatchButton = screen.getByRole("button", {
      name: "Colour for Color",
    });
    expect(field.getAttribute("aria-describedby")).toContain(noteId as string);
    expect(swatchButton.getAttribute("aria-describedby")).toContain(
      noteId as string
    );
  });

  it("describes nothing when there is no verdict to describe", () => {
    mount(styles("#000000"));
    expect(
      screen
        .getByRole("textbox", { name: "Color" })
        .getAttribute("aria-describedby")
    ).toBeNull();
  });
});

/** Move the picker the way a DRAG does: continuously, with no finish to wait for. */
function movePicker(): void {
  fireEvent.keyDown(
    screen.getByRole("application", { name: /Saturation and brightness/ }),
    { key: "ArrowRight" }
  );
}

describe("a picker gesture is ONE editor operation", () => {
  it("does not write while the picker is being moved, and writes once on close", async () => {
    // The UI picker fires `onColorChange` on every pointer event, so committing
    // each one turns a single drag into dozens of undo entries — and
    // `MAX_HISTORY` is 100, so one drag can evict unrelated earlier edits and
    // leave undo walking intermediate colours instead of reverting the gesture.
    // The same rule the text fields follow: an op per keystroke would make one
    // undo remove one character.
    const editor = mount(styles("#3b82f6"));
    fireEvent.click(screen.getByRole("button", { name: "Colour for Color" }));

    /*
     * The SURFACE, not the hex field. The field used to stand in for a drag
     * because typing published on every keystroke exactly as dragging does; it
     * no longer does — a typed colour is reported when the author finishes it —
     * so the field would reach a different path from the one this case names,
     * and every assertion below would go on passing while saying nothing about
     * a drag. The surface is keyboard-operable, which is what makes a real move
     * expressible without pointer geometry jsdom cannot supply.
     */
    movePicker();
    movePicker();
    movePicker();

    // Three moves, no writes.
    expect(editor.applyAll).not.toHaveBeenCalled();

    // Closing ends the gesture and writes once.
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await settle();
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
  });
});

describe("the contrast readout keeps up with the picker", () => {
  it("measures what the field is SHOWING, not what the document holds", () => {
    // The readout deferred to `stored` while the draft moved, so throughout a
    // picker gesture the verdict described the old colour — stale exactly while
    // an author is choosing, which is when a contrast readout is for. It also
    // put the swatch and the figure beside it on two different colours.
    mount(styles("#000000", "#ffffff"));
    expect(screen.getAllByText(/Contrast 21\.0:1/).length).toBeGreaterThan(0);

    // Type a low-contrast colour without committing it.
    fireEvent.change(screen.getByRole("textbox", { name: "Color" }), {
      target: { value: "#f0f0f0" },
    });

    // The verdict follows immediately, and the old one is gone.
    expect(screen.queryByText(/Contrast 21\.0:1/)).toBeNull();
    expect(
      screen.getAllByText(/below AA for body text/).length
    ).toBeGreaterThan(0);
  });
});

describe("a contrast verdict is not a complaint", () => {
  it("does NOT mark a valid colour invalid just for describing it", () => {
    // The field is described by the contrast note, and a field that inferred
    // invalidity from having a description announced a perfectly good colour
    // with a passing 21:1 result as invalid.
    mount(styles("#000000", "#ffffff"));
    const field = screen.getByRole("textbox", { name: "Color" });
    // Described...
    expect(field.getAttribute("aria-describedby")).toBeTruthy();
    // ...and still valid.
    expect(field.getAttribute("aria-invalid")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Colour for Color" })
        .getAttribute("aria-invalid")
    ).toBeNull();
  });
});

describe("opening the picker on a reference it cannot show", () => {
  it("warns before a movement would replace the reference", () => {
    // `storedText` answers "" for a reference, so a predicate reading the draft
    // alone missed every one of them. Opening the picker on a token the site no
    // longer defines starts its controls at black, and the first adjustment
    // replaces the reference with an unrelated near-black literal.
    mount(styles({ $token: "color.missing" }));
    fireEvent.click(screen.getByRole("button", { name: "Colour for Color" }));
    expect(screen.getByText(/cannot be shown on the picker/)).toBeDefined();
  });

  it("stays quiet for a reference it CAN show", () => {
    // The positive control: the warning must be about being unresolvable, not
    // about being a reference.
    mount(styles({ $token: "color.ink" }));
    fireEvent.click(screen.getByRole("button", { name: "Colour for Color" }));
    expect(screen.queryByText(/cannot be shown on the picker/)).toBeNull();
  });
});

describe("a verdict is withheld while something else decides the pixels", () => {
  it("reports nothing when a gradient covers the background colour", () => {
    // Black text on white with an opaque black gradient over it reports 21:1
    // and renders black on black. The two colour properties are no longer what
    // reaches the eye, so there is no honest figure to give.
    render_with({
      base: {
        base: {
          color: "#000000",
          backgroundColor: "#ffffff",
          backgroundGradient: "linear-gradient(#000, #000)",
        },
      },
    });
    expect(screen.queryByText(/Contrast/)).toBeNull();
  });

  it("reports the pair when nothing stands between them", () => {
    // The positive control: the same pair without the gradient is measured, so
    // the silence above is the gradient rather than the pair being unreadable.
    render_with({
      base: { base: { color: "#000000", backgroundColor: "#ffffff" } },
    });
    expect(screen.getAllByText(/Contrast 21\.0:1/).length).toBeGreaterThan(0);
  });
});

describe("the picker can replace a stored token with a literal", () => {
  it("follows the draft once a token-reference picker has been moved", () => {
    // Pinned to the stored token, `ColorPicker` was handed the token's own hex
    // again on every render and its prop-sync effect reset the surface to it —
    // the controls snapped back mid-drag and a token could not be replaced with
    // a literal through the picker at all.
    mount(styles({ $token: "color.ink" }));
    // Before any movement the surface shows the token's colour.
    expect(
      screen
        .getByRole("button", { name: "Colour for Color" })
        .style.getPropertyValue("--nx-swatch")
    ).toBe("#111111");

    fireEvent.click(screen.getByRole("button", { name: "Colour for Color" }));
    const hex = screen.getAllByRole("textbox")[0];
    expect(hex).toBeDefined();
    if (hex === undefined) return;
    fireEvent.change(hex, { target: { value: "#ff0000" } });
    // FINISHED, because a typed colour is reported when the author finishes
    // it rather than per keystroke.
    fireEvent.blur(hex);

    // The swatch now follows the draft rather than snapping back to the token.
    expect(
      screen
        .getByRole("button", { name: "Colour for Color" })
        .style.getPropertyValue("--nx-swatch")
    ).toBe("#ff0000");
  });
});

describe("a picker gesture survives the field being replaced", () => {
  it("writes an unwritten adjustment when the control unmounts", () => {
    // The popover commits on close, and a close is not the only way an author
    // leaves: selecting another block in the canvas iframe cannot reach the
    // popover's outside-dismiss handler, and the selection change remounts this
    // field without firing `onOpenChange`. Unflushed, the whole gesture is
    // discarded silently.
    const editor = mount(styles("#3b82f6"));
    fireEvent.click(screen.getByRole("button", { name: "Colour for Color" }));
    // The PICKER's hex field, not the control's own. Taking the first textbox
    // picks up the main field, whose draft commits on blur and never reaches
    // the pending gesture — so the assertion below would hold whether or not
    // the flush exists.
    const hex = screen
      .getAllByRole("textbox")
      .find(input => input !== screen.getByRole("textbox", { name: "Color" }));
    expect(hex).toBeDefined();
    if (hex === undefined) return;
    fireEvent.change(hex, { target: { value: "#ff0000" } });
    // FINISHED, because a typed colour is reported when the author finishes
    // it rather than per keystroke.
    fireEvent.blur(hex);
    expect(editor.applyAll).not.toHaveBeenCalled();

    // Unmount without ever closing the popover.
    cleanup();
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when the picker was opened and not moved", () => {
    // The positive control: unmounting must not manufacture an edit, or every
    // click through the inspector would write a history entry.
    const editor = mount(styles("#3b82f6"));
    fireEvent.click(screen.getByRole("button", { name: "Colour for Color" }));
    cleanup();
    expect(editor.applyAll).not.toHaveBeenCalled();
  });
});

describe("a discrete choice supersedes an unfinished gesture", () => {
  it("does not let a pending literal overwrite a token chosen after it", () => {
    // Choosing a preset does not close the popover, so the control is still
    // holding an unfinished gesture when the author leaves. Unless that gesture
    // is dropped as the preset commits, the unmount write lands the older hex
    // on top of the token just picked and the reference becomes a literal.
    const editor = mount(styles("#3b82f6"));
    fireEvent.click(screen.getByRole("button", { name: "Colour for Color" }));

    const hex = screen
      .getAllByRole("textbox")
      .find(input => input !== screen.getByRole("textbox", { name: "Color" }));
    expect(hex).toBeDefined();
    if (hex === undefined) return;
    fireEvent.change(hex, { target: { value: "#ff0000" } });
    // FINISHED, because a typed colour is reported when the author finishes
    // it rather than per keystroke.
    fireEvent.blur(hex);

    // Now pick a token preset, which commits immediately.
    fireEvent.click(screen.getByRole("button", { name: "color.ink" }));
    expect(editor.applyAll).toHaveBeenCalledTimes(1);

    // Leave without closing the popover.
    cleanup();

    // Still one write, and it is the token.
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(editor.applyAll.mock.calls[0])).toContain("$token");
  });

  it("does not let one overwrite a CLEAR either", async () => {
    const editor = mount(styles({ $token: "color.ink" }));
    fireEvent.click(screen.getByRole("button", { name: "Colour for Color" }));
    // Radix attaches its outside-pointerdown listener inside a `setTimeout`, so
    // nothing can dismiss the popover until that has run. Without this the
    // popover never closes, the close path never runs, and the assertions below
    // hold for a reason that has nothing to do with what they name.
    await settle();
    const hex = screen.getAllByRole("textbox")[0];
    expect(hex).toBeDefined();
    if (hex === undefined) return;
    fireEvent.change(hex, { target: { value: "#ff0000" } });
    // FINISHED, because a typed colour is reported when the author finishes
    // it rather than per keystroke.
    fireEvent.blur(hex);

    fireEvent.click(screen.getByRole("button", { name: "Clear Color" }));
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    cleanup();
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
  });
});

describe("a superseded gesture stays superseded even when the choice is refused", () => {
  it("does not write the older literal after a REFUSED token commit", async () => {
    // The close path is separate from the unmount one. A token commit that the
    // store refuses — a document at its byte limit, say — leaves the picker's
    // earlier literal sitting in the draft, and a close that decided from the
    // draft wrote that literal even though choosing the token was meant to
    // replace it. Both paths now read the one pending value.
    const editor = mount(styles("#3b82f6"));
    // Every write is refused: `apply` answering null is the store declining.
    editor.applyAll.mockReturnValue(null);

    fireEvent.click(screen.getByRole("button", { name: "Colour for Color" }));
    const hex = screen
      .getAllByRole("textbox")
      .find(input => input !== screen.getByRole("textbox", { name: "Color" }));
    expect(hex).toBeDefined();
    if (hex === undefined) return;
    fireEvent.change(hex, { target: { value: "#ff0000" } });
    // FINISHED, because a typed colour is reported when the author finishes
    // it rather than per keystroke.
    fireEvent.blur(hex);

    fireEvent.click(screen.getByRole("button", { name: "color.ink" }));
    const afterToken = editor.applyAll.mock.calls.length;
    expect(afterToken).toBe(1);
    expect(JSON.stringify(editor.applyAll.mock.calls[0])).toContain("$token");

    // Closing must not resurrect the literal the token choice replaced.
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await settle();
    expect(editor.applyAll.mock.calls.length).toBe(afterToken);
  });
});

describe("clearing a token while the picker is open", () => {
  it("records ONE operation, and it is the clear", async () => {
    // The Clear button sits outside the popover, so pressing it is an outside
    // interaction: Radix dismisses on a document `pointerdown`, which closes the
    // picker and commits its gesture, and only then does the click clear. That
    // is two history entries, and one undo returns an intermediate literal the
    // author never chose. The pointer-down supersede drops the gesture first.
    const editor = mount(styles({ $token: "color.ink" }));
    fireEvent.click(screen.getByRole("button", { name: "Colour for Color" }));
    // Radix attaches its outside-pointerdown listener inside a `setTimeout`, so
    // nothing can dismiss the popover until that has run. Without this the
    // popover never closes, the close path never runs, and the assertions below
    // hold for a reason that has nothing to do with what they name.
    await settle();
    const hex = screen.getAllByRole("textbox")[0];
    expect(hex).toBeDefined();
    if (hex === undefined) return;
    fireEvent.change(hex, { target: { value: "#ff0000" } });
    // FINISHED, because a typed colour is reported when the author finishes
    // it rather than per keystroke.
    fireEvent.blur(hex);

    // The real order: React's handler on the button, then the document
    // dismissal Radix listens for, then the click.
    // The real interaction: a pointer press on the button dismisses the popover
    // — Radix listens for that on the document — and the click follows. One
    // intent, however many events it takes.
    const clear = screen.getByRole("button", { name: "Clear Color" });
    fireEvent.pointerDown(clear);
    fireEvent.click(clear);
    await settle();

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    // A clear removes the entry rather than writing one.
    expect(JSON.stringify(editor.applyAll.mock.calls[0])).not.toContain(
      "#ff0000"
    );
  });
});

describe("the route a real editor takes to the colour control", () => {
  it("carries the site's tokens through the inspector into the Style tab", () => {
    /*
     * Mounted through `InspectorPanel`, which is what the page builder renders,
     * rather than through `StyleInspectorPanel` directly.
     *
     * Every other case in this file constructs the Style tab by hand and hands
     * it a token set, so all of them stay green with the forwarding through the
     * inspector deleted — measured: removing `tokens={tokens}` from
     * `InspectorPanel` moved ZERO of 1424 tests. The host-side test cannot see
     * it either, because it mocks `InspectorPanel` to record its props. This is
     * the one link production depends on and nothing exercised it.
     */
    register();
    const document_: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "a",
          type: "acme/box",
          version: 1,
          props: {},
          styles: styles("#3b82f6"),
        },
      ] as BlockNode[],
    } as BlockDocument;
    render(<InspectorPanel editor={editorFor(document_)} tokens={TOKENS} />);

    // `mouseDown`, not `click`: the trigger activates on pointer-down, and a
    // synthetic click leaves the Content tab selected — which would make every
    // assertion below run against the wrong panel.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));

    fireEvent.click(screen.getByRole("button", { name: "Colour for Color" }));
    // The site's own token, reachable only if the set travelled the whole way.
    expect(screen.getByRole("button", { name: "color.ink" })).toBeDefined();
  });
});

describe("a dismissal that is NOT a superseding control", () => {
  it("still writes the gesture", async () => {
    // The control for the suppression, and the direction that loses work. If
    // every outside interaction suppressed, clicking anywhere off the picker
    // would silently discard what the author had just done.
    const editor = mount(styles("#3b82f6"));
    fireEvent.click(screen.getByRole("button", { name: "Colour for Color" }));
    await settle();
    const hex = screen
      .getAllByRole("textbox")
      .find(input => input !== screen.getByRole("textbox", { name: "Color" }));
    expect(hex).toBeDefined();
    if (hex === undefined) return;
    fireEvent.change(hex, { target: { value: "#ff0000" } });
    // FINISHED, because a typed colour is reported when the author finishes
    // it rather than per keystroke.
    fireEvent.blur(hex);
    expect(editor.applyAll).not.toHaveBeenCalled();

    // Somewhere outside the picker that commits nothing of its own.
    fireEvent.pointerDown(document.body);
    await settle();

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(editor.applyAll.mock.calls[0])).toContain("#ff0000");
  });
});

/*
 * The FOCUS route is not driven here, and that is a limit of jsdom rather than
 * a gap in the guard.
 *
 * Radix dismisses on `focusin` as well as `pointerdown`, and both arrive at the
 * one `onInteractOutside` callback the suppression reads — so the route above
 * exercises the same branch this one would. Attempting it directly was
 * measured and abandoned: `fireEvent.focusIn` on the clear button leaves the
 * popover OPEN, so the test passed because only the click ever committed, not
 * because the suppression worked. It was deleted rather than left as a green
 * that reported nothing.
 */

describe("an ancestor's effects reach the readout", () => {
  /** Mount the Style tab over a node nested inside a styled wrapper. */
  function mountNested(wrapper: unknown) {
    register();
    const document_: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "wrap",
          type: "acme/box",
          version: 1,
          props: {},
          styles: wrapper,
          slots: {
            children: [
              {
                id: "a",
                type: "acme/box",
                version: 1,
                props: {},
                styles: styles("#000000", "#ffffff"),
              },
            ],
          },
        },
      ] as unknown as BlockNode[],
    } as BlockDocument;
    const editor = editorFor(document_);
    render(<StyleInspectorPanel editor={editor} tokens={TOKENS} />);
    return editor;
  }

  it("reports the ratio when nothing above the node alters it", () => {
    // The control. Without it the assertion below passes for any panel that
    // never shows a readout at all.
    mountNested(undefined);
    expect(screen.getAllByText(/Contrast 21\.0:1/).length).toBeGreaterThan(0);
  });

  it("withholds it when a PARENT fades the whole subtree", () => {
    // Black on white measures 21:1 from the node's own styles alone, and
    // reaches the eye at a fraction of that. A readout scoped to the selected
    // node reports the figure and is wrong — the one direction this guard
    // must not fail in.
    mountNested({ base: { base: { opacity: "0.1" } } });
    expect(screen.queryByText(/Contrast/)).toBeNull();
  });
});

describe("the readout announces itself while the picker moves", () => {
  it("keeps the note in the document with nothing to say", () => {
    // A live region only speaks when its contents CHANGE, so one that mounts
    // with the verdict already in place is silent — which is every time a
    // colour first becomes measurable. Rendering it empty is what makes the
    // first verdict an announcement rather than an arrival.
    render_with({ base: { base: { color: "#000000" } } });
    const note = document.querySelector(".nx-style-inspector__contrast");
    expect(note).not.toBeNull();
    expect(note?.getAttribute("aria-live")).toBe("polite");
    expect(note?.textContent).toBe("");
  });

  it("announces the verdict from the same region once a pair is readable", () => {
    render_with({
      base: { base: { color: "#000000", backgroundColor: "#ffffff" } },
    });
    const notes = Array.from(
      document.querySelectorAll(".nx-style-inspector__contrast")
    );
    const spoken = notes.filter(note => note.textContent !== "");
    expect(spoken.length).toBeGreaterThan(0);
    for (const note of spoken) {
      expect(note.getAttribute("aria-live")).toBe("polite");
      expect(note.textContent).toContain("Contrast 21.0:1");
    }
  });
});

describe("two tokens under one name are told apart", () => {
  it("qualifies the preset labels with the identity that differs", () => {
    // A rename freezes the old name as the identity, so a second token can
    // take the name the first left. Both emit and both are offered.
    const clashing: SiteTokenSet = {
      tokens: [
        {
          id: "color.primary",
          name: "brand.main",
          kind: "color",
          values: { light: "#111111" },
        },
        { name: "brand.main", kind: "color", values: { light: "#111111" } },
      ],
    };
    register();
    const document_: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "a",
          type: "acme/box",
          version: 1,
          props: {},
          styles: styles("#3b82f6"),
        },
      ] as BlockNode[],
    } as BlockDocument;
    render(
      <StyleInspectorPanel editor={editorFor(document_)} tokens={clashing} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Colour for Color" }));

    // Identical colours, so the swatches themselves cannot tell them apart.
    expect(
      screen.queryByRole("button", { name: "brand.main (color.primary)" })
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "brand.main (brand.main)" })
    ).not.toBeNull();
  });
});

describe("a malformed stored document does not take the Style tab down", () => {
  /*
   * The evidence gap this closes is worth naming. A first attempt guarded the
   * obscuring SCAN and asserted it by calling that scan directly — and the
   * panel still threw, because `readStyleValue` and its contrast partner read
   * the same tier BEFORE the scan runs. A test that reaches the mechanism by
   * its own front door proves the mechanism, not the screen.
   *
   * So these mount the real panel. `documentFrom` admits any value whose
   * `nodes` is an array — deliberately, because a stored document is whatever a
   * migration, an import or a hand-edited row left behind — so every shape
   * below reaches the editor intact, and a throw here happens during render.
   */
  /*
   * A malformed TIER, where the envelope itself is the wrong shape. The leaf
   * has nothing set, so the panel draws its control with no value — which is
   * the same thing it draws for a node that simply has no styles, and is the
   * correct answer.
   */
  const malformedTiers: readonly [string, unknown][] = [
    ["a null tier", { base: null }],
    ["a null breakpoint map", { base: { base: null } }],
    ["a tier that is a string", { base: "base" }],
    ["a tier that is an array", { base: [{ color: "#000" }] }],
    ["a breakpoint map that is an array", { base: { base: ["color"] } }],
  ];

  for (const [what, styles] of malformedTiers) {
    it(`renders rather than throwing for ${what}`, () => {
      expect(() => render_with(styles)).not.toThrow();
      // A live panel, not an error boundary's remains: the control for this
      // leaf is still drawn and still operable.
      expect(
        screen.getByRole("button", { name: "Colour for Color" })
      ).toBeDefined();
    });
  }

  it("renders rather than throwing for a malformed VALUE", () => {
    // Different from the tiers above and asserted apart from them: the
    // envelope is well formed and the value inside it is not, so the panel
    // legitimately draws the read-only surface for a value no colour control
    // can represent rather than the swatch.
    expect(() =>
      render_with({ base: { base: { color: null } } })
    ).not.toThrow();
    // The read-only surface for a value nothing here can represent, which is
    // the honest answer: the value is still on the page and still removable.
    expect(
      screen.getByText(/No control here can edit this value/)
    ).toBeDefined();
  });

  it("still shows a GOOD address when another one is malformed", () => {
    // The guard must skip the broken tier, not abandon the read. A document
    // with one bad address and one good one must still show the good value.
    render_with({ base: { base: { color: "#3b82f6" } }, hover: null });
    expect(screen.getByRole("textbox", { name: "Color" })).toHaveProperty(
      "value",
      "#3b82f6"
    );
  });
});

describe("a Reset beside a picker mid-gesture", () => {
  /**
   * A site with one viewport tier, so the panel previews and the cascade's
   * entries are attributable to a breakpoint the badge can name.
   */
  const SITE = {
    viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
    container: [],
  } as never;

  /**
   * The Style tab with a CASCADE, which is what earns a control its Reset.
   *
   * `mount` above renders no cascade, so every control there reads as unset and
   * offers no action at all — a fixture that cannot reach the mechanism these
   * cases are about.
   */
  function mountWithResets(
    authored: ReadonlyArray<{ property: string; descendant?: string }>
  ) {
    registerBlocks(
      [
        {
          name: "acme/box",
          version: 1,
          description: "A box.",
          example: { props: {} },
          editor: { label: "Box" },
          props: { text: { type: "text" } },
          // `link` puts a SECOND colour control in the same section as the
          // first. The accordion opens one section at a time, so a control in
          // another section is not in the tree while this one's picker is open.
          supports: { color: { text: true, link: true } },
          render: () => null,
        },
      ] as never,
      { source: "style-colour-panel-test" }
    );
    const document_: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "a",
          type: "acme/box",
          version: 1,
          props: {},
          // BOTH colours stored, because a Reset on a property the document
          // does not hold clears nothing and writes no operation — so the other
          // control would press cleanly and record nothing to order against.
          styles: {
            base: { base: { color: "#3b82f6", linkColor: "#22c55e" } },
          },
        },
      ] as BlockNode[],
    } as BlockDocument;
    const editor = editorFor(document_);
    render(
      <StyleInspectorPanel
        editor={editor}
        tokens={TOKENS}
        breakpoints={SITE}
        previewContainer="nx-preview-viewport"
        liveBreakpoints={[BASE_BREAKPOINT, "tablet"] as never}
        cascade={
          {
            entries: authored.map(entry => ({
              origin: { kind: "node", id: "a" },
              property: entry.property,
              ...(entry.descendant === undefined
                ? {}
                : { descendant: entry.descendant }),
              value: "#3b82f6",
              state: "base",
              breakpoint: BASE_BREAKPOINT,
            })),
            nodes: editor.document.nodes,
          } as never
        }
      />
    );
    return editor;
  }

  /** The Reset button of the control whose action is named `actionName`. */
  const resetFor = (actionName: string): HTMLElement => {
    const found = screen
      .getAllByRole("button")
      .find(
        button =>
          button.dataset.action === "reset" &&
          (button.getAttribute("aria-label") ?? "").startsWith(
            `Reset ${actionName} at `
          )
      );
    expect(found).toBeDefined();
    return found as HTMLElement;
  };

  /** Move the picker without committing, leaving a gesture pending. */
  const dragTo = async (hex: string): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: "Colour for Color" }));
    // Radix arms its outside-pointerdown listener in a `setTimeout`. Until that
    // has run nothing can dismiss the popover, so a case that presses a button
    // outside it asserts against a picker that never closed.
    await settle();
    /*
     * The PICKER's hex field, found INSIDE the open popover.
     *
     * Not "the textbox that is not this control's own": a panel with a second
     * colour control has a third textbox, and that rule picks up the other
     * control's field instead. Committing through a control's own field writes
     * on blur and never reaches the pending gesture, so the case would then
     * drive nothing the supersede can act on and assert against zero writes.
     */
    const picker = within(screen.getByRole("dialog")).getAllByRole(
      "textbox"
    )[0];
    expect(picker).toBeDefined();
    if (picker === undefined) return;
    fireEvent.change(picker, { target: { value: hex } });
    /*
     * FINISHED, because a typed colour is reported when the author finishes it
     * rather than per keystroke. That reports the colour ONCE, which is what
     * leaves a gesture pending — the panel records a picker report and writes
     * on close, so a report is not itself a write.
     */
    fireEvent.blur(picker);
  };

  it("keeps a colour typed and then DISMISSED by clicking away", async () => {
    /*
     * The path `fireEvent.blur` cannot reach. Radix runs its dismiss layer from
     * an outside `pointerdown` and unmounts the content there, so a blur may
     * never be delivered — which would lose a complete colour the author typed,
     * trading a silent wrong write for a silent lost one.
     *
     * Driven as a real outside press rather than as a blur, because a blur is
     * the thing in question.
     */
    const editor = mountWithResets([{ property: "color" }]);
    fireEvent.click(screen.getByRole("button", { name: "Colour for Color" }));
    await settle();

    const picker = within(screen.getByRole("dialog")).getAllByRole(
      "textbox"
    )[0];
    expect(picker).toBeDefined();
    if (picker === undefined) return;
    fireEvent.change(picker, { target: { value: "#ff0000" } });

    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    await settle();

    expect(JSON.stringify(editor.applyAll.mock.calls)).toContain("#ff0000");
  });

  it("drops the gesture the Reset replaced, rather than queueing it", async () => {
    /*
     * Reset supersedes the gesture, so the picker must DISCARD it — not merely
     * decline to write it there and then. Left queued, the unmount flush writes
     * the old colour back over the reset as a later operation: the property the
     * author cleared reappears, and one undo removes a write no gesture of
     * theirs produced.
     */
    const editor = mountWithResets([{ property: "color" }]);
    await dragTo("#ff0000");
    expect(editor.applyAll).not.toHaveBeenCalled();

    const reset = resetFor("Color");
    fireEvent.pointerDown(reset);
    fireEvent.click(reset);
    await settle();
    expect(editor.applyAll).toHaveBeenCalledTimes(1);

    cleanup();
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
  });

  it("keeps a gesture when Reset is only FOCUSED, never pressed", async () => {
    /*
     * Radix dismisses on focus leaving the popover as well as on a press
     * outside it. A keyboard author tabbing out of the picker lands on the
     * Reset beside this very control — so a supersede decided from "the
     * dismissal's target is a marked control" discards the gesture because of a
     * button nobody activated, and tabbing onward loses it with nothing shown.
     *
     * Leaving a control is a COMMIT everywhere else in this panel; the text
     * fields write on blur. The gesture is therefore written here, and the
     * Reset writes nothing because it never ran.
     */
    const editor = mountWithResets([{ property: "color" }]);
    await dragTo("#ff0000");
    expect(editor.applyAll).not.toHaveBeenCalled();

    // Focus alone: no pointer press, no click, so `onReset` never runs. Moved
    // with `.focus()` rather than a synthetic event, because Radix listens for
    // `focusin` on the document and decides from `document.activeElement` —
    // dispatched at the button, the listener sees focus still inside the
    // popover and dismisses nothing.
    resetFor("Color").focus();
    await settle();

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(editor.applyAll.mock.calls[0])).toContain("#ff0000");
  });

  it("keeps a gesture when the Reset is RIGHT-clicked, which runs nothing", async () => {
    /*
     * A secondary press opens a context menu and invokes no handler. Radix
     * dismisses the popover on any `pointerdown` outside it, so reading that
     * press as a supersede discards the colour an author was composing on
     * behalf of a button that never ran — the gesture is gone and nothing
     * replaced it, which is the worst of the three outcomes available.
     *
     * The gesture is therefore committed, exactly as it is when the dismissal
     * lands anywhere else that writes nothing.
     */
    const editor = mountWithResets([{ property: "color" }]);
    await dragTo("#ff0000");
    expect(editor.applyAll).not.toHaveBeenCalled();

    // Secondary button: no click follows, and `onReset` never runs.
    fireEvent.pointerDown(resetFor("Color"), { button: 2 });
    await settle();

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(editor.applyAll.mock.calls[0])).toContain("#ff0000");
  });

  /**
   * Pretend to be a platform, for the duration of one case.
   *
   * `navigator.platform` is the only signal that separates a macOS context-menu
   * gesture from an ordinary Control-click, so a case about that distinction
   * has to state which platform it is on. Restored afterwards, because a
   * leaked value would silently decide every later case in the file.
   */
  function onPlatform(name: string): () => void {
    const original = Object.getOwnPropertyDescriptor(
      window.navigator,
      "platform"
    );
    Object.defineProperty(window.navigator, "platform", {
      value: name,
      configurable: true,
    });
    return () => {
      if (original === undefined) return;
      Object.defineProperty(window.navigator, "platform", original);
    };
  }

  it("keeps a gesture when the Reset is CONTROL-clicked on a MAC", async () => {
    /*
     * Control held with the primary button is a context-menu gesture on macOS,
     * and the pointer event still reports `button === 0` — so a check on the
     * button alone lets it through. No click follows, so the Reset's handler
     * never runs and the colour the author was composing would be discarded on
     * behalf of a button that did nothing.
     */
    const restore = onPlatform("MacIntel");
    try {
      const editor = mountWithResets([{ property: "color" }]);
      await dragTo("#ff0000");
      expect(editor.applyAll).not.toHaveBeenCalled();

      // No click: on this platform the press opens a menu instead.
      fireEvent.pointerDown(resetFor("Color"), { button: 0, ctrlKey: true });
      await settle();

      expect(editor.applyAll).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(editor.applyAll.mock.calls[0])).toContain(
        "#ff0000"
      );
    } finally {
      restore();
    }
  });

  it("writes ONCE for a Control-click anywhere else, where it is an ordinary click", async () => {
    /*
     * The control on the case above, and the reason the platform is asked at
     * all rather than the modifier alone. On Windows and Linux a Control-click
     * IS an ordinary modified click: the button runs, so treating it as a
     * context menu commits the picker's draft on dismissal AND lets the Reset
     * write — one gesture becoming two edits, and the first undo restoring the
     * colour the author pressed Reset to be rid of.
     *
     * The click is dispatched here and deliberately NOT in the case above: a
     * case that sends only `pointerDown` cannot observe the platform's ensuing
     * click, so it would pass on both platforms and separate nothing.
     */
    const restore = onPlatform("Win32");
    try {
      const editor = mountWithResets([{ property: "color" }]);
      await dragTo("#ff0000");

      const reset = resetFor("Color");
      fireEvent.pointerDown(reset, { button: 0, ctrlKey: true });
      fireEvent.click(reset, { ctrlKey: true });
      await settle();

      // The clear alone. Two calls would be the draft and the reset both
      // landing, which is the defect the supersede exists to prevent.
      expect(editor.applyAll).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(editor.applyAll.mock.calls[0])).not.toContain(
        "#ff0000"
      );
    } finally {
      restore();
    }
  });

  it("keeps a gesture ANOTHER control's Reset does not replace", async () => {
    /*
     * The supersede is scoped to the field whose value the press writes. A
     * Reset on the background colour replaces nothing the text-colour picker is
     * holding, so that gesture is the author's edit and is written as the
     * popover closes — before the reset, which is the order the two intents
     * happened in.
     *
     * Marked globally instead, the picker treats every Reset in the panel as
     * superseding it and the gesture is discarded silently.
     */
    // The link colour, which is the same CSS property at a DESCENDANT — so the
    // trace attributes it separately and it earns its own Reset.
    const editor = mountWithResets([
      { property: "color" },
      { property: "color", descendant: "a" },
    ]);
    await dragTo("#ff0000");

    const resets = screen
      .getAllByRole("button")
      .filter(button => button.dataset.action === "reset");
    // Two, or the case is not about one control's Reset versus another's.
    expect(resets).toHaveLength(2);
    const mine = resetFor("Color");
    const other = resets.find(button => button !== mine);
    expect(other).toBeDefined();
    if (other === undefined) return;
    fireEvent.pointerDown(other);
    fireEvent.click(other);
    await settle();

    expect(editor.applyAll).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(editor.applyAll.mock.calls[0])).toContain("#ff0000");
  });
});
