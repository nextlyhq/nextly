/**
 * Which fields are addressable at a level, with presentational groups flattened.
 *
 * The walk had FIVE call sites across two domains — three in
 * `domains/versions/tag-component-types.ts`, one in
 * `domains/collections/services/collection-mutation-service.ts` — and no test
 * anywhere. These pin what it already did BEFORE it moved, so the promotion
 * can be shown to change nothing that was working, and then pin the two ways
 * it died on input an author can write.
 *
 * @module shared/__tests__/addressable-fields
 */
import { describe, expect, it } from "vitest";

import { addressableFields } from "../addressable-fields";

/** A field config, as loosely as the walk actually reads one. */
const f = (over: Record<string, unknown>): never => over as never;

const namesOf = (fields: readonly unknown[]): unknown[] =>
  fields.map(field => (field as { name?: unknown }).name);

describe("addressableFields - what it already did", () => {
  it("keeps a named field", () => {
    expect(namesOf(addressableFields([f({ name: "title" })]))).toEqual([
      "title",
    ]);
  });

  it("flattens an unnamed group into the level it sits in", () => {
    // A group with no name exists to lay fields out: its children are stored
    // at the enclosing level, not under it.
    const fields = [
      f({ name: "title" }),
      f({ fields: [f({ name: "hero" }), f({ name: "body" })] }),
      f({ name: "slug" }),
    ];
    expect(namesOf(addressableFields(fields))).toEqual([
      "title",
      "hero",
      "body",
      "slug",
    ]);
  });

  it("flattens a group nested inside another group", () => {
    const fields = [f({ fields: [f({ fields: [f({ name: "deep" })] })] })];
    expect(namesOf(addressableFields(fields))).toEqual(["deep"]);
  });

  it("does NOT descend into a NAMED group", () => {
    // A named group stores its children under itself, so its children are not
    // addressable at this level. This is the distinction the whole walk exists
    // to make, and reversing it would silently change what every call site
    // looks up.
    const fields = [f({ name: "meta", fields: [f({ name: "inner" })] })];
    expect(namesOf(addressableFields(fields))).toEqual(["meta"]);
  });

  it("treats an empty name as unnamed", () => {
    const fields = [f({ name: "", fields: [f({ name: "inner" })] })];
    expect(namesOf(addressableFields(fields))).toEqual(["inner"]);
  });

  it("drops an unnamed field with no children", () => {
    expect(addressableFields([f({ type: "ui" })])).toEqual([]);
  });

  it("returns the field objects themselves, not copies", () => {
    // Call sites read `type`, `relationTo` and component slugs off these, so
    // identity matters more than shape.
    const inner = f({ name: "hero" });
    expect(addressableFields([f({ fields: [inner] })])[0]).toBe(inner);
  });

  it("returns an empty list for an empty input", () => {
    expect(addressableFields([])).toEqual([]);
  });
});

describe("addressableFields - input an author can actually write", () => {
  it("terminates on a group that contains itself", () => {
    // Reproduced against the previous implementation as
    // `RangeError: Maximum call stack size exceeded`. It runs in a
    // post-commit hook, where a throw reports a failed save for one that
    // succeeded — the user sees an error and their work is already on disk.
    const group: Record<string, unknown> = { fields: [] };
    (group.fields as unknown[]).push(group);

    expect(addressableFields([f(group)])).toEqual([]);
  });

  it("terminates on a cycle through two groups, and still reports the fields it passed", () => {
    const a: Record<string, unknown> = { fields: [] };
    const b: Record<string, unknown> = { fields: [] };
    (a.fields as unknown[]).push(f({ name: "seen" }), b);
    (b.fields as unknown[]).push(a);

    expect(namesOf(addressableFields([f(a)]))).toEqual(["seen"]);
  });

  it("walks a group far wider than the argument limit", () => {
    // The previous implementation spread the recursive result into `push`,
    // which throws past the engine's argument limit — measured here at
    // ~110,000 on node 22. The size below is comfortably past any plausible
    // limit; it deliberately does NOT assert where the limit is, because that
    // is a property of the day's V8 rather than of this code.
    const wide = Array.from({ length: 200_000 }, (_, i) =>
      f({ name: `field_${i}` })
    );
    const out = addressableFields([f({ fields: wide })]);

    expect(out).toHaveLength(200_000);
    expect((out[199_999] as { name?: unknown }).name).toBe("field_199999");
  });

  it("survives a group nested far deeper than the call stack", () => {
    let deepest: Record<string, unknown> = { name: "bottom" };
    for (let i = 0; i < 100_000; i++) deepest = { fields: [deepest] };

    expect(namesOf(addressableFields([f(deepest)]))).toEqual(["bottom"]);
  });

  it("ignores entries that are not objects", () => {
    // Config is author-supplied and reaches this before validation on some
    // paths, so a null or a string must not throw.
    expect(
      namesOf(
        addressableFields([null, "title", 7, undefined, f({ name: "real" })])
      )
    ).toEqual(["real"]);
  });

  it("ignores a `fields` that is not an array", () => {
    expect(addressableFields([f({ fields: "nope" })])).toEqual([]);
  });

  it("returns empty when handed something that is not a list at all", () => {
    expect(addressableFields(undefined)).toEqual([]);
    expect(addressableFields(null)).toEqual([]);
    expect(addressableFields("fields")).toEqual([]);
  });
});
