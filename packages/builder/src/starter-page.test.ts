// @vitest-environment jsdom

/**
 * Starting an empty page from a starter page's blocks in the builder: one
 * undo step, new ids, and the starter itself left untouched.
 *
 * @module starter-page.test
 */
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useEditorState } from "./editor-state";
import { applyStarterPage, planStarterPage } from "./starter-page";

function node(id: string, children?: BlockNode[]): BlockNode {
  return {
    id,
    type: "core/box",
    version: 1,
    props: {},
    ...(children === undefined ? {} : { slots: { children } }),
  };
}

function doc(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes };
}

/** Every node id in a forest, in document order. */
function idsIn(nodes: readonly BlockNode[]): string[] {
  return nodes.flatMap(each => [
    each.id,
    ...idsIn(Object.values(each.slots ?? {}).flat()),
  ]);
}

const starter: readonly BlockNode[] = [
  node("hero", [node("hero-title")]),
  node("footer-note"),
];

describe("starting an empty page from a starter page", () => {
  it("fills the page with a copy under new ids, as one undo step", () => {
    const before = structuredClone(starter);
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([]) })
    );

    let started = false;
    act(() => {
      started = applyStarterPage(result.current, starter);
    });

    expect(started).toBe(true);
    const copied = result.current.document.nodes;
    expect(copied).toHaveLength(2);
    // Every block is the page's own: none keeps a starter's id.
    const ids = idsIn(copied);
    expect(ids).toHaveLength(3);
    for (const id of ids) expect(idsIn(starter)).not.toContain(id);
    // The starter is not the page's: its blocks are as they were.
    expect(starter).toEqual(before);

    // One step: a single Undo empties the page again.
    expect(result.current.undoDepth).toBe(1);
    act(() => {
      result.current.undo();
    });
    expect(result.current.document.nodes).toEqual([]);
  });

  it("leaves a page that has blocks as it is", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("mine")]) })
    );

    let started = true;
    act(() => {
      started = applyStarterPage(result.current, starter);
    });

    expect(started).toBe(false);
    expect(idsIn(result.current.document.nodes)).toEqual(["mine"]);
    expect(result.current.undoDepth).toBe(0);
  });

  it("plans nothing for no blocks", () => {
    expect(planStarterPage(doc([]), [])).toBeUndefined();
  });
});
