// @vitest-environment jsdom

/**
 * A block's colour picker lists the site's colour variables first, then the
 * author's Recent colours, then the custom picker; choosing a recent colour
 * writes it as the value it is, and every raw colour the field writes joins
 * the list.
 *
 * @module style-colour-recent.test
 */
import {
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

import { useEditorState, type EditorState } from "../../editor-state";
import { RecentColoursStore } from "../../recent-colours";
import type { PreferenceStore } from "../../shell-state";
import { StyleInspectorPanel } from "./style-inspector-panel";

afterEach(() => {
  cleanup();
  clearBlocks();
});

beforeAll(() => {
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

const TOKENS: SiteTokenSet = {
  tokens: [
    {
      name: "color.brand",
      kind: "color",
      values: { light: "#1d2b6b", dark: "#8fa7ff" },
    },
  ],
};

/** A store over one value, as the host's browser store is. */
function memory(initial: string | null = null): PreferenceStore & {
  readonly value: string | null;
} {
  let value = initial;
  return {
    read: () => value,
    write: (next: string) => {
      value = next;
    },
    get value() {
      return value;
    },
  };
}

function mount(store: PreferenceStore, stored?: unknown) {
  registerBlocks(
    [
      {
        name: "acme/box",
        version: 1,
        description: "A box.",
        example: { props: {} },
        editor: { label: "Box" },
        props: { text: { type: "text" } },
        supports: { color: { text: true } },
        render: () => null,
      },
    ] as never,
    { source: "style-colour-recent-test" }
  );
  const styles = {
    base: { base: stored === undefined ? {} : { color: stored } },
  } as unknown as NodeStyles;
  const document_ = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id: "a", type: "acme/box", version: 1, props: {}, styles },
    ] as BlockNode[],
  } as BlockDocument;
  const editor = {
    document: document_,
    selectedId: "a",
    selection: { ids: ["a"], primary: "a" },
    applyAll: vi.fn(() => document_),
    select: vi.fn(),
    apply: vi.fn(() => document_),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState & { applyAll: ReturnType<typeof vi.fn> };
  render(
    <RecentColoursStore.Provider value={store}>
      <StyleInspectorPanel editor={editor} tokens={TOKENS} />
    </RecentColoursStore.Provider>
  );
  return editor;
}

/** The panel over a real editor, whose stored value follows every write. */
function mountLive(store: PreferenceStore, tokens: SiteTokenSet = TOKENS) {
  registerBlocks(
    [
      {
        name: "acme/box",
        version: 1,
        description: "A box.",
        example: { props: {} },
        editor: { label: "Box" },
        props: { text: { type: "text" } },
        supports: { color: { text: true } },
        render: () => null,
      },
    ] as never,
    { source: "style-colour-recent-test" }
  );
  const live: { editor?: EditorState } = {};
  function Live(): React.JSX.Element {
    const editor = useEditorState({
      initialDocument: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "a",
            type: "acme/box",
            version: 1,
            props: {},
            styles: { base: { base: { color: "#3b82f6" } } },
          },
        ],
      } as unknown as BlockDocument,
    });
    live.editor = editor;
    React.useEffect(() => editor.select("a"), []);
    return <StyleInspectorPanel editor={editor} tokens={tokens} />;
  }
  render(
    <RecentColoursStore.Provider value={store}>
      <Live />
    </RecentColoursStore.Provider>
  );
  return live;
}

const openPicker = (): void => {
  fireEvent.click(screen.getByRole("button", { name: /^Colour for Colour/ }));
};

const recent = (): HTMLElement =>
  screen.getByRole("group", { name: "Recent colours" });

const follows = (first: Node, second: Node): boolean =>
  (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !==
  0;

describe("a block's colour picker", () => {
  it("lists colour variables, then Recent colours, then the custom picker", () => {
    mount(memory('["#ff0000"]'));
    openPicker();
    const variables = screen.getByRole("listbox", { name: "Colour variables" });
    const custom = screen.getByRole("button", { name: "Custom colour" });

    expect(follows(variables, recent())).toBe(true);
    expect(follows(recent(), custom)).toBe(true);
  });

  it("shows Recent colours even before there are any, with nothing to pick", () => {
    mount(memory());
    openPicker();
    expect(within(recent()).queryAllByRole("button")).toEqual([]);
    expect(recent().textContent).toContain("Recent colours");
  });

  it("offers no second kind of saved colour: only variables and recent ones", () => {
    mount(memory('["#ff0000"]'));
    openPicker();
    expect(screen.queryByText(/static|saved colour|swatches/i)).toBeNull();
    expect(screen.queryByText("Presets")).toBeNull();
  });

  it("lists the author's recent colours newest first and writes one as it is", () => {
    const store = memory('["hsl(120 100% 25%)","#ff0000"]');
    const editor = mount(store);
    openPicker();
    const picks = within(recent()).getAllByRole("button");
    expect(picks.map(pick => pick.getAttribute("aria-label"))).toEqual([
      "hsl(120 100% 25%)",
      "#ff0000",
    ]);

    fireEvent.click(within(recent()).getByRole("button", { name: "#ff0000" }));

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(editor.applyAll.mock.calls[0])).toContain(
      '"#ff0000"'
    );
    // One discrete choice: the picker closes, and the colour moves first.
    expect(screen.queryByRole("group", { name: "Recent colours" })).toBeNull();
    expect(JSON.parse(store.value ?? "[]")).toEqual([
      "#ff0000",
      "hsl(120 100% 25%)",
    ]);
  });

  it("remembers a colour typed into the field, in the form it was typed", () => {
    const store = memory();
    mount(store, "#3b82f6");
    const field = screen.getByRole("textbox", { name: "Colour" });
    fireEvent.change(field, { target: { value: "rgb(0 0 255)" } });
    fireEvent.blur(field);

    expect(JSON.parse(store.value ?? "[]")).toEqual(["rgb(0 0 255)"]);
  });

  it("remembers a colour typed live once, when the field is left", () => {
    // Written as it is typed, "#ff0" and "#ff00" are colours on the way to
    // "#ff0000": only the colour the author settled on joins the list.
    const store = memory();
    mount(store, "#3b82f6");
    const field = screen.getByRole("textbox", { name: "Colour" });
    let typed = "";
    for (const character of "#ff0000") {
      typed += character;
      fireEvent.change(field, { target: { value: typed } });
    }
    expect(store.value).toBeNull();
    fireEvent.blur(field);

    expect(JSON.parse(store.value ?? "[]")).toEqual(["#ff0000"]);
  });

  it("remembers a colour typed live once, over a real editor whose stored value follows the typing", () => {
    // With the document moving on every keystroke, the colour left in the
    // field is already the stored one when the field is left: it still joins
    // Recent colours, once.
    const store = memory();
    const writes: string[] = [];
    const counted: PreferenceStore = {
      read: store.read,
      write: next => {
        writes.push(next);
        store.write(next);
      },
    };
    const live = mountLive(counted);
    const field = screen.getByRole("textbox", { name: "Colour" });
    let typed = "";
    for (const character of "#ff0000") {
      typed += character;
      fireEvent.change(field, { target: { value: typed } });
    }
    // The document already holds the colour, so leaving the field finds the
    // draft equal to what is stored, and nothing is remembered yet.
    const color = (
      live.editor?.document.nodes[0]?.styles as
        | { base?: { base?: { color?: unknown } } }
        | undefined
    )?.base?.base?.color;
    expect(color).toBe("#ff0000");
    expect(writes).toEqual([]);
    fireEvent.blur(field);
    // Exactly one write: a list deduplicated on write would hide a second.
    expect(writes).toEqual(['["#ff0000"]']);
  });

  it("keeps the field while a variable's name is typed, and picks it when the field is left", () => {
    // "color.brand" is a whole name on the way to "color.brand.dark": written
    // live, it would make the field a variable chip mid-word and lose the rest.
    const live = mountLive(memory(), {
      tokens: [
        ...TOKENS.tokens,
        {
          name: "color.brand.dark",
          kind: "color",
          values: { light: "#0b1336" },
        },
      ],
    });
    let typed = "";
    for (const character of "color.brand.dark") {
      typed += character;
      const field = screen.getByRole("textbox", { name: "Colour" });
      field.focus();
      fireEvent.change(field, { target: { value: typed } });
    }
    const field = screen.getByRole("textbox", { name: "Colour" });
    expect((field as HTMLInputElement).value).toBe("color.brand.dark");
    fireEvent.blur(field);
    const color = (
      live.editor?.document.nodes[0]?.styles as
        | { base?: { base?: { color?: unknown } } }
        | undefined
    )?.base?.base?.color;
    expect(color).toEqual({ $token: "color.brand.dark" });
  });

  it("does not remember a variable chosen from the list", () => {
    const store = memory();
    mount(store);
    openPicker();
    fireEvent.click(
      within(
        screen.getByRole("listbox", { name: "Colour variables" })
      ).getByRole("option", { name: "Brand" })
    );
    expect(store.value).toBeNull();
  });

  it("puts the field back when a recent colour ends a gesture where it began", () => {
    // Dragged away, then back to the colour already stored: the document
    // needs nothing, and the field must not keep the dragged colour for a
    // later blur to write.
    const editor = mount(memory('["#00aaff"]'), "#00aaff");
    openPicker();
    const surface = screen.getByRole("application", {
      name: /Saturation and brightness/,
    });
    fireEvent.keyDown(surface, { key: "ArrowLeft", shiftKey: true });
    const field = screen.getByRole("textbox", { name: "Colour" });
    expect((field as HTMLInputElement).value).not.toBe("#00aaff");

    fireEvent.click(within(recent()).getByRole("button", { name: "#00aaff" }));

    expect((field as HTMLInputElement).value).toBe("#00aaff");
    fireEvent.blur(field);
    expect(editor.applyAll).not.toHaveBeenCalled();
  });

  it("marks a raw colour stored on a block as not adapted to dark mode, as a recent one is", () => {
    mount(memory('["#ff0000"]'), "#ff0000");
    expect(
      screen.getByText(
        "Not adapted to dark mode. Choose a variable to follow light and dark."
      )
    ).toBeTruthy();
  });
});
