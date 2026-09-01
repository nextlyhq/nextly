import type { BlockNode } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { countByType, documentNodes, totalBlocks } from "./page-summary";

describe("documentNodes", () => {
  it("reads the nodes out of a document", () => {
    expect(
      documentNodes({ nodes: [{ id: "a", type: "core/text" }] })
    ).toHaveLength(1);
  });

  /*
   * A blocks field renders inside a create form and inside previews, where the
   * value is legitimately absent rather than wrong. Every one of these is a
   * shape the form can hold, so answering "no nodes" is the only reading that
   * does not throw on a page an author has not started.
   */
  it("answers empty for every value that is not a document", () => {
    for (const value of [undefined, null, {}, { nodes: "no" }, 7, "x", []]) {
      expect(documentNodes(value)).toEqual([]);
    }
  });
});

describe("countByType", () => {
  it("counts children under named slots, not only the top level", () => {
    const counts = countByType([
      {
        id: "s",
        type: "core/section",
        slots: { children: [{ id: "t", type: "core/text" }] },
      },
      { id: "t2", type: "core/text" },
    ] as unknown as readonly BlockNode[]);

    expect(counts.get("core/text")).toBe(2);
    expect(counts.get("core/section")).toBe(1);
  });

  /*
   * A stored document predates its validators, so a row can hold a node whose
   * type is missing or is not a string. Counting it would put `undefined` in
   * the reading an author sees.
   */
  it("skips a node with no string type rather than counting it", () => {
    expect(
      countByType([
        { id: "a", type: 7 },
        null,
        undefined,
      ] as unknown as readonly BlockNode[]).size
    ).toBe(0);
  });
});

describe("totalBlocks", () => {
  it("sums every count", () => {
    expect(
      totalBlocks(
        new Map([
          ["a", 2],
          ["b", 1],
        ])
      )
    ).toBe(3);
  });

  it("is zero for an empty document", () => {
    expect(totalBlocks(new Map())).toBe(0);
  });
});
