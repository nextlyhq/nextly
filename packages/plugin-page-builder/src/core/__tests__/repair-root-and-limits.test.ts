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

describe("a wrapper this build cannot construct", () => {
  const shell = defineBlock({
    name: "acme/shell",
    version: 1,
    description: "A contributed container.",
    example: { props: {} },
    slots: { default: {} },
    render: () => null,
  });
  const only = defineBlock({
    name: "acme/only",
    version: 1,
    description: "Belongs in a contributed container.",
    example: { props: {} },
    parent: ["acme/shell"],
    render: () => null,
  });

  afterEach(() => {
    clearBlocks();
  });

  it("is not offered, even though the nesting rule is enforced", () => {
    registerBlocks([shell, only], { source: "@acme/blocks" });
    const root = node("core/container", { default: [node("acme/only")] });
    const [entry] = findInvalidSlotEntries(root, registry);
    // The fault IS reported — the rule is enforced for a contributed block.
    expect(entry).toMatchObject({ kind: "not-allowed", type: "acme/only" });
    // The repair is not offered, because `createNode` and the canvas read this package's registry
    // and would build an empty unknown block that hides the child it was preserving.
    expect((entry as { wrapWith?: string }).wrapWith).toBeUndefined();
  });
});

/*
 * A block declaring `parent: []` no longer reaches this finder: `registerBlocks` refuses an empty
 * list outright, because it permits no placement at all and omitting `parent` already means
 * "anywhere". That refusal is pinned in
 * `packages/blocks-engine/src/registry.parent-validation.test.ts`.
 *
 * The finder still tests `parent` as DEFINED rather than non-empty, matching what `validate` asks.
 * The state is unreachable through registration today and the guard costs nothing — an assertion
 * over a value already in hand — and reachability is a property of the current call graph rather
 * than of the code.
 */

describe("a wrapper that is itself restricted", () => {
  /**
   * `acme/incolumn` may only sit in `core/column`, and `core/column` may only sit in
   * `core/columns`. Restrictions chain, so offering the wrapper without asking where IT may sit
   * moves the violation up a level: the banner clears and `validate` refuses the result, naming
   * the block the repair just inserted.
   *
   * The wrapper is a CORE block deliberately. A contributed one is refused earlier, by the guard
   * that declines wrappers this build cannot construct — so a test using one would pass without
   * ever reaching the restriction being checked here.
   */
  const inColumn = defineBlock({
    name: "acme/incolumn",
    version: 1,
    description: "Belongs in a column.",
    example: { props: {} },
    parent: ["core/column"],
    render: () => null,
  });

  afterEach(() => {
    clearBlocks();
  });

  it("is not offered where it could not sit", () => {
    registerBlocks([inColumn], { source: "@acme/blocks" });
    // A `core/column` may only sit in `core/columns`, and this is a `core/container`.
    const root = node("core/container", { default: [node("acme/incolumn")] });
    const [entry] = findInvalidSlotEntries(root, registry);
    expect(entry).toMatchObject({ kind: "not-allowed", type: "acme/incolumn" });
    expect((entry as { wrapWith?: string }).wrapWith).toBeUndefined();
  });

  it("IS offered where it could sit, so the refusal above is about placement", () => {
    // The separating control. Inside a `core/columns`, wrapping in `core/column` is legal and is
    // exactly the repair to offer — without this, a guard that refused every restricted wrapper
    // would pass the case above for the wrong reason.
    registerBlocks([inColumn], { source: "@acme/blocks" });
    const root = node("core/columns", { default: [node("acme/incolumn")] });
    const [entry] = findInvalidSlotEntries(root, registry);
    expect(entry).toMatchObject({
      kind: "not-allowed",
      type: "acme/incolumn",
      wrapWith: "core/column",
    });
  });

  it("is not offered as a ROOT, because a root sits inside nothing", () => {
    registerBlocks([inColumn], { source: "@acme/blocks" });
    const root = node("acme/incolumn");
    const [entry] = findInvalidSlotEntries(root, registry);
    expect(entry).toMatchObject({ kind: "root-parent", type: "acme/incolumn" });
    // `core/column` would satisfy the child and is itself restricted, so promoting it to root
    // reproduces the very fault being repaired.
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
