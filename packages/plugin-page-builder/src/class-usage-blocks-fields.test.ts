/**
 * Whether the write path's filter finds the fields it is responsible for, and
 * only those.
 *
 * Both directions cost something specific. A field missed is a field whose
 * classes are never counted, so they read as unused and can be deleted while a
 * page still renders them. A field wrongly included writes rows under a subject
 * no document backs, and nothing downstream can tell them from real ones.
 *
 * @module class-usage-blocks-fields.test
 */
import { describe, expect, it } from "vitest";

import { blocksFieldsOf } from "./class-usage-blocks-fields";

describe("finding the blocks fields on a collection", () => {
  it("returns the blocks fields and ignores every other type", () => {
    const fields = blocksFieldsOf([
      { type: "text", name: "title" },
      { type: "blocks", name: "content" },
      { type: "richText", name: "summary" },
      { type: "blocks", name: "sidebar" },
    ]);

    expect(fields).toEqual([
      { name: "content", localized: false },
      { name: "sidebar", localized: false },
    ]);
  });

  it("returns nothing for a collection that declares none", () => {
    // The common case. The hook fires for EVERY collection, so most calls reach
    // here with nothing to do, and an empty list is what makes the filter live
    // in one place instead of in every caller.
    expect(blocksFieldsOf([{ type: "text", name: "title" }])).toEqual([]);
  });

  it("carries a field's own localized flag", () => {
    const fields = blocksFieldsOf([
      { type: "blocks", name: "content", localized: true },
      { type: "blocks", name: "sidebar", localized: false },
    ]);

    expect(fields).toEqual([
      { name: "content", localized: true },
      { name: "sidebar", localized: false },
    ]);
  });
});

describe("configuration that did not come from TypeScript", () => {
  it('reads a STRING "true" as not localized rather than as localized', () => {
    // Config reaches a hook as whatever the host wrote, and the Schema
    // Builder's stored payloads are JSON. A truthiness check would read this as
    // localized and file one document's classes under every language, leaving
    // the subject a read actually resolves holding none.
    const fields = blocksFieldsOf([
      { type: "blocks", name: "content", localized: "true" },
    ]);

    expect(fields).toEqual([{ name: "content", localized: false }]);
  });

  it("skips a field with no usable name", () => {
    // The name IS the `field` column of every row. Defaulting it would collect
    // every unnamed field's rows into one subject, and the reconciler would
    // then delete each field's rows on behalf of the others.
    const fields = blocksFieldsOf([
      { type: "blocks" },
      { type: "blocks", name: "" },
      { type: "blocks", name: 42 },
      { type: "blocks", name: "content" },
    ]);

    expect(fields).toEqual([{ name: "content", localized: false }]);
  });

  it("survives entries that are not objects at all", () => {
    const fields = blocksFieldsOf([
      null,
      undefined,
      "blocks",
      7,
      { type: "blocks", name: "content" },
    ]);

    expect(fields).toEqual([{ name: "content", localized: false }]);
  });

  it("returns nothing when `fields` is absent or not an array", () => {
    expect(blocksFieldsOf(undefined)).toEqual([]);
    expect(blocksFieldsOf("content" as unknown as unknown[])).toEqual([]);
  });
});

describe("two fields declared under one name", () => {
  it("yields ONE subject rather than two", () => {
    // A duplicate name addresses one subject. Enumerating it twice reconciles
    // the same rows twice in a single pass, and the second pass reads the
    // first's inserts as rows the document no longer justifies — so a correct
    // document would end with its own classes deleted.
    const fields = blocksFieldsOf([
      { type: "blocks", name: "content" },
      { type: "blocks", name: "content", localized: true },
    ]);

    expect(fields).toEqual([{ name: "content", localized: false }]);
  });
});

describe("a blocks field inside a group", () => {
  it("is FOUND when the group is presentational (nameless)", () => {
    // A group without a `name` stores nothing of its own — its children live at
    // the parent path. So `item.content` resolves this exactly as it would a
    // top-level declaration, and skipping it would leave the document's classes
    // out of the index entirely: a class the page still renders would read as
    // unused and could be deleted.
    const fields = blocksFieldsOf([
      { type: "text", name: "title" },
      { type: "group", fields: [{ type: "blocks", name: "content" }] },
    ]);

    expect(fields).toEqual([{ name: "content", localized: false }]);
  });

  it("is NOT found when the group is named", () => {
    // A named group nests its data under its own key, so the child is reachable
    // only through a path neither this nor the rebuild resolves. Indexing it
    // would file rows no rebuild could reconcile or sweep — the permanently
    // stranded state.
    //
    // This is the control on the case above: without it, a walk that descended
    // into EVERY group would satisfy that assertion just as well.
    const fields = blocksFieldsOf([
      {
        type: "group",
        name: "seo",
        fields: [{ type: "blocks", name: "body" }],
      },
    ]);

    expect(fields).toEqual([]);
  });

  it("descends through presentational groups nested in each other", () => {
    const fields = blocksFieldsOf([
      {
        type: "group",
        fields: [{ type: "group", fields: [{ type: "blocks", name: "deep" }] }],
      },
    ]);

    expect(fields).toEqual([{ name: "deep", localized: false }]);
  });

  it("does not descend into a repeater", () => {
    // A repeater's children are per-row, so there is no single parent path.
    const fields = blocksFieldsOf([
      { type: "repeater", fields: [{ type: "blocks", name: "row" }] },
    ]);

    expect(fields).toEqual([]);
  });

  it("terminates on a group that contains itself", () => {
    // Configuration is author-supplied and can be cyclic. Without a bound this
    // walk would spin, and the failure would be a hung save rather than a
    // visible error.
    const cyclic: Record<string, unknown> = { type: "group" };
    cyclic.fields = [cyclic, { type: "blocks", name: "content" }];

    expect(() => blocksFieldsOf([cyclic])).not.toThrow();
  });
});
