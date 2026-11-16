/**
 * The page's one budget counts what it grants, by kind, and what it refuses,
 * naming each block that asked once refused.
 */
import { describe, expect, it, vi } from "vitest";

import { createQueryBudget } from "./context";

describe("createQueryBudget's count", () => {
  it("counts each granted read by kind and each refused one, naming the blocks refused once each", () => {
    const onRefused = vi.fn();
    const budget = createQueryBudget(3, { onRefused });
    expect(budget.take({ kind: "entries", nodeId: "list" })).toBe(true);
    expect(budget.take({ kind: "image", nodeId: "picture" })).toBe(true);
    // No kind is the page's own data.
    expect(budget.take()).toBe(true);
    expect(budget.take({ kind: "image", nodeId: "picture" })).toBe(false);
    expect(budget.take({ kind: "image", nodeId: "picture" })).toBe(false);
    expect(budget.take({ kind: "link", nodeId: "more" })).toBe(false);
    expect(budget.take()).toBe(false);
    expect(budget.report()).toEqual({
      cap: 3,
      used: 3,
      refused: 4,
      byKind: { entries: 1, image: 1, page: 1 },
      unread: [
        { nodeId: "picture", what: "image" },
        { nodeId: "more", what: "link" },
      ],
    });
    expect(onRefused).toHaveBeenCalledTimes(4);
    expect(budget.remaining()).toBe(0);
  });

  it("takes a fractional cap as the whole reads it allows, in take, remaining and report alike", () => {
    const half = createQueryBudget(0.5);
    expect(half.take()).toBe(false);
    expect(half.remaining()).toBe(0);
    expect(half.report()).toMatchObject({ cap: 0, used: 0, refused: 1 });
    const almostThree = createQueryBudget(2.7);
    expect([
      almostThree.take(),
      almostThree.take(),
      almostThree.take(),
    ]).toEqual([true, true, false]);
    expect(almostThree.remaining()).toBe(0);
    expect(almostThree.report()).toMatchObject({ cap: 2, used: 2, refused: 1 });
  });

  it("an unlimited budget still counts what it granted", () => {
    const budget = createQueryBudget(Infinity);
    for (let index = 0; index < 5; index += 1) budget.take({ kind: "related" });
    expect(budget.report()).toMatchObject({
      cap: Infinity,
      used: 5,
      refused: 0,
      byKind: { related: 5 },
    });
  });
});
