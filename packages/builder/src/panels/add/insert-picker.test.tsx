// @vitest-environment jsdom

/**
 * The in-place picker as an author meets it: a non-modal dialog named "Add a
 * block", described by where a block goes; a search field with focus that
 * controls the six (a grid) or the results (a list); a place's refusals
 * left out of both; Enter adding the highlighted block at the picker's
 * target; Escape and a press outside closing without adding and returning
 * focus; and "Browse all" handing its target on. Every insert counts toward
 * the six, from the picker and from the Add panel alike.
 *
 * @module insert-picker.test
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  clearBlocks,
  DEFAULT_LIMITS,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";

import type { EditorState } from "../../editor-state";
import { EMPTY_SELECTION } from "../../selection";
import type { PreferenceStore } from "../../shell-state";

import { InsertPanel } from "./insert-panel";
import { InsertPicker, useInsertPicker } from "./insert-picker";
import { elementAnchor } from "./insert-picker-anchor";
import type { InsertPickerTarget } from "./insert-picker-types";
import { InsertUsageContext, readInsertCounts } from "./insert-usage";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

/** One block definition for the fixture, by name, label and group. */
function def(
  name: string,
  label: string,
  category: string,
  more: Record<string, unknown> = {}
): Record<string, unknown> {
  return { ...base, name, editor: { label, category }, ...more };
}

/** The core blocks the picker's questions turn on, with their nesting rules. */
beforeEach(() => {
  const holds = { slots: { children: {} } };
  registerBlocks(
    [
      def("core/section", "Section", "layout", holds),
      def("core/box", "Box", "layout", holds),
      def("core/columns", "Columns", "layout", {
        slots: { children: { allow: ["core/column"] } },
      }),
      def("core/column", "Column", "layout", {
        ...holds,
        parent: ["core/columns"],
      }),
      def("core/heading", "Heading", "text"),
      def("core/text", "Text", "text"),
      def("core/quote", "Quote", "text"),
      def("core/image", "Image", "media"),
      def("core/gallery", "Gallery", "media", {
        slots: { children: { allow: ["core/image"] } },
      }),
      def("core/button", "Button", "interactive"),
      def("core/accordion", "Accordion", "interactive", {
        slots: { children: { allow: ["core/accordion-item"] } },
      }),
      def("core/accordion-item", "Accordion item", "interactive", {
        ...holds,
        parent: ["core/accordion"],
      }),
    ] as never,
    { source: "core" }
  );
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

/** Hero (a Section with a Heading), Pricing (a Section), and an empty Gallery. */
const page = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "hero",
      type: "core/section",
      version: 1,
      props: {},
      name: "Hero",
      slots: {
        children: [{ id: "h", type: "core/heading", version: 1, props: {} }],
      },
    },
    {
      id: "pricing",
      type: "core/section",
      version: 1,
      props: {},
      name: "Pricing",
      slots: { children: [] },
    },
    {
      id: "photos",
      type: "core/gallery",
      version: 1,
      props: {},
      name: "Photos",
      slots: { children: [] },
    },
  ],
} as BlockDocument;

type StubEditor = EditorState & {
  apply: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
};

function editorOn(selectedId: string | null): StubEditor {
  return {
    document: page,
    limits: DEFAULT_LIMITS,
    selectedId,
    selection:
      selectedId === null
        ? EMPTY_SELECTION
        : { ids: [selectedId], primary: selectedId },
    select: vi.fn(),
    apply: vi.fn(() => page),
    applyAll: vi.fn(() => page),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
  } as unknown as StubEditor;
}

/** A store in memory for the insert counts. */
function memoryStore(value: string | null = null): PreferenceStore {
  const held = { value };
  return {
    read: () => held.value,
    write: next => {
      held.value = next;
    },
  };
}

/** A host: a button that opens the picker at `target`, and somewhere else. */
function Host({
  target,
  editor,
  store,
  onBrowseAll = () => undefined,
  onEditText,
}: {
  target: InsertPickerTarget;
  editor: EditorState;
  store?: PreferenceStore;
  onBrowseAll?: (target: InsertPickerTarget) => void;
  onEditText?: (id: string) => boolean;
}): React.JSX.Element {
  const picker = useInsertPicker();
  return (
    <InsertUsageContext.Provider value={store}>
      <button
        type="button"
        onClick={event =>
          picker.open(target, elementAnchor(event.currentTarget))
        }
      >
        Open
      </button>
      <button type="button">Elsewhere</button>
      <InsertPicker
        request={picker.request}
        onClose={picker.close}
        editor={editor}
        onBrowseAll={onBrowseAll}
        {...(onEditText === undefined ? {} : { onEditText })}
      />
    </InsertUsageContext.Provider>
  );
}

/** Open the picker as an author would: focus on its control, then a press. */
function openPicker(props: React.ComponentProps<typeof Host>) {
  const view = render(<Host {...props} />);
  const opener = screen.getByRole("button", { name: "Open" });
  opener.focus();
  fireEvent.click(opener);
  return { ...view, opener, dialog: screen.getByRole("dialog") };
}

const between: InsertPickerTarget = {
  kind: "place",
  place: { after: "hero" },
};

function search(): HTMLElement {
  return screen.getByRole("combobox", { name: "Search blocks" });
}

function cellNames(): string[] {
  return within(screen.getByRole("grid"))
    .getAllByRole("gridcell")
    .map(cell => cell.getAttribute("aria-label") ?? "");
}

describe("the in-place picker", () => {
  it("is a non-modal dialog named Add a block and described by where it adds", () => {
    openPicker({ target: between, editor: editorOn(null) });
    const dialog = screen.getByRole("dialog", {
      name: "Add a block",
      description: "Adding between Hero and Pricing",
    });
    expect(dialog.getAttribute("aria-modal")).not.toBe("true");
  });

  it("opens with focus in its search, a combobox controlling the six as a grid", () => {
    openPicker({ target: between, editor: editorOn(null) });
    const field = search();
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute("aria-controls")).toBe(
      screen.getByRole("grid").id
    );
    expect(cellNames()).toEqual([
      "Heading",
      "Text",
      "Image",
      "Button",
      "Box",
      "Columns",
    ]);
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Browse all blocks and sections →" })
    ).toBeTruthy();
  });

  it("lists only what a Gallery takes when searching inside one", () => {
    openPicker({
      target: { kind: "place", place: { inside: "photos" } },
      editor: editorOn(null),
    });
    // At rest, a Gallery takes only images: one cell, never a refused one.
    expect(cellNames()).toEqual(["Image"]);
    fireEvent.change(search(), { target: { value: "acc" } });
    const list = screen.getByRole("listbox");
    expect(within(list).queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText('No blocks match "acc".')).toBeTruthy();
    expect(search().getAttribute("aria-controls")).toBe(list.id);
  });

  it("lists the Accordion, and not its item, when searching inside a Section", () => {
    openPicker({
      target: { kind: "place", place: { inside: "pricing" } },
      editor: editorOn(null),
    });
    fireEvent.change(search(), { target: { value: "acc" } });
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map(option => option.getAttribute("aria-label"))).toEqual([
      "Accordion",
    ]);
  });

  it("adds the highlighted block at its place on Enter, closes, and opens its text", async () => {
    const editor = editorOn(null);
    const onEditText = vi.fn(() => true);
    openPicker({ target: between, editor, onEditText });
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(editor.apply).toHaveBeenCalledTimes(1);
    const op = editor.apply.mock.calls[0]?.[0] as {
      node: { id: string; type: string };
      at: unknown;
    };
    expect(op.node.type).toBe("core/heading");
    expect(op.at).toEqual({ index: 1 });
    expect(editor.select).toHaveBeenCalledWith(op.node.id);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(onEditText).toHaveBeenCalledWith(op.node.id));
  });

  it("moves through the grid with the arrows, and its line follows the highlight by the rule", () => {
    const editor = editorOn("hero");
    openPicker({ target: { kind: "rule" }, editor });
    expect(
      screen.getByRole("dialog", {
        description: "Adding inside Hero, at the end",
      })
    ).toBeTruthy();
    // Text, then down a row to Box: a layout block goes after the Section.
    fireEvent.keyDown(search(), { key: "ArrowRight" });
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    const box = screen.getByRole("gridcell", { name: "Box" });
    expect(search().getAttribute("aria-activedescendant")).toBe(box.id);
    expect(box.getAttribute("aria-selected")).toBe("true");
    expect(
      screen.getByRole("dialog", { description: "Adding after Hero" })
    ).toBeTruthy();
    fireEvent.keyDown(search(), { key: "Enter" });
    const op = editor.apply.mock.calls[0]?.[0] as { at: unknown };
    expect(op.at).toEqual({ index: 1 });
  });

  it("closes on Escape without adding, and gives focus back to its opener", async () => {
    const editor = editorOn(null);
    const { opener } = openPicker({ target: between, editor });
    fireEvent.keyDown(search(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(editor.apply).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("closes on a press outside without adding, and gives focus back to its opener", async () => {
    const editor = editorOn(null);
    const { opener } = openPicker({ target: between, editor });
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    // The popover listens for presses outside from the task after it opens.
    await act(() => new Promise(resolve => setTimeout(resolve, 0)));
    act(() => {
      elsewhere.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 })
      );
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(editor.apply).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("hands its target to Browse all and closes", () => {
    const onBrowseAll = vi.fn();
    openPicker({ target: between, editor: editorOn(null), onBrowseAll });
    fireEvent.click(
      screen.getByRole("button", { name: "Browse all blocks and sections →" })
    );
    expect(onBrowseAll).toHaveBeenCalledWith(between);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the most used blocks", () => {
  it("show the author's own most added first, from the store the host provides", () => {
    const store = memoryStore(JSON.stringify({ counts: { "core/quote": 3 } }));
    openPicker({ target: between, editor: editorOn(null), store });
    expect(cellNames()[0]).toBe("Quote");
  });

  it("count an insert from the picker", () => {
    const store = memoryStore();
    openPicker({ target: between, editor: editorOn(null), store });
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(readInsertCounts(store)).toEqual({ "core/heading": 1 });
  });

  it("count an insert from the Add panel, so every surface feeds the six", () => {
    const store = memoryStore();
    render(
      <InsertUsageContext.Provider value={store}>
        <InsertPanel editor={editorOn(null)} />
      </InsertUsageContext.Provider>
    );
    fireEvent.click(screen.getByRole("option", { name: "Quote" }));
    expect(readInsertCounts(store)).toEqual({ "core/quote": 1 });
  });

  it("count a block dragged from the Add panel once it lands", () => {
    const store = memoryStore();
    const beginInsertDrag = vi.fn();
    render(
      <InsertUsageContext.Provider value={store}>
        <InsertPanel
          editor={editorOn(null)}
          beginInsertDrag={beginInsertDrag}
        />
      </InsertUsageContext.Provider>
    );
    fireEvent.pointerDown(screen.getByRole("option", { name: "Quote" }));
    const drag = beginInsertDrag.mock.calls[0]?.[1] as {
      makeNode: () => unknown;
      onInserted: (node: unknown) => void;
    };
    // Nothing is counted until the drag drops the block on the page.
    expect(readInsertCounts(store)).toEqual({});
    drag.onInserted(drag.makeNode());
    expect(readInsertCounts(store)).toEqual({ "core/quote": 1 });
  });
});
