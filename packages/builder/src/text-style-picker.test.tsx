// @vitest-environment jsdom

/**
 * The Style tab's "Text style" picker, at the top of its Text section, and
 * the words a block's own typography says over the text style it wears,
 * driven through the inspector against a real editor's shape.
 *
 * @module text-style-picker.test
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type NamedClass,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";
import { describeProvenance } from "./style-inspector-panel";
import type { SharedStylesHost } from "./style-target";

afterEach(() => {
  cleanup();
  clearBlocks();
});

beforeAll(() => {
  // Radix measures and scrolls; jsdom provides neither.
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

const base = (values: Record<string, unknown>): NodeStyles =>
  ({ base: { [BASE_BREAKPOINT]: values } }) as unknown as NodeStyles;

const eyebrow: NamedClass = {
  id: "t-eyebrow",
  slug: "eyebrow",
  label: "Eyebrow",
  orderIndex: 3,
  role: "text",
  styles: base({
    fontSize: "12px",
    lineHeight: 1.4,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  }),
};
const display: NamedClass = {
  id: "t-display",
  slug: "display",
  label: "Display",
  orderIndex: 2,
  role: "text",
  styles: base({ fontSize: "56px", lineHeight: 1.05, fontWeight: 700 }),
};
const card: NamedClass = {
  id: "c-card",
  slug: "card",
  label: "Card",
  orderIndex: 0,
  styles: base({ opacity: 0.5 }),
};

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
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState & { applyAll: ReturnType<typeof vi.fn> };
}

/** The inspector's Style tab over a block wearing `classes`. */
function mount(
  options: {
    classes?: string[];
    styles?: NodeStyles;
    locked?: boolean;
    library?: readonly NamedClass[];
  } = {}
) {
  registerBlocks(
    [
      {
        name: "acme/text",
        version: 1,
        description: "Some text.",
        example: { props: {} },
        editor: { label: "Text" },
        props: { text: { type: "text" } },
        supports: { typography: true, effects: true },
        render: () => null,
      },
    ] as never,
    { source: "text-style-picker-test" }
  );
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "acme/text",
        version: 1,
        props: {},
        ...(options.classes === undefined ? {} : { classes: options.classes }),
        ...(options.styles === undefined ? {} : { styles: options.styles }),
        ...(options.locked === true ? { locked: true } : {}),
      },
    ] as BlockNode[],
  } as BlockDocument;
  const editor = editorFor(document);
  render(
    <InspectorPanel
      editor={editor}
      classLibrary={options.library ?? [card, display, eyebrow]}
      sharedStyles={{
        mayChange: true,
        writeStyles: vi.fn(
          async () => undefined
        ) as unknown as SharedStylesHost["writeStyles"],
      }}
    />
  );
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
  const header = globalThis.document.querySelector(
    '[data-section="typography"] [data-slot="accordion-trigger"]'
  );
  if (header === null) throw new Error("no Text section");
  if (header.getAttribute("aria-expanded") !== "true") fireEvent.click(header);
  return editor;
}

/** The picker's button, named with what the block wears. */
const picker = () => screen.getByRole("button", { name: /^Text style, / });

/** Open the picker's list, as a pointer press does. */
function openPicker(): HTMLElement {
  fireEvent.pointerDown(picker(), { button: 0, ctrlKey: false });
  return screen.getByRole("menu");
}

describe("the Text style picker", () => {
  it("sits at the top of the Text section, saying the block wears none", () => {
    mount();
    const section = picker().closest("[data-section]");
    expect(section?.getAttribute("data-section")).toBe("typography");
    expect(picker().getAttribute("aria-label")).toBe("Text style, None");
  });

  it("lists the site's text styles with a preview each, and no shared style", () => {
    mount();
    const menu = openPicker();
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map(item => item.getAttribute("data-text-style"))).toEqual([
      "",
      "t-display",
      "t-eyebrow",
    ]);
    const sample = within(items[2] as HTMLElement).getByText(
      "The quick survey"
    );
    expect(sample.style.textTransform).toBe("uppercase");
    expect(sample.style.letterSpacing).toBe("0.08em");
    expect(within(menu).queryByText("Card")).toBeNull();
  });

  it("gives the block the one text style picked, beside its other classes", () => {
    const editor = mount({ classes: ["c-card"] });
    fireEvent.click(
      within(openPicker()).getByRole("menuitemradio", { name: /^Eyebrow/ })
    );
    expect(editor.applyAll).toHaveBeenCalledWith([
      { kind: "update", id: "a", patch: { classes: ["c-card", "t-eyebrow"] } },
    ]);
  });

  it("replaces the one the block wears, and None takes it off", () => {
    const editor = mount({ classes: ["t-eyebrow"] });
    expect(picker().getAttribute("aria-label")).toBe("Text style, Eyebrow");
    fireEvent.click(
      within(openPicker()).getByRole("menuitemradio", { name: /^Display/ })
    );
    expect(editor.applyAll).toHaveBeenLastCalledWith([
      { kind: "update", id: "a", patch: { classes: ["t-display"] } },
    ]);
    fireEvent.click(
      within(openPicker()).getByRole("menuitemradio", { name: /^None/ })
    );
    expect(editor.applyAll).toHaveBeenLastCalledWith([
      { kind: "update", id: "a", patch: {}, unset: ["classes"] },
    ]);
  });

  it("is held while the block's design is", () => {
    mount({ locked: true });
    expect(picker().matches(":disabled")).toBe(true);
  });

  it("says where text styles are made when the site has none", () => {
    mount({ library: [card] });
    expect(screen.queryByRole("button", { name: /^Text style, / })).toBeNull();
    expect(screen.getByText(/No text styles yet/)).toBeDefined();
  });

  it("keeps a worn text style out of the shared styles the bar lists", () => {
    mount({ classes: ["t-eyebrow"] });
    const bar = screen.getByRole("region", { name: "What you're editing" });
    fireEvent.pointerDown(
      within(bar).getByRole("button", { name: /^Editing: / }),
      { button: 0, ctrlKey: false }
    );
    const menu = screen.getByRole("menu");
    expect(within(menu).queryByText("Eyebrow")).toBeNull();
    // Wearing a text style leaves the block free to wear a shared style.
    const apply = within(menu).getByRole("menuitem", {
      name: /^Apply a shared style…/,
    });
    expect(apply.getAttribute("aria-disabled")).not.toBe("true");
  });
});

describe("a block's own value over its text style", () => {
  it('says "Changed from Eyebrow", and Reset shows the text style\'s value again', () => {
    const editor = mount({
      classes: ["t-eyebrow"],
      styles: base({ fontSize: "20px" }),
    });
    const line = document.querySelector('[data-shared-line="override"]');
    expect(line?.querySelector("[data-shared-line-text]")?.textContent).toBe(
      "Changed from Eyebrow"
    );
    fireEvent.click(
      within(line as HTMLElement).getByRole("button", {
        name: /^Reset .* on this block, showing Eyebrow's value/,
      })
    );
    expect(editor.applyAll.mock.calls[0]?.[0]?.[0]).toEqual({
      kind: "update",
      id: "a",
      patch: {},
      unset: ["styles"],
    });
  });

  it("says nothing over a value the text style leaves alone", () => {
    mount({ classes: ["t-eyebrow"], styles: base({ opacity: 0.4 }) });
    expect(document.querySelector('[data-shared-line="override"]')).toBeNull();
  });
});

describe("where a value came from", () => {
  const editing = {
    nodeId: "a",
    blockType: "acme/text",
    state: "base" as never,
    breakpoint: BASE_BREAKPOINT,
    labelOf: (id: string) => id,
    sharedStyleName: (slug: string) =>
      slug === "eyebrow" ? "Eyebrow" : undefined,
  };
  const entry = {
    property: "font-size",
    value: "12px",
    state: "base",
    breakpoint: BASE_BREAKPOINT,
  } as never;

  it('names a text style as one: "From text style: Eyebrow"', () => {
    const said = describeProvenance(
      {
        kind: "inherited",
        entry,
        from: { kind: "class", id: "t-eyebrow", slug: "eyebrow", role: "text" },
      } as never,
      editing as never
    );
    expect(said?.text).toBe("From text style: Eyebrow");
    expect(said?.kind === "inherited" && said.source).toBe(
      "From text style: Eyebrow"
    );
  });

  it("still names a shared style by its name alone", () => {
    expect(
      describeProvenance(
        {
          kind: "inherited",
          entry,
          from: { kind: "class", id: "c-card", slug: "card" },
        } as never,
        { ...editing, sharedStyleName: () => "Card" } as never
      )?.text
    ).toBe("From Card");
  });
});
