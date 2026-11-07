/**
 * Which blocks' visibility conditions the page can't check, read once for the
 * inspector's notice and the canvas's red badge alike.
 */
import { DEFAULT_LIMITS, type BlockNode } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { uncheckedConditionIds } from "./condition-checks";
import { gatedAsStored } from "./condition-gate";
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
    expect([...uncheckedConditionIds(nodes, "loading", "posts")]).toEqual([
      "unreadable",
    ]);
  });
});

describe("whether a stored block's conditions decide who sees it", () => {
  it("ignores placement gates a stored document holds, as the published page does", () => {
    const stored = {
      id: "a",
      type: "core/text",
      version: 1,
      props: {},
      visibility: { within: ["hidden"] },
    } as unknown as BlockNode;
    expect(gatedAsStored(stored)).toBe(false);
    // CONTROL: its own conditions still decide.
    expect(
      gatedAsStored(gated("b", [[{ field: "title", op: "exists" }]]))
    ).toBe(true);
  });
});

describe("how far the check reads a document", () => {
  it("stops where a save stops surveying, so an oversized document can't stall the editor", () => {
    const plain = (id: string) =>
      ({ id, type: "core/text", version: 1, props: {} }) as BlockNode;
    const unreadable = gated("late", [{ field: "title", op: "exists" }]);
    const past = [
      ...Array.from({ length: DEFAULT_LIMITS.maxNodes }, (_, at) =>
        plain(`n${String(at)}`)
      ),
      unreadable,
    ];
    expect(uncheckedConditionIds(past, "loading", "posts").size).toBe(0);
    // CONTROL: within the limit, the same block is found.
    expect([
      ...uncheckedConditionIds([unreadable], "loading", "posts"),
    ]).toEqual(["late"]);
  });
});

describe("when the collections can't be listed", () => {
  it("still marks what needs no fields: an entry condition on a Single's page", () => {
    const entryCondition = gated("single", [
      [{ field: "title", op: "exists" }],
    ]);
    // A Single's page has no entry, so the condition can never be checked.
    expect([
      ...uncheckedConditionIds([entryCondition], "unavailable", null),
    ]).toEqual(["single"]);
    // CONTROL: while they load, it isn't marked yet.
    expect(uncheckedConditionIds([entryCondition], "loading", null).size).toBe(
      0
    );
  });

  it("reads only as far as the limit the host gives", () => {
    const unreadable = gated("late", [{ field: "title", op: "exists" }]);
    const plain = {
      id: "p",
      type: "core/text",
      version: 1,
      props: {},
    } as BlockNode;
    expect(
      uncheckedConditionIds([plain, unreadable], "loading", "posts", 1).size
    ).toBe(0);
    expect(
      uncheckedConditionIds([plain, unreadable], "loading", "posts", 2).size
    ).toBe(1);
  });
});
