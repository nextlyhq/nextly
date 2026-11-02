// @vitest-environment jsdom

/**
 * One commit to a placement's value is one undo step, a reset included.
 *
 * Driven through the real editor state: the step count and what an undo puts
 * back are the store's bookkeeping, which the op alone does not show.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  findNode,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useEditorState } from "./editor-state";
import { resetOverrideOp, setOverrideOp } from "./instance-inspector";

const PAGE: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "p",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: "header", overrides: { title: "Mine" } },
    },
  ],
};

const overridesOf = (document: BlockDocument): unknown =>
  (findNode(document.nodes, "p")?.props as { overrides?: unknown }).overrides;

describe("undoing a placement's value", () => {
  it("takes back a reset in one step, bringing the value back", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: PAGE })
    );
    act(() => {
      const node = findNode(result.current.document.nodes, "p");
      if (node !== undefined)
        result.current.apply(resetOverrideOp(node, "title"));
    });
    expect(overridesOf(result.current.document)).toBe(undefined);
    expect(result.current.undoDepth).toBe(1);

    act(() => result.current.undo());
    expect(overridesOf(result.current.document)).toEqual({ title: "Mine" });
    expect(result.current.undoDepth).toBe(0);
  });

  it("takes back a cleared value in one step, to the value before it", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: PAGE })
    );
    act(() => {
      const node = findNode(result.current.document.nodes, "p");
      if (node !== undefined) {
        result.current.apply(setOverrideOp(node, "title", { $unset: true }));
      }
    });
    expect(overridesOf(result.current.document)).toEqual({
      title: { $unset: true },
    });
    act(() => result.current.undo());
    expect(overridesOf(result.current.document)).toEqual({ title: "Mine" });
  });
});
