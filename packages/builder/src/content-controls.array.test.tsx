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

  it("adds, removes and moves items, one write each", () => {
    register();
    const editor = editorFor({ items: ["One", "Two"] });
    render(<InspectorPanel editor={editor} />);
    fireEvent.click(
      group("Items").getByRole("button", { name: "Add to Items" })
    );
    expect(written(editor).items).toEqual(["One", "Two", ""]);
    fireEvent.click(
      group("Items").getByRole("button", { name: "Remove Items, item 1" })
    );
    expect(written(editor).items).toEqual(["Two"]);
    fireEvent.click(
      group("Items").getByRole("button", { name: "Move Items, item 2 up" })
    );
    expect(written(editor).items).toEqual(["Two", "One"]);
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
    expect(second.getByRole("checkbox", { name: "Required" })).toBeDefined();
    expect(second.getByRole("combobox", { name: "Type" })).toBeDefined();
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
