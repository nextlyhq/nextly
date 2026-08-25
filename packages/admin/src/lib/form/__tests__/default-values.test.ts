// What a form holds before anyone edits it.
//
// This replaced two copies — one per editor — that agreed on most field types
// and disagreed on six. The tests worth having are therefore one per resolved
// disagreement, so that reconciliation is recorded as behaviour rather than as
// a claim in a commit message, and so a future edit that quietly reverts one of
// them fails here.
import { describe, it, expect } from "vitest";

import { getDefaultValues } from "../default-values";

/** The field shapes are structural; the schema types are wider than this needs. */
const f = (o: Record<string, unknown>) => o as never;

describe("getDefaultValues — the reconciled divergences", () => {
  it("honours a chips field's declared default rather than forcing an empty list", () => {
    // The single editor discarded it, so a schema author's default silently did
    // not apply on one surface and did on the other.
    expect(
      getDefaultValues([
        f({ name: "tags", type: "chips", defaultValue: ["a"] }),
      ])
    ).toEqual({ tags: ["a"] });
  });

  it("still seeds an empty list for chips with no declared default", () => {
    expect(getDefaultValues([f({ name: "tags", type: "chips" })])).toEqual({
      tags: [],
    });
  });

  it("opens a code field empty rather than null", () => {
    // Left to the generic fallthrough it became null, which a text-like input
    // renders as the string "null" or as an uncontrolled field.
    expect(getDefaultValues([f({ name: "snippet", type: "code" })])).toEqual({
      snippet: "",
    });
  });

  it("reads a json field's declared default", () => {
    expect(
      getDefaultValues([
        f({ name: "meta", type: "json", defaultValue: { a: 1 } }),
      ])
    ).toEqual({ meta: { a: 1 } });
  });

  it("decides relationship multiplicity from hasMany alone", () => {
    // The other copy also read `multiple`. Nothing in this repository sets one
    // on a relationship or upload field, and both inputs read `hasMany`.
    expect(
      getDefaultValues([
        f({ name: "one", type: "relationship" }),
        f({ name: "many", type: "relationship", hasMany: true }),
      ])
    ).toEqual({ one: null, many: [] });
  });

  it("decides upload multiplicity the same way", () => {
    expect(
      getDefaultValues([
        f({ name: "file", type: "upload" }),
        f({ name: "files", type: "upload", hasMany: true }),
      ])
    ).toEqual({ file: null, files: [] });
  });

  it("seeds a single-value select as null, not an empty string", () => {
    // Both inputs render `value || ""`, so nothing looks different; null is
    // what the other absent-value cases use and what belongs in the database.
    expect(getDefaultValues([f({ name: "status", type: "select" })])).toEqual({
      status: null,
    });
  });

  it("seeds a hasMany select as a list, whatever shape the default came in", () => {
    expect(
      getDefaultValues([
        f({ name: "a", type: "select", hasMany: true }),
        f({ name: "b", type: "select", hasMany: true, defaultValue: "x" }),
        f({
          name: "c",
          type: "select",
          hasMany: true,
          defaultValue: ["x", "y"],
        }),
      ])
    ).toEqual({ a: [], b: ["x"], c: ["x", "y"] });
  });

  it("takes the first entry when a single select is given an array default", () => {
    expect(
      getDefaultValues([
        f({ name: "s", type: "select", defaultValue: ["x", "y"] }),
      ])
    ).toEqual({ s: "x" });
  });
});

describe("getDefaultValues — reading an existing document", () => {
  it("prefers the stored value over the declared default", () => {
    expect(
      getDefaultValues(
        [f({ name: "title", type: "text", defaultValue: "untitled" })],
        { title: "Real title" }
      )
    ).toEqual({ title: "Real title" });
  });

  it("falls back to the snake_case column when the API returns one", () => {
    expect(
      getDefaultValues([f({ name: "metaTitle", type: "text" })], {
        meta_title: "stored",
      })
    ).toEqual({ metaTitle: "stored" });
  });

  it("materialises a structural field stored as null", () => {
    // Its inputs materialise the shape as they register, so keeping the null
    // guarantees the form can never equal its defaults and the document reports
    // itself edited before anyone types.
    expect(
      getDefaultValues(
        [
          f({
            name: "seo",
            type: "component",
            componentFields: [
              { name: "metaTitle", type: "text" },
              { name: "metaDescription", type: "textarea" },
            ],
          }),
        ],
        { seo: null }
      )
    ).toEqual({ seo: { metaTitle: "", metaDescription: "" } });
  });

  it("keeps a null for a REPEATABLE component, which holds a list", () => {
    expect(
      getDefaultValues(
        [f({ name: "blocks", type: "component", repeatable: true })],
        { blocks: null }
      )
    ).toEqual({ blocks: null });
  });

  it("recurses into a group", () => {
    expect(
      getDefaultValues([
        f({
          name: "address",
          type: "group",
          fields: [
            { name: "city", type: "text" },
            { name: "postcode", type: "text" },
          ],
        }),
      ])
    ).toEqual({ address: { city: "", postcode: "" } });
  });

  it("skips a field with no name", () => {
    expect(getDefaultValues([f({ type: "row" })])).toEqual({});
  });
});

describe("getDefaultValues — multiplicity and declared values", () => {
  it("honours a declared default on a relationship or upload", () => {
    // These decided multiplicity from `hasMany` and discarded the declared
    // value entirely, so a required relationship with a configured default
    // opened as null and the untouched row failed validation.
    expect(
      getDefaultValues([
        f({ name: "category", type: "relationship", defaultValue: "cat-1" }),
        f({
          name: "tags",
          type: "relationship",
          hasMany: true,
          defaultValue: ["t-1", "t-2"],
        }),
        f({ name: "cover", type: "upload", defaultValue: "media-9" }),
      ])
    ).toEqual({
      category: "cat-1",
      tags: ["t-1", "t-2"],
      cover: "media-9",
    });
  });

  it("coerces a declared default toward the shape its own schema validates", () => {
    expect(
      getDefaultValues([
        // A list field declaring a scalar takes it as a one-item list...
        f({
          name: "authors",
          type: "relationship",
          hasMany: true,
          defaultValue: "u-1",
        }),
        // ...and a single field declaring a list takes its first entry.
        f({
          name: "owner",
          type: "relationship",
          defaultValue: ["u-2", "u-3"],
        }),
        // Absence is the empty list, tested rather than inferred from
        // truthiness, so an id of 0 survives.
        f({ name: "empty", type: "relationship", hasMany: true }),
        f({
          name: "zero",
          type: "relationship",
          hasMany: true,
          defaultValue: 0,
        }),
      ])
    ).toEqual({
      authors: ["u-1"],
      owner: "u-2",
      empty: [],
      zero: [0],
    });
  });

  it("honours a declared default on a repeater, seeding each row's unset fields", () => {
    // These synthesized [] and {} and discarded the declaration, so a nested
    // repeater with a declared initial row started empty and the untouched
    // outer row failed validation.
    expect(
      getDefaultValues([
        f({
          name: "links",
          type: "repeater",
          fields: [
            { name: "label", type: "text" },
            { name: "url", type: "text" },
          ],
          defaultValue: [{ label: "Home" }],
        }),
      ])
      // `url` is unset in the declared row, so it takes the schema's seed —
      // the same order the write path reaches by writing the declaration and
      // then filling each child that is absent.
    ).toEqual({ links: [{ label: "Home", url: "" }] });
  });

  it("lets a declared group value win per key and seeds the rest", () => {
    expect(
      getDefaultValues([
        f({
          name: "address",
          type: "group",
          fields: [
            { name: "city", type: "text" },
            { name: "country", type: "text" },
          ],
          defaultValue: { country: "NL" },
        }),
      ])
    ).toEqual({ address: { city: "", country: "NL" } });
  });

  it("still seeds an empty list for a repeater with no declared default", () => {
    // Rows are not invented: how many a new entry starts with is the schema
    // author's declaration, not something minRows fabricates.
    expect(
      getDefaultValues([
        f({ name: "links", type: "repeater", fields: [], minRows: 1 }),
      ])
    ).toEqual({ links: [] });
  });

  it("gives each seeded row a private copy of the declared default, nested values included", () => {
    // The declaration lives on the field config, which outlives every row
    // seeded from it. Handing it out directly would let an edit to one row
    // reach the config and every other row seeded from it.
    //
    // The value mutated here is NESTED on purpose: merging the declared row
    // already produces a fresh object at the top level, so a test that edits a
    // top-level key passes whether or not the value was copied and proves
    // nothing about the copy.
    const field = f({
      name: "links",
      type: "repeater",
      fields: [{ name: "label", type: "text" }],
      defaultValue: [{ label: "Home", meta: { icon: "house" } }],
    });

    const first = getDefaultValues([field]).links as {
      meta: { icon: string };
    }[];
    first[0].meta.icon = "edited";

    const second = getDefaultValues([field]).links as {
      meta: { icon: string };
    }[];
    expect(second[0].meta.icon).toBe("house");
    expect(
      (field as unknown as { defaultValue: { meta: { icon: string } }[] })
        .defaultValue[0].meta.icon
    ).toBe("house");
  });

  it("resolves a function default against the values seeded so far", () => {
    // The write path's `applyFieldDefaults` passes the document built so far,
    // so a sibling-dependent default must see the same thing here. Resolving
    // against an empty object seeds the branch the document does not take, and
    // the admin submits that value explicitly — so the server never recomputes
    // it and the divergence reaches the row.
    expect(
      getDefaultValues([
        f({ name: "isUrgent", type: "checkbox", defaultValue: true }),
        f({
          name: "shipping",
          type: "text",
          defaultValue: (data: Record<string, unknown>) =>
            data.isUrgent ? "express" : "standard",
        }),
      ])
    ).toEqual({ isUrgent: true, shipping: "express" });
  });

  it("cannot read a sibling's DECLARED default from earlier in the order, matching the write path", () => {
    // On a create form there is no document, so a default can only read what
    // earlier fields settled on. `shipping` is declared first and sees no
    // `isUrgent` yet, so it takes the absent branch.
    //
    // This is asserted rather than fixed BECAUSE the write path does the same:
    // `applyFieldDefaults` walks the fields in order over the body it was
    // handed, so on an empty body it reaches `"standard"` too. Seeding later
    // siblings' declared defaults here would make the admin submit `"express"`
    // where the server computes `"standard"` — a divergence, which is the whole
    // thing this helper exists to prevent.
    expect(
      getDefaultValues([
        f({
          name: "shipping",
          type: "text",
          defaultValue: (data: Record<string, unknown>) =>
            data.isUrgent ? "express" : "standard",
        }),
        f({ name: "isUrgent", type: "checkbox", defaultValue: true }),
      ])
    ).toEqual({ shipping: "standard", isUrgent: true });
  });

  it("resolves a row's functional default against that row's own values", () => {
    // The seed was computed once, before any row was seen, and reused for all
    // of them — so a child reading a sibling the row supplies read it as
    // absent. `fillRepeaterRows` copies each row and fills against the copy.
    expect(
      getDefaultValues([
        f({
          name: "orders",
          type: "repeater",
          fields: [
            { name: "isUrgent", type: "checkbox" },
            {
              name: "shipping",
              type: "text",
              defaultValue: (data: Record<string, unknown>) =>
                data.isUrgent ? "express" : "standard",
            },
          ],
          defaultValue: [{ isUrgent: true }, { isUrgent: false }],
        }),
      ])
    ).toEqual({
      orders: [
        { isUrgent: true, shipping: "express" },
        { isUrgent: false, shipping: "standard" },
      ],
    });
  });

  it("keeps a row key the schema does not name, such as the dynamic-zone discriminator", () => {
    // Seeding from the field list alone would drop `_componentType`, and the
    // row would no longer say which component it is.
    expect(
      getDefaultValues([
        f({
          name: "blocks",
          type: "component",
          repeatable: true,
          componentFields: [{ name: "heading", type: "text" }],
          defaultValue: [{ _componentType: "hero" }],
        }),
      ])
    ).toEqual({ blocks: [{ _componentType: "hero", heading: "" }] });
  });

  it("resolves a function default against the stored document when editing", () => {
    // The field was added to the schema after this entry was written, so it has
    // no stored value and takes its default — computed against the entry, which
    // is what the write path would have seen.
    expect(
      getDefaultValues(
        [
          f({
            name: "shipping",
            type: "text",
            defaultValue: (data: Record<string, unknown>) =>
              data.isUrgent ? "express" : "standard",
          }),
          f({ name: "isUrgent", type: "checkbox" }),
        ],
        { isUrgent: true }
      )
    ).toEqual({ shipping: "express", isUrgent: true });
  });
});
