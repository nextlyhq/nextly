// @vitest-environment jsdom

/**
 * A colour box lists the site's colour variables as it is typed in, and a
 * typed name connects one: in the inspector, on a real editor, with the site's
 * "Yellow 500" (#f5c518) and "Yellow 300" (#fde68a), over a block whose colour
 * is a plain #0000ff.
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  findNode,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type SiteTokenSet,
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

import { useEditorState, type EditorState } from "../../editor-state";
import { InspectorPanel } from "../inspector-panel";

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
        props: {},
        supports: { color: true, typography: true },
        render: () => null,
      },
    ] as never,
    { source: "typed-colour-suggestions-test" }
  );
});

const TOKENS: SiteTokenSet = {
  tokens: [
    {
      name: "color.yellow.500",
      label: "Yellow 500",
      kind: "color",
      values: { light: "#f5c518", dark: "#e0b000" },
    },
    {
      name: "color.yellow.300",
      label: "Yellow 300",
      kind: "color",
      values: { light: "#fde68a" },
    },
  ],
};

const PAGE: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "card",
      type: "acme/card",
      version: 1,
      props: {},
      styles: { base: { [BASE_BREAKPOINT]: { color: "#0000ff" } } },
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
  return <InspectorPanel editor={state} tokens={TOKENS} />;
}

function colourOf(): unknown {
  const node = findNode(editor().document.nodes, "card");
  const values = node?.styles?.base?.[BASE_BREAKPOINT] as
    | Record<string, unknown>
    | undefined;
  return values?.color;
}

/** The text colour's box, its section opened. */
function colourBox(): HTMLInputElement {
  const find = () =>
    document.querySelector<HTMLInputElement>('[data-property="color"] input');
  for (const header of document.querySelectorAll<HTMLElement>(
    '[data-section] [data-slot="accordion-trigger"][aria-expanded="false"]'
  )) {
    if (find() !== null) break;
    fireEvent.click(header);
  }
  const box = find();
  if (box === null) throw new Error("no colour box");
  return box;
}

function mount(): HTMLInputElement {
  render(<Host />);
  act(() => editor().select("card"));
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
  return colourBox();
}

/** Types `text` into the box from empty, one key at a time, as an author does. */
function typeInto(box: HTMLInputElement, text: string): void {
  act(() => box.focus());
  let value = "";
  fireEvent.change(box, { target: { value } });
  for (const character of text) {
    value += character;
    fireEvent.change(box, { target: { value } });
  }
}

function suggestions(): string[] {
  const list = screen.queryByRole("listbox", {
    name: "Matching color variables",
  });
  if (list === null) return [];
  return within(list)
    .getAllByRole("option")
    .map(option => option.textContent ?? "");
}

describe("a colour box suggests the site's colour variables", () => {
  it('lists "Yellow 500" first, then "Yellow 300", for "yellow 5"', () => {
    const box = mount();
    typeInto(box, "yellow 5");
    expect(suggestions()).toEqual(["Yellow 500", "Yellow 300"]);
    expect(box.getAttribute("role")).toBe("combobox");
    expect(box.getAttribute("aria-expanded")).toBe("true");
  });

  it("lists the variable holding a typed hex colour", () => {
    const box = mount();
    typeInto(box, "#f5c518");
    expect(suggestions()).toEqual(["Yellow 500"]);
  });

  it("offers nothing before anything is typed", () => {
    const box = mount();
    act(() => box.focus());
    expect(suggestions()).toEqual([]);
    // A plain text box while nothing is offered, as every style field is.
    expect(box.getAttribute("role")).toBeNull();
    expect(box.getAttribute("aria-expanded")).toBeNull();
  });
});

describe("what a colour box writes", () => {
  it("connects the highlighted variable on Enter, as a reference", () => {
    const box = mount();
    typeInto(box, "yellow 5");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(colourOf()).toEqual({ $token: "color.yellow.500" });
  });

  it('writes the colour "yellow" on Enter, and keeps the list as suggestions', () => {
    const box = mount();
    typeInto(box, "yellow");
    expect(suggestions()).toEqual(["Yellow 300", "Yellow 500"]);
    // Nothing is highlighted: the text is a colour of its own.
    expect(box.getAttribute("aria-activedescendant")).toBeNull();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(colourOf()).toBe("yellow");
    expect(suggestions()).toEqual(["Yellow 300", "Yellow 500"]);
  });

  it("connects a variable whose whole name is left in the box", () => {
    const box = mount();
    // Spaced and cased as typed, not as the list shows it.
    typeInto(box, "yellow-500");
    fireEvent.blur(box);
    expect(colourOf()).toEqual({ $token: "color.yellow.500" });
  });

  it("keeps the colour from before, and says only why, for text no colour or name answers", () => {
    const box = mount();
    typeInto(box, "yellow 50");
    fireEvent.blur(box);
    expect(colourOf()).toBe("#0000ff");
    expect(editor().undoDepth).toBe(0);
    const alerts = screen.getAllByRole("alert");
    expect(alerts.map(alert => alert.textContent)).toEqual([
      'No color or variable is called "yellow 50".',
    ]);
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByText(/Not adapted to dark mode/)).toBeNull();
  });

  it("says the colour is not adapted to dark mode again once a colour is written", () => {
    const box = mount();
    typeInto(box, "yellow 50");
    fireEvent.blur(box);
    typeInto(box, "red");
    fireEvent.blur(box);
    expect(colourOf()).toBe("red");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/Not adapted to dark mode/)).toBeTruthy();
  });
});

describe("a colour box's suggestions by keyboard", () => {
  it("moves the highlight with the arrows and connects it with Enter", () => {
    const box = mount();
    typeInto(box, "yellow 5");
    const options = () =>
      within(
        screen.getByRole("listbox", { name: "Matching color variables" })
      ).getAllByRole("option");
    expect(box.getAttribute("aria-activedescendant")).toBe(options()[0]?.id);
    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box.getAttribute("aria-activedescendant")).toBe(options()[1]?.id);
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box.getAttribute("aria-activedescendant")).toBe(options()[0]?.id);
    fireEvent.keyDown(box, { key: "ArrowUp" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(colourOf()).toEqual({ $token: "color.yellow.300" });
  });

  it("closes the list on Escape, keeping what is typed", () => {
    const box = mount();
    typeInto(box, "yellow 5");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(suggestions()).toEqual([]);
    expect(box.getAttribute("role")).toBeNull();
    expect(box.value).toBe("yellow 5");
    expect(colourOf()).toBe("#0000ff");
  });

  it("names the list the box controls while it is open", () => {
    const box = mount();
    typeInto(box, "yellow");
    const list = screen.getByRole("listbox", {
      name: "Matching color variables",
    });
    expect(box.getAttribute("aria-controls")).toBe(list.id);
    expect(box.getAttribute("aria-autocomplete")).toBe("list");
  });
});
