/**
 * Gating a document by its blocks' visibility conditions, once the entry the
 * page shows is known.
 *
 * Every block whose conditions read the page's entry is decided here: kept,
 * and named as held, when they hold for the entry; removed with its subtree
 * when they don't or can't be checked. A block a list's item decides is left
 * for the list to decide per item, and nothing else is touched, so a document
 * with no conditions comes back as the same object.
 */
import type {
  BlockDocument,
  BlockNode,
  ConditionSubject,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import type { BlocksFieldShapes } from "./context";
import {
  conditionAllows,
  entrySubjectOf,
  gateByConditions,
} from "./visibility";

const box = (
  id: string,
  conditions?: unknown,
  slots?: Record<string, BlockNode[]>
): BlockNode =>
  ({
    id,
    type: "core/box",
    version: 1,
    props: {},
    ...(conditions === undefined ? {} : { visibility: { conditions } }),
    ...(slots === undefined ? {} : { slots }),
  }) as BlockNode;

const doc = (...nodes: BlockNode[]): BlockDocument =>
  ({ formatVersion: 1, kind: "page", nodes }) as BlockDocument;

const entry = (values: Record<string, unknown>): ConditionSubject => ({
  fields: {
    declared: new Set(["tier", "secret"]),
    readable: [{ name: "tier", type: "select", options: ["free", "vip"] }],
  },
  values,
});

const vip = [[{ field: "tier", op: "equals", value: "vip" }]];

describe("gating a page by its entry", () => {
  it("keeps a block whose conditions hold, and names it held", () => {
    const page = doc(box("a", vip), box("b"));
    const gated = gateByConditions(page, { entry: entry({ tier: "vip" }) });
    expect(gated.document.nodes.map(node => node.id)).toEqual(["a", "b"]);
    expect([...gated.held]).toEqual(["a"]);
    // Nothing removed: the same object, so a stored sheet is still trusted.
    expect(gated.document).toBe(page);
  });

  it("removes a block whose conditions don't hold, with its subtree", () => {
    const page = doc(box("a", vip, { children: [box("child")] }), box("b"));
    const gated = gateByConditions(page, { entry: entry({ tier: "free" }) });
    expect(gated.document.nodes.map(node => node.id)).toEqual(["b"]);
    expect(gated.held.size).toBe(0);
    expect(gated.issues).toEqual([]);
  });

  it("removes and reports a block whose conditions can't be checked", () => {
    const page = doc(box("a", [[{ field: "secret", op: "exists" }]]));
    const gated = gateByConditions(page, { entry: entry({ secret: "x" }) });
    expect(gated.document.nodes).toEqual([]);
    expect(gated.issues.map(issue => `${issue.kind} ${issue.code}`)).toEqual([
      "condition condition-field-protected",
    ]);
  });

  it("removes and reports every entry condition on a page with no entry", () => {
    const gated = gateByConditions(doc(box("a", vip)), {});
    expect(gated.document.nodes).toEqual([]);
    expect(gated.issues.map(issue => issue.code)).toEqual([
      "condition-source-unavailable",
    ]);
  });

  it("leaves a block a list's item decides for the list, and decides its empty state", () => {
    const list = {
      id: "l",
      type: "core/collection-loop",
      version: 1,
      props: { collection: "posts" },
      slots: {
        children: [box("perItem", [[{ field: "title", op: "exists" }]])],
        empty: [box("whenEmpty", vip)],
      },
    } as BlockNode;
    const gated = gateByConditions(doc(list), {
      entry: entry({ tier: "free" }),
    });
    const kept = gated.document.nodes[0]?.slots;
    expect(kept?.children?.map(node => node.id)).toEqual(["perItem"]);
    expect(kept?.empty).toEqual([]);
    expect(gated.held.size).toBe(0);
  });

  it("keeps every conditioned block when asked to keep them all", () => {
    const page = doc(box("a", vip), box("b", [[{ field: "x", op: "nope" }]]));
    const kept = gateByConditions(page, "keep-all");
    expect(kept.document).toBe(page);
    expect(kept.issues).toEqual([]);
  });
});

describe("a conditioned block where it is drawn", () => {
  const titled = [[{ field: "title", op: "contains", value: "guide" }]];
  const posts: BlocksFieldShapes = {
    fieldsOf: ref =>
      "collection" in ref && ref.collection === "posts"
        ? [{ name: "title", type: "text" }]
        : undefined,
  };

  it("draws a block its entry held, and nothing else conditioned outside a list", () => {
    const held = new Set(["a"]);
    expect(conditionAllows(box("a", vip), {}, { held })).toBe(true);
    expect(conditionAllows(box("b", vip), {}, { held })).toBe(false);
    expect(conditionAllows(box("c"), {})).toBe(true);
  });

  it("decides a block inside a list by the item being drawn", () => {
    const context = (title: string) => ({
      item: { title },
      itemSource: "posts",
      fieldShapes: posts,
    });
    expect(conditionAllows(box("a", titled), context("A Guide to lists"))).toBe(
      true
    );
    expect(conditionAllows(box("a", titled), context("Release notes"))).toBe(
      false
    );
  });

  it("hides and reports an item's condition it can't check", () => {
    const reported: string[] = [];
    const allowed = conditionAllows(
      box("a", [[{ field: "secret", op: "exists" }]]),
      { item: { secret: "x" }, itemSource: "posts", fieldShapes: posts },
      { report: issues => reported.push(...issues.map(issue => issue.code)) }
    );
    expect(allowed).toBe(false);
    expect(reported).toEqual(["condition-field-unknown"]);
  });

  it("hides a block inside a list whose items' fields are not known", () => {
    expect(
      conditionAllows(box("a", titled), { item: { title: "A guide" } })
    ).toBe(false);
  });
});

describe("the entry a page's conditions read", () => {
  const shapes = {
    fieldsOf: () => [{ name: "title", type: "text" }] as const,
  };

  it("is the public's read of a collection entry", () => {
    const subject = entrySubjectOf({
      entry: { title: "Hello" },
      entryRef: { collection: "posts" },
      fieldShapes: shapes,
    });
    expect(subject.entry?.values).toEqual({ title: "Hello" });
  });

  it("is nothing when the public's fields of the entry aren't known", () => {
    expect(
      entrySubjectOf({
        entry: { title: "Hello" },
        entryRef: { collection: "posts" },
      })
    ).toEqual({});
  });
});
