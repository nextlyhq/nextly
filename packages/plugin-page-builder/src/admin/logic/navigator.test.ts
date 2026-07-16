import { describe, expect, it } from "vitest";

import { makeNode } from "../../core/tree";

import { flattenTree } from "./navigator";

describe("flattenTree", () => {
  it("lists nodes depth-first with depth tags", () => {
    const root = makeNode("core/container", {}, undefined, {
      default: [
        makeNode("core/heading", {}),
        makeNode("core/columns", {}, undefined, {
          default: [makeNode("core/paragraph", {})],
        }),
      ],
    });
    const rows = flattenTree(root);
    expect(rows.map(r => r.type)).toEqual([
      "core/container",
      "core/heading",
      "core/columns",
      "core/paragraph",
    ]);
    expect(rows.map(r => r.depth)).toEqual([0, 1, 1, 2]);
  });
});
