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
  DEFAULT_LIMITS,
  findNode,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type DocumentLimits,
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
  vi,
} from "vitest";

import { useEditorState, type EditorState } from "../../editor-state";
import { escapeFieldEdit } from "../../field-edit";
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
  siteTokens = TOKENS;
  siteLimits = undefined;
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
    // A variable named as a CSS colour is.
    {
      name: "color.red",
      label: "Red",
      kind: "color",
      values: { light: "#cc0000" },
    },
    // Two variables an author named alike.
    {
      name: "color.accent.one",
      label: "Accent",
      kind: "color",
      values: { light: "#111111" },
    },
    {
      name: "color.accent.two",
      label: "Accent",
      kind: "color",
      values: { light: "#222222" },
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
/** The site's variables a test runs with: {@link TOKENS} unless it says. */
let siteTokens: SiteTokenSet = TOKENS;
/** The caps the page is held to: the editor's own unless a test says. */
let siteLimits: DocumentLimits | undefined;

function editor(): EditorState {
  if (editorRef === null) throw new Error("no editor rendered");
  return editorRef;
}

function Host(): React.JSX.Element {
  const state = useEditorState({
    initialDocument: PAGE,
    ...(siteLimits === undefined ? {} : { limits: siteLimits }),
  });
  editorRef = state;
  return <InspectorPanel editor={state} tokens={siteTokens} />;
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

/** One animation frame, after which focus moved after a choice has landed. */
async function frame(): Promise<void> {
  await act(async () => {
    await new Promise(done => requestAnimationFrame(() => done(null)));
  });
}

describe("what a colour box says, and where it leaves focus", () => {
  it("shows each suggestion's light and dark swatches beside its name", () => {
    const box = mount();
    typeInto(box, "yellow 5");
    const list = screen.getByRole("listbox", {
      name: "Matching color variables",
    });
    for (const option of within(list).getAllByRole("option")) {
      expect(option.querySelectorAll(".nx-vars__swatch")).toHaveLength(2);
    }
  });

  it("drops its refusal once the colour is chosen another way", () => {
    const box = mount();
    typeInto(box, "yellow 50");
    fireEvent.blur(box);
    expect(screen.getByRole("alert").textContent).toContain("yellow 50");
    // Picked from the swatch's own list, not typed.
    fireEvent.click(screen.getByRole("button", { name: /^Colour for Colour/ }));
    fireEvent.click(
      within(
        screen.getByRole("listbox", { name: "Colour variables" })
      ).getByRole("option", { name: "Yellow 500" })
    );
    expect(colourOf()).toEqual({ $token: "color.yellow.500" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when more than one variable has the name typed", () => {
    const box = mount();
    typeInto(box, "accent");
    fireEvent.blur(box);
    expect(colourOf()).toBe("#0000ff");
    expect(
      screen.getAllByRole("alert").map(alert => alert.textContent)
    ).toEqual([
      'More than one variable is called "accent". Choose one from the list.',
    ]);
  });

  it("leaves the Enter that confirms an input method's characters to it", () => {
    const box = mount();
    typeInto(box, "yellow 5");
    // Safari's confirming Enter is key 229, not marked as composing.
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
    expect(colourOf()).toBe("#0000ff");
  });

  it("puts focus on the variable it connects, not on the page", async () => {
    const box = mount();
    typeInto(box, "yellow 5");
    fireEvent.keyDown(box, { key: "Enter" });
    await frame();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /^Colour for Colour: Yellow 500/ })
    );
  });

  it("stays closed when Escape puts the old text back", () => {
    const box = mount();
    // A stored colour the list would answer: Yellow 300's own value.
    typeInto(box, "#fde68a");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(colourOf()).toBe("#fde68a");
    typeInto(box, "yellow 5");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(suggestions()).toEqual([]);
    fireEvent.keyDown(box, { key: "Escape" });
    act(() => {
      escapeFieldEdit(box);
    });
    expect(box.value).toBe("#fde68a");
    expect(suggestions()).toEqual([]);
  });
});

describe("a colour box over a variable's own typing", () => {
  it('writes the colour "red", not the variable called "Red", on Enter or blur', () => {
    const box = mount();
    typeInto(box, "red");
    // Offered, and not highlighted: the text is a colour of its own.
    expect(suggestions()).toEqual(["Red"]);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(colourOf()).toBe("red");
    typeInto(box, "Red");
    fireEvent.blur(box);
    expect(colourOf()).toBe("Red");
  });

  it("makes a hex typed live and the variable chosen for it one step of undo", () => {
    const box = mount();
    typeInto(box, "#fde68a");
    // Written as it was typed.
    expect(colourOf()).toBe("#fde68a");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(colourOf()).toEqual({ $token: "color.yellow.300" });
    act(() => editor().undo());
    expect(colourOf()).toBe("#0000ff");
  });
});

describe("a colour box's list, over a longer edit", () => {
  it("refuses a name two variables share once spaces and hyphens are set aside", () => {
    siteTokens = {
      tokens: [
        ...TOKENS.tokens,
        {
          name: "color.yellow.500b",
          label: "Yellow-500",
          kind: "color",
          values: { light: "#f0c000" },
        },
      ],
    };
    const box = mount();
    typeInto(box, "Yellow 500");
    fireEvent.blur(box);
    expect(colourOf()).toBe("#0000ff");
    expect(
      screen.getAllByRole("alert").map(alert => alert.textContent)
    ).toEqual([
      'More than one variable is called "Yellow 500". Choose one from the list.',
    ]);
  });

  it("offers the list again after Escape once the text is edited, even back to the same text", () => {
    const box = mount();
    typeInto(box, "yellow 5");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(suggestions()).toEqual([]);
    fireEvent.change(box, { target: { value: "yellow 50" } });
    expect(suggestions()).toEqual(["Yellow 500", "Yellow 300"]);
    fireEvent.change(box, { target: { value: "yellow 5" } });
    expect(suggestions()).toEqual(["Yellow 500", "Yellow 300"]);
  });

  it("keeps the highlighted entry in sight as the arrows move it", () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    try {
      const box = mount();
      typeInto(box, "yellow");
      scrolled.mockClear();
      fireEvent.keyDown(box, { key: "ArrowDown" });
      fireEvent.keyDown(box, { key: "ArrowDown" });
      const active = box.getAttribute("aria-activedescendant");
      expect(active).not.toBeNull();
      expect(scrolled.mock.contexts.at(-1)).toBe(
        document.getElementById(active ?? "")
      );
    } finally {
      scrolled.mockRestore();
    }
  });

  it("leaves modified arrows to the box, for selecting and moving through the text", () => {
    const box = mount();
    typeInto(box, "yellow 5");
    const first = box.getAttribute("aria-activedescendant");
    for (const chord of [
      { shiftKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
    ]) {
      // Not prevented: the box extends its selection or moves its caret.
      expect(fireEvent.keyDown(box, { key: "ArrowDown", ...chord })).toBe(true);
      expect(fireEvent.keyDown(box, { key: "ArrowUp", ...chord })).toBe(true);
    }
    expect(box.getAttribute("aria-activedescendant")).toBe(first);
  });

  it("starts each edit from the top entry, even back to text an arrow moved on", () => {
    const box = mount();
    typeInto(box, "yellow 5");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.change(box, { target: { value: "yellow 50" } });
    fireEvent.change(box, { target: { value: "yellow 5" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(colourOf()).toEqual({ $token: "color.yellow.500" });
  });

  it("drops its refusal once undo puts other text in the box", () => {
    const box = mount();
    typeInto(box, "#ff0000");
    fireEvent.blur(box);
    expect(colourOf()).toBe("#ff0000");
    typeInto(box, "yellow 50");
    fireEvent.blur(box);
    expect(screen.getByRole("alert").textContent).toContain("yellow 50");
    act(() => {
      void editor().undo();
    });
    expect(colourOf()).toBe("#0000ff");
    expect(box.value).toBe("#0000ff");
    expect(screen.queryByText(/No color or variable/)).toBeNull();
    expect(box.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("keeps focus, and the text, in the box when the suggestion's write is refused", async () => {
    // A page with no room for a reference, which is longer than the colour.
    siteLimits = {
      ...DEFAULT_LIMITS,
      maxBytes: new TextEncoder().encode(JSON.stringify(PAGE)).length + 2,
    };
    const box = mount();
    typeInto(box, "yellow 5");
    fireEvent.keyDown(box, { key: "Enter" });
    await frame();
    expect(colourOf()).not.toEqual({ $token: "color.yellow.500" });
    expect(document.activeElement).toBe(box);
    expect(box.value).toBe("yellow 5");
    expect(screen.queryByText(/No color or variable/)).toBeNull();
  });
});
