/**
 * What the repair finder does at the edges: a restricted ROOT, and a document with no room left.
 *
 * Both faults share a failure mode that is worse than being unreported — the banner clears, or
 * never appears, while the page still refuses to save. So each assertion below is about what the
 * AUTHOR is told, not only about what the finder returns.
 */
import { clearBlocks, registerBlocks } from "@nextlyhq/blocks-engine";
import { defineBlock } from "@nextlyhq/plugin-sdk/blocks";
import { afterEach, describe, expect, it } from "vitest";

import { findInvalidSlotEntries, repairInvalidSlot } from "../invalid-slots";
import { createBlockRegistry } from "../registry";
import { makeNode } from "../tree";
import { MAX_DEPTH, MAX_NODES, type BlockNode } from "../types";

/** Empty: every structural answer here comes from the declared structures, as the server path does. */
const registry = createBlockRegistry();

const node = (type: string, slots?: Record<string, BlockNode[]>): BlockNode =>
  makeNode(type, {}, undefined, slots);

describe("a root that restricts its parents", () => {
  it("is reported, with the wrapper that would fix it", () => {
    // `core/column` may only sit inside `core/columns`, so as a ROOT it satisfies nothing. Before
    // this was found the page was unsaveable and the banner was empty.
    const root = node("core/column", { default: [node("core/heading")] });
    const entries = findInvalidSlotEntries(root, registry);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "root-parent",
      type: "core/column",
      wrapWith: "core/columns",
    });
  });

  it("is repaired by becoming the wrapper's child", () => {
    const root = node("core/column", { default: [node("core/heading")] });
    const [entry] = findInvalidSlotEntries(root, registry);
    const repaired = repairInvalidSlot(root, entry, registry);
    expect(repaired.type).toBe("core/columns");
    expect(repaired.slots?.default).toHaveLength(1);
    expect(repaired.slots?.default[0].type).toBe("core/column");
    // And the repair actually resolves it, rather than moving the fault: re-running the finder on
    // the result is the only assertion that separates "we changed something" from "we fixed it".
    expect(findInvalidSlotEntries(repaired, registry)).toEqual([]);
  });

  it("says nothing about a root that restricts nothing", () => {
    // The control. Without it, a finder that reported EVERY root would pass both tests above.
    const root = node("core/container", { default: [node("core/heading")] });
    expect(findInvalidSlotEntries(root, registry)).toEqual([]);
  });
});

describe("a wrap repair against the node limit", () => {
  /** A row holding one legal column of `filler` headings, plus a heading that does not belong. */
  function rowWithFillerAnd(offenders: number): BlockNode {
    const fill = Array.from({ length: offenders }, () => node("core/heading"));
    return node("core/columns", {
      default: [node("core/column", { default: fill }), node("core/heading")],
    });
  }

  it("is offered while the document has room for one more node", () => {
    // The positive control, and it is what makes the refusal below mean something: the same shape
    // at a smaller size DOES get a wrapper, so a refusal cannot be blamed on the shape.
    const [entry] = findInvalidSlotEntries(rowWithFillerAnd(10), registry);
    expect(entry).toMatchObject({
      kind: "not-allowed",
      wrapWith: "core/column",
    });
  });

  it("is withheld once the document is already at the limit", () => {
    // Applying a wrapper here adds the node that pushes the tree past MAX_NODES: the slot banner
    // clears and `validate` then refuses the result for a count the author never chose. Removal
    // stays available, which is why the entry is still reported.
    const [entry] = findInvalidSlotEntries(
      rowWithFillerAnd(MAX_NODES),
      registry
    );
    expect(entry).toMatchObject({ kind: "not-allowed" });
    expect(entry).not.toHaveProperty("wrapWith", "core/column");
    expect((entry as { wrapWith?: string }).wrapWith).toBeUndefined();
  });
});

describe("a wrap repair against the DEPTH limit", () => {
  /** A misplaced heading wrapped in `depth` further containers, inside a row that refuses it. */
  function rowHolding(depth: number): BlockNode {
    let inner = node("core/heading");
    for (let i = 0; i < depth; i += 1) {
      inner = node("core/container", { default: [inner] });
    }
    // The offender is the CONTAINER chain's outermost node, which the row's allowlist refuses.
    return node("core/columns", { default: [inner] });
  }

  it("is offered while the whole subtree still fits", () => {
    // The positive control at the same shape and a smaller size, so a refusal below cannot be
    // blamed on the shape itself.
    const [entry] = findInvalidSlotEntries(rowHolding(2), registry);
    expect(entry).toMatchObject({
      kind: "not-allowed",
      wrapWith: "core/column",
    });
  });

  it("is withheld when the subtree's DEEPEST node is already at the limit", () => {
    // The node being wrapped sits well inside the limit; what does not is the bottom of what it
    // holds. A check reading only the node's own depth clears the banner and leaves the page
    // refused at a depth the author never chose and cannot see.
    const [entry] = findInvalidSlotEntries(rowHolding(MAX_DEPTH), registry);
    expect(entry).toMatchObject({ kind: "not-allowed" });
    expect((entry as { wrapWith?: string }).wrapWith).toBeUndefined();
  });
});

describe("a child permitted under several parents", () => {
  const multi = defineBlock({
    name: "acme/multi",
    version: 1,
    description: "Fits in more than one kind of parent.",
    example: { props: {} },
    parent: ["core/column", "core/container"],
    render: () => null,
  });

  afterEach(() => {
    clearBlocks();
  });

  it("is wrapped in the one its slot admits, rather than offered removal", () => {
    registerBlocks([multi], { source: "@acme/blocks" });
    // The row's slot admits only `core/column`, so exactly one of the block's two permitted parents
    // is available — a determined answer, even though the block itself named two. Counting the
    // block's list before narrowing it by the slot would decline and discard the block.
    const root = node("core/columns", { default: [node("acme/multi")] });
    const [entry] = findInvalidSlotEntries(root, registry);
    expect(entry).toMatchObject({
      kind: "not-allowed",
      type: "acme/multi",
      wrapWith: "core/column",
    });
  });

  it("is offered no wrapper where the slot admits more than one of them", () => {
    // The separating case: ambiguity the slot does NOT resolve is a choice for the author, and
    // guessing would silently pick one. `core/cover` is not on the block's list, so the block is
    // genuinely misplaced — and its slot restricts nothing, so BOTH permitted parents could be put
    // around it and neither is the answer.
    registerBlocks([multi], { source: "@acme/blocks" });
    const root = node("core/cover", { default: [node("acme/multi")] });
    const [entry] = findInvalidSlotEntries(root, registry);
    expect(entry).toMatchObject({ kind: "not-allowed", type: "acme/multi" });
    expect((entry as { wrapWith?: string }).wrapWith).toBeUndefined();
  });
});
