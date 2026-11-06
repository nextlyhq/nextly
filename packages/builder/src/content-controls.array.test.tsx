// @vitest-environment jsdom

/**
 * The array control: a list of plain values, or of records described by an
 * item schema, each item edited with the registry's own controls.
 *
 * - A list of text: edit an item, add one, remove one, move one; each is one
 *   write of the whole list.
 * - A list of records: each item's fields draw with the controls their types
 *   have, and an edit writes that field of that item only.
 * - A list of records with no item schema says it can't be edited here.
 * - Read-only on a locked block.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as React from "react";

import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";

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

afterEach(() => {
  cleanup();
  clearBlocks();
});

function register(): void {
  registerBlocks(
    [
      {
        name: "acme/lists",
        version: 1,
        description: "Lists of things.",
        example: { props: {} },
        editor: { label: "Lists" },
        props: {
          items: { role: "content", type: "array", of: "text" },
          fields: {
            type: "array",
            of: "object",
            item: {
              label: { type: "text" },
              type: { type: "select", options: ["text", "email"] },
              required: { type: "checkbox" },
              when: { type: "datetime" },
            },
          },
          loose: { type: "array", of: "object" },
        },
        render: () => null,
      },
    ] as never,
    { source: "content-controls-array-test" }
  );
}

function editorFor(
  props: Record<string, unknown>,
  extra: Partial<BlockNode> = {}
) {
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id: "a", type: "acme/lists", version: 1, props, ...extra } as BlockNode,
    ],
  } as BlockDocument;
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
    // Nothing composed around the page: its own tree is all there is.
    composed: () => undefined,
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
}

/** The props the last write stored. */
const written = (editor: { apply: ReturnType<typeof vi.fn> }) =>
  (
    editor.apply.mock.calls.at(-1)?.[0] as {
      patch: { props: Record<string, unknown> };
    }
  ).patch.props;

const group = (name: string) => within(screen.getByRole("group", { name }));

describe("a list of text", () => {
  it("edits one item in place", () => {
    register();
    const editor = editorFor({ items: ["One", "Two"] });
    render(<InspectorPanel editor={editor} />);
    const second = group("Items").getByRole("textbox", {
      name: "Items, item 2",
    });
    fireEvent.change(second, { target: { value: "Deux" } });
    fireEvent.blur(second);
    expect(written(editor).items).toEqual(["One", "Deux"]);
  });

  it("keeps the words just typed when an action follows the blur that commits them", () => {
    // Clicking Move blurs the item first; the blur writes its text, and the
    // move must start from that write, not from the list the panel drew.
    register();
    const editor = editorFor({ items: ["One", "Two"] });
    render(<InspectorPanel editor={editor} />);
    const first = group("Items").getByRole("textbox", {
      name: "Items, item 1",
    });
    fireEvent.change(first, { target: { value: "Uno" } });
    fireEvent.blur(first);
    fireEvent.click(
      screen.getByRole("button", { name: "Move Items, item 1 down" })
    );
    expect(written(editor).items).toEqual(["Two", "Uno"]);
  });

  it("starts the next action from the stored list when a write was refused", () => {
    register();
    const editor = editorFor({ items: ["One", "Two"] });
    render(<InspectorPanel editor={editor} />);
    // An Add the document refuses (at its size cap, say) changes nothing.
    editor.apply.mockReturnValueOnce(null);
    fireEvent.click(
      group("Items").getByRole("button", { name: "Add to Items" })
    );
    fireEvent.click(
      group("Items").getByRole("button", { name: "Remove Items, item 1" })
    );
    // Not ["Two", ""]: the refused blank item is not written with the removal.
    expect(written(editor).items).toEqual(["Two"]);
  });

  it("adds, removes and moves items, one write each", () => {
    register();
    const editor = editorFor({ items: ["One", "Two"] });
    render(<InspectorPanel editor={editor} />);
    fireEvent.click(
      group("Items").getByRole("button", { name: "Add to Items" })
    );
    expect(written(editor).items).toEqual(["One", "Two", ""]);
    // Each action starts from the list as last written, as it does when the
    // editor redraws between them: this stand-in's document never changes.
    fireEvent.click(
      group("Items").getByRole("button", { name: "Remove Items, item 1" })
    );
    expect(written(editor).items).toEqual(["Two", ""]);
    fireEvent.click(
      group("Items").getByRole("button", { name: "Move Items, item 2 up" })
    );
    expect(written(editor).items).toEqual(["", "Two"]);
    expect(editor.apply).toHaveBeenCalledTimes(3);
  });
});

describe("a list of records", () => {
  it("draws each item's fields with their own controls and writes one field", () => {
    register();
    const editor = editorFor({
      fields: [
        { label: "Name", type: "text", required: true },
        { label: "Email", type: "email" },
      ],
    });
    render(<InspectorPanel editor={editor} />);
    const second = group("Fields, item 2");
    const label = second.getByRole("textbox", { name: "Label" });
    expect((label as HTMLInputElement).value).toBe("Email");
    fireEvent.change(label, { target: { value: "Your email" } });
    fireEvent.blur(label);
    expect(written(editor).fields).toEqual([
      { label: "Name", type: "text", required: true },
      { label: "Your email", type: "email" },
    ]);
    // The other controls drew too.
    expect(second.getByRole("switch", { name: "Required" })).toBeDefined();
    // Two short options: a row of radio buttons rather than a menu.
    expect(second.getByRole("radiogroup", { name: "Type" })).toBeDefined();
  });

  it("lists an item field it has no control for, as the top level does", () => {
    register();
    render(
      <InspectorPanel
        editor={editorFor({ fields: [{ label: "Name", type: "text" }] })}
      />
    );
    const item = group("Fields, item 1");
    expect(item.getByText("When")).toBeDefined();
    expect(item.getByText(/Not editable here \(datetime\)/)).toBeDefined();
  });

  it("draws lists nested only as deep as the engine's bound", () => {
    // Past the bound a relation search would refuse what was drawn, so the
    // list there is listed as not editable instead of drawn.
    const list = (name: string, item: Record<string, unknown>) => ({
      [name]: { type: "array", of: "object", item },
    });
    registerBlocks(
      [
        {
          name: "acme/deep",
          version: 1,
          description: "Nested lists.",
          example: { props: {} },
          editor: { label: "Deep" },
          props: list(
            "l0",
            list(
              "l1",
              list("l2", list("l3", list("l4", { t: { type: "text" } })))
            )
          ),
          render: () => null,
        },
      ] as never,
      { source: "content-controls-array-test" }
    );
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "a",
          type: "acme/deep",
          version: 1,
          props: { l0: [{ l1: [{ l2: [{ l3: [{ l4: [{ t: "x" }] }] }] }] }] },
        },
      ],
    } as unknown as BlockDocument;
    const editor = editorFor({});
    (editor as { document: BlockDocument }).document = document;
    render(<InspectorPanel editor={editor} />);
    expect(screen.getByText("Not editable here (array).")).toBeDefined();
    // The control: the levels inside the bound are drawn as lists.
    expect(screen.getByRole("group", { name: "L3" })).toBeDefined();
  });

  it("says a list without an item schema can't be edited here", () => {
    register();
    render(<InspectorPanel editor={editorFor({ loose: [{ a: 1 }] })} />);
    expect(group("Loose").getByText(/can't be edited here/)).toBeDefined();
  });
});

describe("on a locked block", () => {
  it("offers no change", () => {
    register();
    render(
      <InspectorPanel
        editor={editorFor({ items: ["One"] }, { locked: true })}
      />
    );
    expect(
      (
        group("Items").getByRole("button", {
          name: "Add to Items",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      (
        group("Items").getByRole("textbox", {
          name: "Items, item 1",
        }) as HTMLInputElement
      ).disabled
    ).toBe(true);
  });
});
