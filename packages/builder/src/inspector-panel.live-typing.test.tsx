// @vitest-environment jsdom

/**
 * The settings panel's typed fields write as the author types, so the canvas
 * follows each keystroke, and a field edit is still one undo step.
 *
 * Driven through the real editor (`useEditorState`) and the panel as the page
 * builder mounts it. "Before blur" is the point of every case: each keystroke
 * is read from the DOCUMENT, which is what the canvas draws, while the field
 * still has focus.
 *
 * @module inspector-panel.live-typing.test
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  findNode,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { useEditorState, type EditorState } from "./editor-state";
import { escapeFieldEdit } from "./field-edit";
import { InspectorPanel } from "./inspector-panel";

beforeAll(() => {
  // Radix measures and scrolls; jsdom provides neither.
  Element.prototype.scrollIntoView ??= () => {};
  (window as unknown as Record<string, unknown>).ResizeObserver ??=
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

afterEach(cleanup);
afterAll(clearBlocks);

beforeEach(() => {
  clearBlocks();
  registerBlocks(
    [
      {
        name: "acme/card",
        version: 1,
        description: "A card.",
        example: { props: {} },
        editor: { label: "Card" },
        props: {
          title: { type: "text", role: "content" },
          summary: { type: "textarea", role: "content" },
          count: { type: "number", role: "content" },
        },
        supports: {
          spacing: true,
          color: true,
          dimensions: true,
          typography: true,
          effects: true,
        },
        render: () => null,
      },
    ] as never,
    { source: "inspector-live-typing-test" }
  );
});

const PAGE: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "card",
      type: "acme/card",
      version: 1,
      props: { title: "Old title", summary: "Old summary", count: 3 },
      styles: {
        base: {
          [BASE_BREAKPOINT]: {
            padding: { blockStart: "8px" },
            color: "#0000ff",
            width: "12px",
          },
        },
      },
    } as BlockNode,
  ],
} as BlockDocument;

let editorRef: EditorState | null = null;

function editor(): EditorState {
  if (editorRef === null) throw new Error("no editor rendered");
  return editorRef;
}

function Host(): React.JSX.Element {
  const state = useEditorState({ initialDocument: PAGE });
  editorRef = state;
  return <InspectorPanel editor={state} />;
}

function card(): BlockNode {
  const node = findNode(editor().document.nodes, "card");
  if (node === undefined) throw new Error("no card");
  return node;
}

/** The card's base style for `property`, as the canvas draws it. */
function styleOf(property: string): unknown {
  const values = card().styles?.base?.[BASE_BREAKPOINT] as
    | Record<string, unknown>
    | undefined;
  return values?.[property];
}

/** Type `text` one character at a time into `field`, focused as by a click. */
function typeInto(field: HTMLElement, text: string, from = ""): void {
  // Moved for real, so the edit registers against the field and not `body`.
  act(() => field.focus());
  let value = from;
  for (const character of text) {
    value += character;
    fireEvent.change(field, { target: { value } });
  }
}

function mount(): void {
  render(<Host />);
  act(() => editor().select("card"));
}

function openStyle(): void {
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
}

/** A property's row in the Style tab, its section opened where it is closed. */
function row(property: string): ReturnType<typeof within> {
  const find = () =>
    document.querySelector<HTMLElement>(`[data-property="${property}"]`);
  for (const header of document.querySelectorAll<HTMLElement>(
    '[data-section] [data-slot="accordion-trigger"][aria-expanded="false"]'
  )) {
    if (find() !== null) break;
    fireEvent.click(header);
  }
  const found = find();
  if (found === null) throw new Error(`no row for ${property}`);
  return within(found);
}

describe("the Content tab's typed fields", () => {
  it("writes a text field's every keystroke before blur, as one undo step", () => {
    mount();
    const field = screen.getByLabelText("Title");
    fireEvent.change(field, { target: { value: "" } });
    typeInto(field, "New");
    expect(card().props.title).toBe("New");
    expect(editor().undoDepth).toBe(1);

    fireEvent.blur(field);
    expect(editor().undoDepth).toBe(1);
    act(() => {
      void editor().undo();
    });
    expect(card().props.title).toBe("Old title");
    expect((field as HTMLInputElement).value).toBe("Old title");
  });

  it("puts the old text back on Escape, on the canvas too, and records nothing", () => {
    mount();
    const field = screen.getByLabelText("Title") as HTMLInputElement;
    typeInto(field, " half typed", "Old title");
    expect(card().props.title).toBe("Old title half typed");

    // Escape in another field is that field's, and leaves this run alone.
    const other = screen.getByLabelText("Summary");
    expect(escapeFieldEdit(other)).not.toBe("put-back");
    expect(card().props.title).toBe("Old title half typed");

    // What the keyboard layer asks of the field Escape is pressed in.
    let outcome: string | undefined;
    act(() => {
      outcome = escapeFieldEdit(field);
    });
    expect(outcome).toBe("put-back");
    expect(card().props.title).toBe("Old title");
    expect(field.value).toBe("Old title");
    expect(editor().canUndo).toBe(false);
    // The next Escape leaves the field, as for any field.
    expect(escapeFieldEdit(field)).toBe("leave-field");
  });

  it("shows what the canvas holds when Escape can no longer take the run back", () => {
    mount();
    const field = screen.getByLabelText("Title") as HTMLInputElement;
    typeInto(field, " half typed", "Old title");
    // Another edit lands first, so the run's step is no longer the newest and
    // Escape cannot withdraw it: the text typed stays on the canvas.
    act(() => {
      editor().apply({
        kind: "update",
        id: "card",
        patch: { props: { ...card().props, summary: "Other words" } },
      });
    });
    act(() => {
      escapeFieldEdit(field);
    });
    expect(card().props.title).toBe("Old title half typed");
    expect(field.value).toBe("Old title half typed");
  });

  it("puts a Style value back on Escape, as it was before the edit", () => {
    mount();
    openStyle();
    const field = row("padding").getByLabelText(
      "Block start"
    ) as HTMLInputElement;
    act(() => field.focus());
    fireEvent.change(field, { target: { value: "" } });
    typeInto(field, "24");
    expect(styleOf("padding")).toEqual({ blockStart: "24px" });
    act(() => {
      escapeFieldEdit(field);
    });
    expect(styleOf("padding")).toEqual({ blockStart: "8px" });
    expect(editor().canUndo).toBe(false);
  });

  it("is the control: a second edit after blur is a step of its own", () => {
    mount();
    const field = screen.getByLabelText("Title");
    typeInto(field, "!", "Old title");
    fireEvent.blur(field);
    typeInto(field, "?", "Old title!");
    fireEvent.blur(field);
    expect(card().props.title).toBe("Old title!?");
    expect(editor().undoDepth).toBe(2);
  });

  it("ends the step on Enter", () => {
    mount();
    const field = screen.getByLabelText("Title");
    typeInto(field, "!", "Old title");
    fireEvent.keyDown(field, { key: "Enter" });
    typeInto(field, "?", "Old title!");
    expect(editor().undoDepth).toBe(2);
  });

  it("leaves the Enter that confirms an input method's characters to it", () => {
    mount();
    const field = screen.getByLabelText("Title");
    typeInto(field, "!", "Old title");
    // The keydown that picks a candidate while composing is the IME's: it
    // must not end the step, nor be kept from the IME.
    const composing = fireEvent.keyDown(field, {
      key: "Enter",
      isComposing: true,
    });
    expect(composing).toBe(true);
    typeInto(field, "?", "Old title!");
    expect(editor().undoDepth).toBe(1);
  });

  it("leaves a Style field's composing Enter to the input method too", () => {
    mount();
    openStyle();
    const field = row("width").getByLabelText("Width") as HTMLInputElement;
    act(() => field.focus());
    fireEvent.change(field, { target: { value: "" } });
    typeInto(field, "2");
    expect(fireEvent.keyDown(field, { key: "Enter", isComposing: true })).toBe(
      true
    );
    typeInto(field, "0", "2");
    expect(styleOf("width")).toBe("20px");
    expect(editor().undoDepth).toBe(1);
  });

  it("writes a textarea as it is typed", () => {
    mount();
    const field = screen.getByLabelText("Summary");
    typeInto(field, " more", "Old summary");
    expect(card().props.summary).toBe("Old summary more");
    expect(editor().undoDepth).toBe(1);
  });

  it("writes a number as it is typed and keeps the last one while it is not a number", () => {
    mount();
    const field = screen.getByLabelText("Count") as HTMLInputElement;
    typeInto(field, "2", "1");
    expect(card().props.count).toBe(12);
    // Emptied on the way to the next number: the canvas keeps 12.
    fireEvent.change(field, { target: { value: "" } });
    expect(card().props.count).toBe(12);
    expect(field.value).toBe("");
    // Left while it is not a number: the field shows the last one again.
    fireEvent.blur(field);
    expect(field.value).toBe("12");
    expect(editor().undoDepth).toBe(1);
    act(() => {
      void editor().undo();
    });
    expect(card().props.count).toBe(3);
  });
});

describe("the Style tab's typed fields", () => {
  it("writes a padding value before blur, and keeps the last valid one while a unit is typed", () => {
    mount();
    openStyle();
    const field = row("padding").getByLabelText(
      "Block start"
    ) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "" } });
    typeInto(field, "24");
    expect(styleOf("padding")).toEqual({ blockStart: "24px" });
    // The field shows what was typed, not the stored spelling.
    expect(field.value).toBe("24");

    typeInto(field, "p", "24");
    // Not a length yet: the canvas keeps 24px, and the field says why.
    expect(styleOf("padding")).toEqual({ blockStart: "24px" });
    expect(field.value).toBe("24p");
    expect(field.getAttribute("aria-invalid")).toBe("true");

    typeInto(field, "x", "24p");
    expect(styleOf("padding")).toEqual({ blockStart: "24px" });
    expect(field.getAttribute("aria-invalid")).toBeNull();

    fireEvent.blur(field);
    expect(editor().undoDepth).toBe(1);
    act(() => {
      void editor().undo();
    });
    expect(styleOf("padding")).toEqual({ blockStart: "8px" });
  });

  it("keeps the previous colour while half a hex colour is typed", () => {
    mount();
    openStyle();
    row("color");
    const field = document.querySelector<HTMLInputElement>(
      '[data-property="color"] input'
    );
    if (field === null) throw new Error("no colour field");
    fireEvent.change(field, { target: { value: "" } });
    typeInto(field, "#ff");
    expect(styleOf("color")).toBe("#0000ff");
    typeInto(field, "0000", "#ff");
    expect(styleOf("color")).toBe("#ff0000");
    fireEvent.blur(field);
    expect(editor().undoDepth).toBe(1);
    act(() => {
      void editor().undo();
    });
    expect(styleOf("color")).toBe("#0000ff");
  });

  it("keeps a unit picked straight after typing in the same undo step", () => {
    mount();
    openStyle();
    const field = row("width").getByLabelText("Width") as HTMLInputElement;
    const unit = row("width").getByLabelText("Unit for Width");
    fireEvent.change(field, { target: { value: "" } });
    typeInto(field, "20");
    expect(styleOf("width")).toBe("20px");
    // Focus moves from the field to its unit menu, and rem is picked.
    fireEvent.blur(field, { relatedTarget: unit });
    fireEvent.click(unit);
    fireEvent.click(screen.getByRole("option", { name: "rem" }));
    expect(styleOf("width")).toBe("20rem");
    expect(editor().undoDepth).toBe(1);
    act(() => {
      void editor().undo();
    });
    expect(styleOf("width")).toBe("12px");
  });

  it("shows the stored unit beside the number again once Escape puts it back", () => {
    mount();
    openStyle();
    const field = row("width").getByLabelText("Width") as HTMLInputElement;
    act(() => field.focus());
    fireEvent.change(field, { target: { value: "" } });
    typeInto(field, "20");
    expect(styleOf("width")).toBe("20px");
    act(() => {
      escapeFieldEdit(field);
    });
    expect(styleOf("width")).toBe("12px");
    // "12" beside a "px" suffix, as before the edit, not "12px" alone.
    expect(field.value).toBe("12");
    expect(row("width").getByLabelText("Unit for Width").textContent).toBe(
      "px"
    );
    expect(document.activeElement).toBe(field);
  });

  it("writes a line height as it is typed, a number or a length", () => {
    mount();
    openStyle();
    const field = screen.getByLabelText("Line height") as HTMLInputElement;
    typeInto(field, "1.8");
    expect(styleOf("lineHeight")).toBe(1.8);
    typeInto(field, "p", "1.8");
    // "1.8p" is neither: the canvas keeps 1.8.
    expect(styleOf("lineHeight")).toBe(1.8);
    typeInto(field, "x", "1.8p");
    expect(styleOf("lineHeight")).toBe("1.8px");
    fireEvent.blur(field);
    expect(editor().undoDepth).toBe(1);
    act(() => {
      void editor().undo();
    });
    expect(styleOf("lineHeight")).toBeUndefined();
  });
});

describe("the Style tab's drags", () => {
  /** The frames asked for and not yet drawn, run by `frame()`. */
  let frames: FrameRequestCallback[] = [];
  function frame(): void {
    const due = frames;
    frames = [];
    act(() => {
      for (const draw of due) draw(0);
    });
  }
  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (draw: FrameRequestCallback) => {
      frames.push(draw);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames[id - 1] = () => undefined;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A pointer event carrying the fields the gesture and React read. */
  function pointer(type: string, clientX: number): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      pointerId: 1,
      button: 0,
      clientX,
      clientY: 0,
      pointerType: "mouse",
      shiftKey: false,
      altKey: false,
    });
    return event;
  }

  /** Press on padding's Block start label, and move to `x` from the press. */
  function pressAndMove(...xs: number[]): HTMLInputElement {
    mount();
    openStyle();
    const field = row("padding").getByLabelText(
      "Block start"
    ) as HTMLInputElement;
    const label = document.querySelector(`label[for="${field.id}"]`);
    if (!(label instanceof HTMLElement)) throw new Error("no label");
    act(() => {
      label.dispatchEvent(pointer("pointerdown", 100));
    });
    for (const x of xs) {
      act(() => {
        document.dispatchEvent(pointer("pointermove", 100 + x));
      });
    }
    return field;
  }

  it("moves the canvas as a label is dragged, and the drag is one undo step", () => {
    pressAndMove(10);
    frame();
    expect(styleOf("padding")).toEqual({ blockStart: "18px" });
    act(() => {
      document.dispatchEvent(pointer("pointermove", 120));
    });
    frame();
    expect(styleOf("padding")).toEqual({ blockStart: "28px" });

    act(() => {
      document.dispatchEvent(pointer("pointerup", 125));
    });
    expect(styleOf("padding")).toEqual({ blockStart: "33px" });
    expect(editor().undoDepth).toBe(1);
    act(() => {
      void editor().undo();
    });
    expect(styleOf("padding")).toEqual({ blockStart: "8px" });
  });

  it("moves the canvas as the line height's label is dragged", () => {
    mount();
    openStyle();
    const field = screen.getByLabelText("Line height") as HTMLInputElement;
    typeInto(field, "1.5");
    fireEvent.blur(field);
    const label = document.querySelector(`label[for="${field.id}"]`);
    if (!(label instanceof HTMLElement)) throw new Error("no label");
    act(() => {
      label.dispatchEvent(pointer("pointerdown", 100));
    });
    act(() => {
      document.dispatchEvent(pointer("pointermove", 110));
    });
    frame();
    const dragged = styleOf("lineHeight");
    expect(dragged).not.toBe(1.5);
    expect(dragged).toBe(Number(field.value));

    act(() => {
      document.dispatchEvent(pointer("pointerup", 110));
    });
    // The typed value is one step, and the drag one more.
    expect(editor().undoDepth).toBe(2);
    act(() => {
      void editor().undo();
    });
    expect(styleOf("lineHeight")).toBe(1.5);
  });

  it("moves the canvas as the opacity slider moves, as one undo step", () => {
    mount();
    openStyle();
    row("opacity");
    const thumb = screen.getByRole("slider", { name: "Opacity slider" });
    // The slider's root: the nearest element with an orientation above the
    // thumb, which carries one itself (the panel's tabs carry one too).
    const track =
      thumb.parentElement?.closest<HTMLElement>("[data-orientation]");
    if (track === null || track === undefined) throw new Error("no slider");
    // The track is 100px wide from the left edge, so x is the percent; the
    // pointer is captured, as a real press captures it.
    track.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 100,
        width: 100,
        top: 0,
        bottom: 10,
        height: 10,
      }) as DOMRect;
    const captured = Element.prototype as unknown as Record<string, unknown>;
    captured.setPointerCapture = () => {};
    captured.releasePointerCapture = () => {};
    captured.hasPointerCapture = () => true;

    act(() => {
      track.dispatchEvent(pointer("pointerdown", 40));
    });
    frame();
    expect(styleOf("opacity")).toBe(0.4);
    act(() => {
      track.dispatchEvent(pointer("pointermove", 30));
    });
    frame();
    expect(styleOf("opacity")).toBe(0.3);
    act(() => {
      track.dispatchEvent(pointer("pointerup", 30));
    });
    expect(editor().undoDepth).toBe(1);
    act(() => {
      void editor().undo();
    });
    expect(styleOf("opacity")).toBeUndefined();
  });

  it("puts the canvas back on Escape mid-drag, and records nothing", () => {
    const field = pressAndMove(10);
    frame();
    expect(styleOf("padding")).toEqual({ blockStart: "18px" });
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", cancelable: true })
      );
    });
    expect(styleOf("padding")).toEqual({ blockStart: "8px" });
    expect(editor().undoDepth).toBe(0);
    expect(field.value).toBe("8");
  });
});
