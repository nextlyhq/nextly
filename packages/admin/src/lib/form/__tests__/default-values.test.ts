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
