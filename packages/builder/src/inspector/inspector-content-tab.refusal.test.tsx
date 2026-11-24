// @vitest-environment jsdom
/**
 * Why the panel's write of a prop was refused, as `propRefusal` answers it
 * once `commitProp` has refused: through the real editor, with its size
 * limit, its locks and its refusal of an edit that changes nothing.
 */
import {
  clearBlocks,
  documentBytes,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { act, renderHook } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { useEditorState } from "../editor-state";
import { commitProp, propRefusal } from "./inspector-content-tab";

beforeEach(() => {
  clearBlocks();
  registerBlocks(
    [
      {
        name: "acme/note",
        version: 1,
        description: "A note.",
        example: { props: {} },
        editor: { label: "Note" },
        props: { title: { type: "text", role: "content" } },
        render: () => null,
      },
    ] as never,
    { source: "prop-refusal-test" }
  );
});
afterAll(clearBlocks);

function page(extra: Partial<BlockNode> = {}): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "note",
        type: "acme/note",
        version: 1,
        props: { title: "Short" },
        ...extra,
      } as BlockNode,
    ],
  } as BlockDocument;
}

/** An editor over `document` whose size limit leaves 64 bytes of room. */
function editorOver(document: BlockDocument) {
  const limits = {
    maxDepth: 12,
    maxNodes: 100,
    maxBytes: documentBytes(document) + 64,
  };
  return renderHook(() => useEditorState({ initialDocument: document, limits }))
    .result;
}

/** Write `value` as the panel does, and say why it was refused, if it was. */
function write(
  editor: ReturnType<typeof editorOver>,
  value: unknown
): { written: boolean; why: string } {
  let written: BlockDocument | null = null;
  act(() => {
    written = commitProp(
      editor.current,
      editor.current.document,
      "note",
      "title",
      value
    );
  });
  return {
    written: written !== null,
    why: propRefusal(
      editor.current,
      editor.current.document,
      "note",
      "title",
      value
    ),
  };
}

describe("why the panel's write of a prop was refused", () => {
  it("is the size limit for a value that would take the page past it", () => {
    const editor = editorOver(page());
    expect(write(editor, "x".repeat(200))).toEqual({
      written: false,
      why: "size-limit",
    });
  });

  it("is not the size limit for a value that fits but changes nothing", () => {
    const editor = editorOver(page());
    // The page refuses an edit that changes nothing; it is not too large.
    expect(write(editor, "Short")).toEqual({
      written: false,
      why: "refused",
    });
  });

  it("is the lock for a block that can no longer be changed", () => {
    const editor = editorOver(page({ locked: true }));
    expect(write(editor, "Longer")).toEqual({
      written: false,
      why: "locked",
    });
  });

  it("is the control: a value that fits is written", () => {
    const editor = editorOver(page());
    expect(write(editor, "Longer").written).toBe(true);
  });
});
