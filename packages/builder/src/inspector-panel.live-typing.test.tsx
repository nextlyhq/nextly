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
} from "vitest";

import { useEditorState, type EditorState } from "./editor-state";
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
        supports: { spacing: true, color: true, dimensions: true },
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
  return (
    card().styles?.base?.[BASE_BREAKPOINT] as Record<string, unknown>
  )[property];
}

/** Type `text` one character at a time into `field`, still focused. */
function typeInto(field: HTMLElement, text: string, from = ""): void {
  fireEvent.focus(field);
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
    const field = row("padding").getByLabelText("Block start") as HTMLInputElement;
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
});
