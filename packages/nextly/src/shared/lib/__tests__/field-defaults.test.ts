/**
 * Which keys a declared default may fill, and which it must leave alone.
 *
 * Validation recurses into groups and repeater rows, so defaults have to reach
 * the same places or a required child fails on an entry the caller had no way
 * to satisfy.
 */
import { describe, expect, it } from "vitest";

import type { ValidatableField } from "../entry-validation";
import { applyFieldDefaults, fieldDefaultsSignature } from "../field-defaults";

const field = (f: Record<string, unknown>): ValidatableField =>
  f as unknown as ValidatableField;

describe("applyFieldDefaults", () => {
  it("fills an absent key and leaves a supplied one", () => {
    const data: Record<string, unknown> = { b: "given" };
    applyFieldDefaults(data, [
      field({ name: "a", type: "text", defaultValue: "da" }),
      field({ name: "b", type: "text", defaultValue: "db" }),
    ]);
    expect(data).toEqual({ a: "da", b: "given" });
  });

  it("treats falsy supplied values as supplied", () => {
    const data: Record<string, unknown> = { n: 0, c: false, s: "" };
    applyFieldDefaults(data, [
      field({ name: "n", type: "number", defaultValue: 9 }),
      field({ name: "c", type: "checkbox", defaultValue: true }),
      field({ name: "s", type: "text", defaultValue: "x" }),
    ]);
    expect(data).toEqual({ n: 0, c: false, s: "" });
  });

  it("leaves an explicit null alone", () => {
    const data: Record<string, unknown> = { a: null };
    applyFieldDefaults(data, [
      field({ name: "a", type: "text", defaultValue: "da" }),
    ]);
    expect(data.a).toBeNull();
  });

  it("treats an explicit undefined the same as an absent key", () => {
    // `{ a: undefined }` is what spreading an unset optional produces, and it
    // is indistinguishable from omission over JSON. `null` remains the way to
    // say "no value" — see the test above.
    const data: Record<string, unknown> = { a: undefined };
    applyFieldDefaults(data, [
      field({ name: "a", type: "text", defaultValue: "da" }),
    ]);
    expect(data.a).toBe("da");
  });

  it("skips a component field, whose data lives in another table", () => {
    const data: Record<string, unknown> = {};
    applyFieldDefaults(data, [
      field({ name: "hero", type: "component", defaultValue: { a: 1 } }),
    ]);
    expect(data).toEqual({});
  });

  it("skips a field-group field under the migrated spelling too", () => {
    // The storage migration renames the type token inside stored definitions,
    // so the skipped default must follow both spellings or it would target a
    // column that does not exist.
    const data: Record<string, unknown> = {};
    applyFieldDefaults(data, [
      field({ name: "hero", type: "fieldGroup", defaultValue: { a: 1 } }),
    ]);
    expect(data).toEqual({});
  });

  it("does not mistake an inherited property for a supplied value", () => {
    // A field named after something on Object.prototype would otherwise
    // resolve through the prototype chain, so an empty body would look as
    // though it supplied an inherited function.
    for (const name of ["constructor", "toString", "valueOf"]) {
      const data: Record<string, unknown> = {};
      applyFieldDefaults(data, [
        field({ name, type: "text", defaultValue: "filled" }),
      ]);
      expect(data[name], name).toBe("filled");
    }
  });

  it("still treats an own property set to undefined as absent", () => {
    const data: Record<string, unknown> = { toString: undefined };
    applyFieldDefaults(data, [
      field({ name: "toString", type: "text", defaultValue: "filled" }),
    ]);
    expect(data.toString).toBe("filled");
  });

  it("does not overwrite an inherited-name field the caller did supply", () => {
    const data: Record<string, unknown> = { constructor: "mine" };
    applyFieldDefaults(data, [
      field({ name: "constructor", type: "text", defaultValue: "filled" }),
    ]);
    expect(data.constructor).toBe("mine");
  });

  describe("structured defaults are private to each entry", () => {
    it("gives each repeater row its own copy", () => {
      // The declared value lives on the field definition, which outlives the
      // write, so a shared reference would let one row's later mutation reach
      // the others.
      const declared = { tags: ["a"] };
      const data: Record<string, unknown> = { rows: [{}, {}] };
      applyFieldDefaults(data, [
        field({
          name: "rows",
          type: "repeater",
          fields: [
            field({ name: "meta", type: "json", defaultValue: declared }),
          ],
        }),
      ]);
      const rows = data.rows as { meta: { tags: string[] } }[];
      expect(rows[0].meta).toEqual({ tags: ["a"] });
      expect(rows[0].meta).not.toBe(rows[1].meta);

      (rows[0].meta.tags as string[]).push("b");
      expect(rows[1].meta.tags).toEqual(["a"]);
    });

    it("never hands out the declared object itself", () => {
      // Mutating it would corrupt the definition for every later entry.
      const declared = { a: 1 };
      const data: Record<string, unknown> = {};
      applyFieldDefaults(data, [
        field({ name: "settings", type: "json", defaultValue: declared }),
      ]);
      expect(data.settings).toEqual({ a: 1 });
      expect(data.settings).not.toBe(declared);

      (data.settings as { a: number }).a = 99;
      expect(declared.a).toBe(1);
    });

    it("passes primitives through unchanged", () => {
      const data: Record<string, unknown> = {};
      applyFieldDefaults(data, [
        field({ name: "a", type: "text", defaultValue: "x" }),
        field({ name: "b", type: "number", defaultValue: 1 }),
      ]);
      expect(data).toEqual({ a: "x", b: 1 });
    });
  });

  describe("the caller's payload is never mutated", () => {
    it("does not write child defaults into a supplied group", () => {
      const supplied = { title: "given" };
      const data: Record<string, unknown> = { seo: supplied };
      applyFieldDefaults(data, [
        field({
          name: "seo",
          type: "group",
          fields: [
            field({ name: "title", type: "text", defaultValue: "dt" }),
            field({ name: "desc", type: "text", defaultValue: "dd" }),
          ],
        }),
      ]);
      expect(data.seo).toEqual({ title: "given", desc: "dd" });
      // The object the caller handed in is unchanged.
      expect(supplied).toEqual({ title: "given" });
      expect(data.seo).not.toBe(supplied);
    });

    it("does not write child defaults into supplied repeater rows", () => {
      const row = { label: "given" };
      const bare: Record<string, unknown> = {};
      const data: Record<string, unknown> = { rows: [row, bare] };
      applyFieldDefaults(data, [
        field({
          name: "rows",
          type: "repeater",
          fields: [
            field({ name: "label", type: "text", defaultValue: "dl" }),
            field({ name: "note", type: "text", defaultValue: "dn" }),
          ],
        }),
      ]);
      expect(data.rows).toEqual([
        { label: "given", note: "dn" },
        { label: "dl", note: "dn" },
      ]);
      expect(row).toEqual({ label: "given" });
      expect(bare).toEqual({});
    });

    it("reaches a nested group without mutating it", () => {
      const inner = {};
      const outer = { inner };
      const data: Record<string, unknown> = { outer };
      applyFieldDefaults(data, [
        field({
          name: "outer",
          type: "group",
          fields: [
            field({
              name: "inner",
              type: "group",
              fields: [
                field({ name: "deep", type: "text", defaultValue: "dv" }),
              ],
            }),
          ],
        }),
      ]);
      expect(data.outer).toEqual({ inner: { deep: "dv" } });
      expect(inner).toEqual({});
      expect(outer).toEqual({ inner: {} });
    });
  });

  describe("layout containers", () => {
    it("fills children of an unnamed container against the parent", () => {
      const data: Record<string, unknown> = {};
      applyFieldDefaults(data, [
        field({
          type: "row",
          fields: [field({ name: "a", type: "text", defaultValue: "da" })],
        }),
      ]);
      expect(data).toEqual({ a: "da" });
    });
  });

  describe("groups", () => {
    it("creates an absent group from its children's defaults", () => {
      const data: Record<string, unknown> = {};
      applyFieldDefaults(data, [
        field({
          name: "seo",
          type: "group",
          fields: [field({ name: "title", type: "text", defaultValue: "dt" })],
        }),
      ]);
      expect(data).toEqual({ seo: { title: "dt" } });
    });

    it("does not create a group whose children declare no defaults", () => {
      // Storing `{}` where the caller stored nothing is a different value.
      const data: Record<string, unknown> = {};
      applyFieldDefaults(data, [
        field({
          name: "seo",
          type: "group",
          fields: [field({ name: "title", type: "text" })],
        }),
      ]);
      expect(data).toEqual({});
    });

    it("fills only the missing keys of a supplied group", () => {
      const data: Record<string, unknown> = { seo: { title: "given" } };
      applyFieldDefaults(data, [
        field({
          name: "seo",
          type: "group",
          fields: [
            field({ name: "title", type: "text", defaultValue: "dt" }),
            field({ name: "desc", type: "text", defaultValue: "dd" }),
          ],
        }),
      ]);
      expect(data.seo).toEqual({ title: "given", desc: "dd" });
    });

    it("leaves a group the caller cleared to null", () => {
      const data: Record<string, unknown> = { seo: null };
      applyFieldDefaults(data, [
        field({
          name: "seo",
          type: "group",
          fields: [field({ name: "title", type: "text", defaultValue: "dt" })],
        }),
      ]);
      expect(data.seo).toBeNull();
    });

    it("prefers the group's own default over building one", () => {
      const data: Record<string, unknown> = {};
      applyFieldDefaults(data, [
        field({
          name: "seo",
          type: "group",
          defaultValue: { title: "own" },
          fields: [
            field({ name: "title", type: "text", defaultValue: "dt" }),
            field({ name: "desc", type: "text", defaultValue: "dd" }),
          ],
        }),
      ]);
      // The declared default wins for keys it sets; children still fill gaps.
      expect(data.seo).toEqual({ title: "own", desc: "dd" });
    });

    it("reaches a nested group", () => {
      const data: Record<string, unknown> = {};
      applyFieldDefaults(data, [
        field({
          name: "outer",
          type: "group",
          fields: [
            field({
              name: "inner",
              type: "group",
              fields: [
                field({ name: "deep", type: "text", defaultValue: "dv" }),
              ],
            }),
          ],
        }),
      ]);
      expect(data).toEqual({ outer: { inner: { deep: "dv" } } });
    });
  });

  describe("repeaters", () => {
    it("fills each supplied row", () => {
      const data: Record<string, unknown> = {
        rows: [{ label: "given" }, {}],
      };
      applyFieldDefaults(data, [
        field({
          name: "rows",
          type: "repeater",
          fields: [field({ name: "label", type: "text", defaultValue: "dl" })],
        }),
      ]);
      expect(data.rows).toEqual([{ label: "given" }, { label: "dl" }]);
    });

    it("never invents rows", () => {
      // How many rows a new entry starts with is the caller's decision.
      const data: Record<string, unknown> = {};
      applyFieldDefaults(data, [
        field({
          name: "rows",
          type: "repeater",
          fields: [field({ name: "label", type: "text", defaultValue: "dl" })],
        }),
      ]);
      expect(data.rows).toBeUndefined();
    });

    it("ignores malformed rows rather than throwing", () => {
      // A malformed row is validation's to report; this pass must not crash
      // on the way there.
      const data: Record<string, unknown> = { rows: [null, "x", [], {}] };
      expect(() =>
        applyFieldDefaults(data, [
          field({
            name: "rows",
            type: "repeater",
            fields: [
              field({ name: "label", type: "text", defaultValue: "dl" }),
            ],
          }),
        ])
      ).not.toThrow();
      expect(data.rows).toEqual([null, "x", [], { label: "dl" }]);
    });
  });
});

/**
 * The schema hash omits `defaultValue`, so code-first sync needs a separate
 * signal or a changed default never reaches the stored definitions the write
 * path reads.
 */
describe("fieldDefaultsSignature", () => {
  const withDefault = (v: unknown) => [
    field({ name: "a", type: "text", defaultValue: v }),
  ];

  it("changes when a default changes", () => {
    expect(fieldDefaultsSignature(withDefault("one"))).not.toBe(
      fieldDefaultsSignature(withDefault("two"))
    );
  });

  it("changes when a default is added or removed", () => {
    const none = [field({ name: "a", type: "text" })];
    expect(fieldDefaultsSignature(none)).not.toBe(
      fieldDefaultsSignature(withDefault("one"))
    );
  });

  it("is stable for identical declarations", () => {
    expect(fieldDefaultsSignature(withDefault({ a: [1, 2] }))).toBe(
      fieldDefaultsSignature(withDefault({ a: [1, 2] }))
    );
  });

  it("ignores fields that declare no default", () => {
    expect(
      fieldDefaultsSignature([
        field({ name: "a", type: "text" }),
        field({ name: "b", type: "text" }),
      ])
    ).toBe("");
  });

  it("treats a function the same on both sides of a comparison", () => {
    // The config holds a function; the stored definition lost it. Reporting a
    // change every boot would rewrite the registry on every start.
    const config = [
      field({ name: "a", type: "text", defaultValue: () => "x" }),
    ];
    const stored = [field({ name: "a", type: "text" })];
    expect(fieldDefaultsSignature(config)).toBe(fieldDefaultsSignature(stored));
  });

  it("sees a change inside a group", () => {
    const make = (v: string) => [
      field({
        name: "seo",
        type: "group",
        fields: [field({ name: "title", type: "text", defaultValue: v })],
      }),
    ];
    expect(fieldDefaultsSignature(make("a"))).not.toBe(
      fieldDefaultsSignature(make("b"))
    );
  });
});
