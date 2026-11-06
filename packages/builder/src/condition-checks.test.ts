/**
 * Which blocks' visibility conditions the page can't check, read once for the
 * inspector's notice and the canvas's red badge alike.
 */
import type { BlockNode } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { uncheckedConditionIds } from "./condition-checks";
import type { LoopCollection } from "./content-controls";

const POSTS: LoopCollection = {
  slug: "posts",
  label: "Posts",
  fields: [{ name: "title", label: "Title", kind: "text" }],
  declared: ["title", "secret"],
  readable: [{ name: "title", label: "Title", type: "text" }],
};

const gated = (id: string, conditions: unknown): BlockNode =>
  ({
    id,
    type: "core/text",
    version: 1,
    props: {},
    visibility: { conditions },
  }) as BlockNode;

describe("the blocks whose conditions the page can't check", () => {
  const nodes = [
    gated("fine", [[{ field: "title", op: "exists" }]]),
    gated("hidden", [[{ field: "secret", op: "exists" }]]),
    gated("unreadable", [{ field: "title", op: "exists" }]),
  ];

  it("names one on a field visitors can't see, and one stored in a shape no row can show", () => {
    expect([...uncheckedConditionIds(nodes, [POSTS], "posts")].sort()).toEqual([
      "hidden",
      "unreadable",
    ]);
  });

  it("marks only the unreadable ones while the collections load, so nothing flashes red", () => {
    expect([...uncheckedConditionIds(nodes, undefined, "posts")]).toEqual([
      "unreadable",
    ]);
  });
});
