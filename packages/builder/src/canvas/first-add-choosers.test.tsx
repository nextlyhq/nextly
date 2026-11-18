// @vitest-environment jsdom

/**
 * The canvas's first-add chooser for a Collection list: asked right after
 * the list is added and whenever a list with no source is selected, and put
 * away by Skip until the list is selected again.
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EditorState } from "../editor-state";
import type { FirstAdd } from "../first-add";
import { CANVAS_ROOT_CLASS } from "../shell-state";

import { FirstAddChoosers } from "./first-add-choosers";

afterEach(() => {
  cleanup();
});

function documentWith(props: Record<string, unknown>): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "list", type: "core/collection-loop", version: 1, props }],
  };
}

function editorOf(
  document: BlockDocument,
  firstAdd?: FirstAdd
): EditorState {
  return {
    document,
    selectedId: "list",
    selection: { ids: ["list"], primary: "list" },
    select: vi.fn(),
    apply: vi.fn(() => document),
    applyAll: vi.fn(() => document),
    composed: () => undefined,
    ...(firstAdd === undefined ? {} : { firstAdd }),
  } as unknown as EditorState;
}

function Host({ editor }: { editor: EditorState }): React.JSX.Element {
  return (
    <div className={CANVAS_ROOT_CLASS}>
      <div data-nx-node="list" />
      <FirstAddChoosers
        editor={editor}
        services={{ listLoopCollections: () => Promise.resolve([]) }}
      />
    </div>
  );
}

const question = () =>
  screen.queryByRole("group", { name: "Show entries from", hidden: true });

describe("a list with no source", () => {
  it("asks which entries it shows whenever it is selected, and Skip puts that away", async () => {
    render(<Host editor={editorOf(documentWith({}))} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(question()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Skip", hidden: true }));
    expect(question()).toBeNull();
  });

  it("asks nothing once it has a source", () => {
    render(<Host editor={editorOf(documentWith({ collection: "posts" }))} />);
    expect(question()).toBeNull();
  });

  it("does not ask again straight after the just-added list's question is skipped", async () => {
    const document = documentWith({});
    const skip = vi.fn();
    const firstAdd: FirstAdd = {
      nodeId: "list",
      chooser: "collection-source",
      choose: vi.fn(() => true),
      skip,
    };
    const { rerender } = render(<Host editor={editorOf(document, firstAdd)} />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Skip", hidden: true }));
    expect(skip).toHaveBeenCalledTimes(1);
    // The editor ends its step; the list is still selected with no source.
    rerender(<Host editor={editorOf(document)} />);
    expect(question()).toBeNull();
  });
});
