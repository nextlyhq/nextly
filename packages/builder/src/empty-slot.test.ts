/**
 * Which of a block's declared regions is empty — the one question both the
 * inserter and the canvas appender ask.
 */
import { describe, expect, it } from "vitest";
import type { BlockNode } from "@nextlyhq/blocks-engine";

import { emptySlotOf } from "./empty-slot";

const slots = {
  slotsOf: (type: string) =>
    type === "core/box" ? (["children"] as const) : undefined,
};

function box(children?: BlockNode[]): BlockNode {
  return {
    id: "b1",
    type: "core/box",
    version: 1,
    props: {},
    ...(children ? { slots: { children } } : {}),
  };
}

const leaf: BlockNode = {
  id: "h1",
  type: "core/heading",
  version: 1,
  props: {},
};

describe("emptySlotOf", () => {
  it("names the slot when a container has no children", () => {
    expect(emptySlotOf(box(), slots)).toBe("children");
  });

  it("names the slot when the slot is present but empty", () => {
    expect(emptySlotOf(box([]), slots)).toBe("children");
  });

  it("answers null when the container has a child", () => {
    expect(emptySlotOf(box([leaf]), slots)).toBeNull();
  });

  it("answers null for a block that declares no slots", () => {
    expect(emptySlotOf(leaf, slots)).toBeNull();
  });

  it("answers null when no slot source is supplied", () => {
    // The inserter's `slots` argument is optional, and without it nothing can
    // be known about declarations. Guessing would put a block inside an
    // element that has nowhere to hold it.
    expect(emptySlotOf(box(), undefined)).toBeNull();
  });
});
