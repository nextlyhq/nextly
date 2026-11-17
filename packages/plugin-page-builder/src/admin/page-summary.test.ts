import type { BlockNode } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { documentNodes } from "./page-summary";

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
