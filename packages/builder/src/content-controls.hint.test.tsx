// @vitest-environment jsdom

/**
 * A text prop's `hint`: the block's own words for what the prop is for, shown
 * under its field and read as the field's description, so a person hears it
 * on reaching the field and not only by finding the line below.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";

import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";

afterEach(() => {
  cleanup();
  clearBlocks();
});

function mount(hint: string | undefined): void {
  registerBlocks(
    [
      {
        name: "acme/badge",
        version: 1,
        description: "A badge.",
        example: { props: {} },
        editor: { label: "Badge" },
        props: {
          label: {
            label: "Screen reader label",
            role: "content",
            type: "text",
            ...(hint === undefined ? {} : { hint }),
          },
        },
        defaultProps: {},
        render: () => null,
      },
    ] as never,
    { source: "content-controls-hint-test" }
  );
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id: "a", type: "acme/badge", version: 1, props: {} } as BlockNode,
    ],
  } as BlockDocument;
  const editor = {
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
    composed: () => undefined,
  } as unknown as EditorState;
  render(<InspectorPanel editor={editor} />);
}

describe("a text prop's hint", () => {
  it("is shown under the field and read as its description", () => {
    mount("Leave empty when the text beside it already says the same.");
    const field = screen.getByRole("textbox", { name: "Screen reader label" });
    const hint = document.getElementById(
      field.getAttribute("aria-describedby") ?? ""
    );
    expect(hint?.textContent).toBe(
      "Leave empty when the text beside it already says the same."
    );
  });

  it("adds nothing for a prop that gives none", () => {
    mount(undefined);
    const field = screen.getByRole("textbox", { name: "Screen reader label" });
    expect(field.hasAttribute("aria-describedby")).toBe(false);
  });
});
