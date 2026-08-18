// @vitest-environment jsdom

/**
 * The inspector, driven through a host that renders it against a real editor.
 *
 * `inspector.ts` decides which controls a block offers and what op each edit
 * produces, and asserts that without a DOM. What is only true HERE is the
 * wiring: that an edit reaches `editor.apply` at the moment it should, and that
 * a field showing a stored value follows that value when something else changes
 * it.
 *
 * **Scoped to the identity fields.** `inspector-panel.tsx` had no test file at
 * all before this one, so the prop controls below it remain uncovered — stated
 * rather than implied, because a file that exists reads as a file that covers
 * the module.
 *
 * @module inspector-panel.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as React from "react";

import {
  clearBlocks,
  hasBlock,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import { InspectorPanel } from "./inspector-panel";
import type { EditorState } from "./editor-state";

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

function register() {
  if (hasBlock("acme/heading")) return;
  registerBlocks(
    [
      {
        name: "acme/heading",
        version: 1,
        description: "A heading.",
        example: { props: {} },
        editor: { label: "Heading" },
        props: { text: { type: "text" } },
        render: () => null,
      },
    ] as never,
    { source: "inspector-panel-test" }
  );
}

function documentOf(node: Partial<BlockNode>): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id: "a", type: "acme/heading", version: 1, props: {}, ...node },
    ] as BlockNode[],
  } as BlockDocument;
}

function editorFor(
  document: BlockDocument
): EditorState & { apply: ReturnType<typeof vi.fn> } {
  return {
    document,
    selectedId: "a",
    select: vi.fn(),
    apply: vi.fn(() => document),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
}

function mount(node: Partial<BlockNode> = {}) {
  register();
  const editor = editorFor(documentOf(node));
  render(<InspectorPanel editor={editor} />);
  return editor;
}

describe("InspectorPanel identity fields", () => {
  it("shows the block's stored name and lock", () => {
    mount({ name: "Hero title", locked: true });

    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Hero title"
    );
    // `data-state` rather than a `toBeChecked` matcher: this package does not
    // register jest-dom, and the property form of that matcher is a no-op that
    // reads as an assertion — it was in this test until it threw.
    expect(
      screen.getByLabelText("Lock this block").getAttribute("data-state")
    ).toBe("checked");
  });

  it("renames on blur, through the store", () => {
    // Through `editor.apply` rather than around it, so the rename is on the undo
    // stack with every other edit.
    const editor = mount();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Hero title" },
    });
    expect(editor.apply).not.toHaveBeenCalled(); // not on every keystroke
    fireEvent.blur(screen.getByLabelText("Name"));

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { name: "Hero title" },
    });
  });

  it("does not write when the name is unchanged", () => {
    // Blur fires whenever focus leaves, including when an author clicks into
    // the field and straight out of it. Writing there would put an op with no
    // effect on the undo stack, so one press of undo would appear to do nothing.
    const editor = mount({ name: "Hero title" });

    fireEvent.blur(screen.getByLabelText("Name"));

    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("clears the name by unsetting the field", () => {
    const editor = mount({ name: "Hero title" });

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });
    fireEvent.blur(screen.getByLabelText("Name"));

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: {},
      unset: ["name"],
    });
  });

  it("locks immediately, with no blur to wait for", () => {
    // There is nothing to coalesce in a checkbox, and waiting would leave the
    // canvas disagreeing with a control the author has already changed.
    const editor = mount();

    fireEvent.click(screen.getByLabelText("Lock this block"));

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { locked: true },
    });
  });

  it("unlocks by unsetting rather than storing false", () => {
    const editor = mount({ locked: true });

    fireEvent.click(screen.getByLabelText("Lock this block"));

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: {},
      unset: ["locked"],
    });
  });

  it("says nothing about identity when there is no selection", () => {
    // The control for every case above: they would all pass against a panel
    // that rendered the fields unconditionally, and this is the state the
    // inspector spends most of its time in.
    register();
    const editor = editorFor(documentOf({}));
    render(
      <InspectorPanel
        editor={{ ...editor, selectedId: null } as unknown as EditorState}
      />
    );

    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.queryByLabelText("Lock this block")).toBeNull();
  });
});
