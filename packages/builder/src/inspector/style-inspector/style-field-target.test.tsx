// @vitest-environment jsdom

/**
 * A field's writes when a shared style is the target: several paths set in
 * one gesture reach the host as one change, so one undo takes them back.
 *
 * @module style-field-target.test
 */
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import { renderHook } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import type { EditorState } from "../../editor-state";
import type { SharedStyleChange } from "../../shared-style-target";
import { StyleTargetContext } from "./style-field-surroundings";
import { useFieldTarget } from "./style-field-target";
import type { StyleTarget } from "./style-target";

const document = {
  formatVersion: 1,
  kind: "page",
  nodes: [{ id: "a", type: "acme/box", version: 1, props: {} }] as BlockNode[],
} as BlockDocument;

const editor = {
  document,
  selectedId: "a",
  selection: { ids: ["a"], primary: "a" },
  applyAll: vi.fn(() => document),
  lockRefusalFor: () => undefined,
} as unknown as EditorState;

describe("a field writing into a shared style", () => {
  it("sends the sides of one gesture to the host as ONE change", () => {
    const write = vi.fn(
      async (_change: SharedStyleChange): Promise<string | undefined> =>
        undefined
    );
    const target: StyleTarget = {
      kind: "shared",
      worn: [],
      readOnly: undefined,
      write,
      style: {
        id: "c-card",
        name: "Card",
        slug: "card",
        className: ".nx-c-card",
        locked: false,
        inCode: false,
        styles: {},
      },
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <StyleTargetContext.Provider value={target}>
        {children}
      </StyleTargetContext.Provider>
    );
    const { result } = renderHook(
      () =>
        useFieldTarget({
          editor,
          nodeId: "a",
          address: {
            state: "base",
            breakpoint: "base",
            property: "padding",
            path: ["blockStart"],
          },
          policy: undefined,
        }),
      { wrapper }
    );
    const outcome = result.current.commitSides(
      [["blockStart"], ["inlineEnd"], ["blockEnd"], ["inlineStart"]],
      "8px"
    );
    expect(outcome).toBe("applied");
    expect(write).toHaveBeenCalledTimes(1);
    const change = write.mock.calls[0]?.[0];
    if (change === undefined) throw new Error("no change");
    expect(change({})).toEqual({
      kind: "write",
      styles: {
        base: {
          base: {
            padding: {
              blockStart: "8px",
              inlineEnd: "8px",
              blockEnd: "8px",
              inlineStart: "8px",
            },
          },
        },
      },
    });
  });
});
