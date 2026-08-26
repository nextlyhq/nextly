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
    const fields = blocksFieldsOf({
      fields: [
        { type: "text", name: "title" },
        { type: "blocks", name: "content" },
        { type: "richText", name: "summary" },
        { type: "blocks", name: "sidebar" },
      ],
    });

    expect(fields).toEqual([
      { name: "content", localized: false },
      { name: "sidebar", localized: false },
    ]);
  });

  it("returns nothing for a collection that declares none", () => {
    // The common case. The hook fires for EVERY collection, so most calls reach
    // here with nothing to do, and an empty list is what makes the filter live
    // in one place instead of in every caller.
    expect(
      blocksFieldsOf({ fields: [{ type: "text", name: "title" }] })
    ).toEqual([]);
  });

  it("carries a field's own localized flag on a localized collection", () => {
    const fields = blocksFieldsOf({
      localized: true,
      fields: [
        { type: "blocks", name: "content", localized: true },
        { type: "blocks", name: "sidebar", localized: false },
      ],
    });

    expect(fields).toEqual([
      { name: "content", localized: true },
      { name: "sidebar", localized: false },
    ]);
  });
});

describe("the collection's localization master switch", () => {
  it("reads a localized FIELD as shared when the COLLECTION is not localized", () => {
    // The switch is what storage obeys: a collection that stores no
    // translations keeps one value for this field under the empty locale key,
    // whatever the field declares. Reading the field flag alone would enumerate
    // a subject per configured language and leave the one subject a read
    // resolves to holding no rows — so the document's classes would be absent
    // from every count that matters.
    const fields = blocksFieldsOf({
      localized: false,
      fields: [{ type: "blocks", name: "content", localized: true }],
    });

    expect(fields).toEqual([{ name: "content", localized: false }]);
  });

  it("treats an ABSENT switch as off, which is the schema's default", () => {
    const fields = blocksFieldsOf({
      fields: [{ type: "blocks", name: "content", localized: true }],
    });

    expect(fields).toEqual([{ name: "content", localized: false }]);
  });

  it("leaves an unflagged field shared even when the collection is localized", () => {
    // The control on the pair above: a switch that simply overwrote the field's
    // answer would satisfy those two and this one would come out localized.
    // A blocks field has no per-type default, so it stays shared until asked.
    const fields = blocksFieldsOf({
      localized: true,
      fields: [{ type: "blocks", name: "content" }],
    });

    expect(fields).toEqual([{ name: "content", localized: false }]);
  });
});

describe("configuration that did not come from TypeScript", () => {
  it('reads a STRING "true" as not localized rather than as localized', () => {
    // Config reaches a hook as whatever the host wrote, and the Schema
    // Builder's stored payloads are JSON. A truthiness check would read this as
    // localized and file one document's classes under every language, leaving
    // the subject a read actually resolves holding none.
    const fields = blocksFieldsOf({
      localized: true,
      fields: [{ type: "blocks", name: "content", localized: "true" }],
    });

    expect(fields).toEqual([{ name: "content", localized: false }]);
  });

  it("reads a STRING master switch as off rather than as on", () => {
    const fields = blocksFieldsOf({
      localized: "true",
      fields: [{ type: "blocks", name: "content", localized: true }],
    });

    expect(fields).toEqual([{ name: "content", localized: false }]);
  });

  it("skips a field with no usable name", () => {
    // The name IS the `field` column of every row. Defaulting it would collect
    // every unnamed field's rows into one subject, and the reconciler would
    // then delete each field's rows on behalf of the others.
    const fields = blocksFieldsOf({
      fields: [
        { type: "blocks" },
        { type: "blocks", name: "" },
        { type: "blocks", name: 42 },
        { type: "blocks", name: "content" },
      ],
    });

    expect(fields).toEqual([{ name: "content", localized: false }]);
  });

  it("survives entries that are not objects at all", () => {
    const fields = blocksFieldsOf({
      fields: [
        null,
        undefined,
        "blocks",
        7,
        { type: "blocks", name: "content" },
      ],
    });

    expect(fields).toEqual([{ name: "content", localized: false }]);
  });

  it("returns nothing when the collection or its `fields` is absent", () => {
    expect(blocksFieldsOf(undefined)).toEqual([]);
    expect(blocksFieldsOf(null)).toEqual([]);
    expect(blocksFieldsOf({})).toEqual([]);
    expect(blocksFieldsOf({ fields: "content" })).toEqual([]);
  });
});

describe("two fields declared under one name", () => {
  it("yields ONE subject rather than two", () => {
    // A duplicate name addresses one subject. Enumerating it twice reconciles
    // the same rows twice in a single pass, and the second pass reads the
    // first's inserts as rows the document no longer justifies — so a correct
    // document would end with its own classes deleted.
    const fields = blocksFieldsOf({
      localized: true,
      fields: [
        { type: "blocks", name: "content" },
        { type: "blocks", name: "content", localized: true },
      ],
    });

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
    const fields = blocksFieldsOf({
      fields: [
        { type: "text", name: "title" },
        { type: "group", fields: [{ type: "blocks", name: "content" }] },
      ],
    });

    expect(fields).toEqual([{ name: "content", localized: false }]);
  });

  it("is FOUND when the group's name is the empty string", () => {
    // An empty name is what a host writes for a layout group it gave no key,
    // and core resolves references and redacts paths through such a group at
    // the PARENT level. Treating it as named here would put the child behind a
    // path storage never uses, so the document's classes would be missing from
    // the index while the page still renders them.
    const fields = blocksFieldsOf({
      fields: [
        {
          type: "group",
          name: "",
          fields: [{ type: "blocks", name: "content" }],
        },
      ],
    });

    expect(fields).toEqual([{ name: "content", localized: false }]);
  });

  it("is NOT found when the group is named", () => {
    // A named group nests its data under its own key, so the child is reachable
    // only through a path neither this nor the rebuild resolves. Indexing it
    // would file rows no rebuild could reconcile or sweep — the permanently
    // stranded state.
    //
    // This is the control on the cases above: without it, a walk that descended
    // into EVERY group would satisfy those assertions just as well.
    const fields = blocksFieldsOf({
      fields: [
        {
          type: "group",
          name: "seo",
          fields: [{ type: "blocks", name: "body" }],
        },
      ],
    });

    expect(fields).toEqual([]);
  });

  it("descends through presentational groups nested in each other", () => {
    const fields = blocksFieldsOf({
      fields: [
        {
          type: "group",
          fields: [
            { type: "group", fields: [{ type: "blocks", name: "deep" }] },
          ],
        },
      ],
    });

    expect(fields).toEqual([{ name: "deep", localized: false }]);
  });

  it("does not descend into a repeater", () => {
    // A repeater's children are per-row, so there is no single parent path.
    const fields = blocksFieldsOf({
      fields: [{ type: "repeater", fields: [{ type: "blocks", name: "row" }] }],
    });

    expect(fields).toEqual([]);
  });
});

describe("a group that contains itself", () => {
  it("still returns the sibling declared AFTER the cycle", () => {
    // Configuration is author-supplied and can be cyclic. Terminating is not
    // enough on its own: a walk that only counted iterations would put the
    // group back at the front of the queue every time, exhaust its bound
    // without ever reaching this sibling, and return an empty list — which is
    // indistinguishable from a collection that declares no blocks field, so
    // every class the document applies would read as unused.
    //
    // The cycle is listed FIRST deliberately. Behind it, the sibling is only
    // reachable once the group stops being re-expanded.
    const cyclic: Record<string, unknown> = { type: "group" };
    cyclic.fields = [cyclic, { type: "blocks", name: "content" }];

    const fields = blocksFieldsOf({ fields: [cyclic] });

    expect(fields).toEqual([{ name: "content", localized: false }]);
  });

  it("terminates rather than throwing", () => {
    const cyclic: Record<string, unknown> = { type: "group" };
    cyclic.fields = [cyclic];

    expect(() => blocksFieldsOf({ fields: [cyclic] })).not.toThrow();
  });

  it("finds a field through two groups that contain each other", () => {
    const outer: Record<string, unknown> = { type: "group" };
    const inner: Record<string, unknown> = { type: "group" };
    outer.fields = [inner];
    inner.fields = [outer, { type: "blocks", name: "content" }];

    expect(blocksFieldsOf({ fields: [outer] })).toEqual([
      { name: "content", localized: false },
    ]);
  });
});
