// @vitest-environment jsdom

/**
 * A recovery point restored as one edit: the recovered page in its place, and
 * one Undo puts the stored page back.
 *
 * @module admin/editor/restore-as-edit.test
 */
import {
  clearBlocks,
  hasBlock,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { useEditorState } from "@nextlyhq/builder/shell";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { restoreAsEdit } from "./restore-as-edit";

afterEach(clearBlocks);

function register() {
  if (hasBlock("acme/box")) return;
  registerBlocks(
    [
      {
        version: 1,
        description: "A block.",
        example: { props: {} },
        render: () => null,
        name: "acme/box",
        props: {},
      },
    ] as never,
    { source: "restore-test" }
  );
}

function box(id: string): BlockNode {
  return { id, type: "acme/box", version: 1, props: {} } as BlockNode;
}

function page(
  nodes: BlockNode[],
  settings?: BlockDocument["settings"]
): BlockDocument {
  register();
  return {
    formatVersion: 1,
    kind: "page",
    nodes,
    ...(settings === undefined ? {} : { settings }),
  } as BlockDocument;
}

const ids = (document: BlockDocument) => document.nodes.map(node => node.id);

function editorOn(stored: BlockDocument) {
  return renderHook(() => useEditorState({ initialDocument: stored }));
}

describe("restoreAsEdit", () => {
  it("puts the recovered page in place as one step, which one Undo takes back", () => {
    const { result } = editorOn(page([box("a"), box("b")]));
    let applied = false;
    act(() => {
      applied = restoreAsEdit(result.current, page([box("c")]), ["page"]);
    });
    expect(applied).toBe(true);
    expect(ids(result.current.document)).toEqual(["c"]);
    expect(result.current.undoDepth).toBe(1);

    act(() => result.current.undo());
    expect(ids(result.current.document)).toEqual(["a", "b"]);
    act(() => result.current.redo());
    expect(ids(result.current.document)).toEqual(["c"]);
  });

  it("declines a recovered page whose settings differ, and changes nothing", () => {
    const { result } = editorOn(page([box("a")]));
    let applied = true;
    act(() => {
      applied = restoreAsEdit(
        result.current,
        page([box("c")], { title: "Recovered" } as never),
        ["page"]
      );
    });
    expect(applied).toBe(false);
    expect(ids(result.current.document)).toEqual(["a"]);
    expect(result.current.undoDepth).toBe(0);
  });

  it("declines a recovered page whose media index differs, and changes nothing", () => {
    // No edit changes the index, so the recovered blocks would be saved
    // under the current one; the full restore keeps the recovered index.
    const stored = { ...page([box("a")]), assets: { mediaIds: ["m1"] } };
    const recovered = { ...page([box("c")]), assets: { mediaIds: ["m2"] } };
    const { result } = editorOn(stored);
    let applied = true;
    act(() => {
      applied = restoreAsEdit(result.current, recovered, ["page"]);
    });
    expect(applied).toBe(false);
    expect(ids(result.current.document)).toEqual(["a"]);
  });

  it("declines a recovered page in another format, or carrying fields the page doesn't", () => {
    const { result } = editorOn(page([box("a")]));
    const older = { ...page([box("c")]), formatVersion: 0 };
    const extra = { ...page([box("c")]), meta: { kept: true } };
    expect(restoreAsEdit(result.current, older, ["page"])).toBe(false);
    expect(restoreAsEdit(result.current, extra, ["page"])).toBe(false);
    expect(ids(result.current.document)).toEqual(["a"]);
  });

  it("accepts the same envelope written with its keys in another order", () => {
    const stored = { ...page([box("a")]), assets: { mediaIds: ["m1"] } };
    const { result } = editorOn(stored);
    const recovered = {
      assets: { mediaIds: ["m1"] },
      nodes: [box("c")],
      kind: "page",
      formatVersion: 1,
    };
    let applied = false;
    act(() => {
      applied = restoreAsEdit(result.current, recovered, ["page"]);
    });
    expect(applied).toBe(true);
    expect(ids(result.current.document)).toEqual(["c"]);
  });

  it("declines a value that isn't a document", () => {
    const { result } = editorOn(page([box("a")]));
    expect(restoreAsEdit(result.current, "not a page", ["page"])).toBe(false);
    expect(restoreAsEdit(result.current, { title: "x" }, ["page"])).toBe(false);
    expect(ids(result.current.document)).toEqual(["a"]);
  });
});
