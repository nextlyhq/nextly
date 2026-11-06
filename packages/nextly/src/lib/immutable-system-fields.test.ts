/**
 * Which keys of an update's data no update stores: the row strip's, less a
 * field the update keeps in a table of its own. Judged by own keys, so a key
 * spelt like an inherited property of an object is classified like any other.
 */
import { describe, expect, it } from "vitest";

import {
  keysNoUpdateStores,
  stripImmutableSystemFields,
} from "./immutable-system-fields";

/** A collection's fields: a column, a virtual field, a field group, a many-to-many. */
const FIELDS = [
  { name: "body", type: "json" },
  { name: "toString", type: "text", virtual: true },
  { name: "heroBlock", type: "component" },
  {
    name: "tags",
    type: "relationship",
    options: { relationType: "manyToMany" },
  },
];

describe("the keys no update stores", () => {
  it("names an immutable system column and a field stored nowhere, one spelt like an inherited property too", () => {
    const keys = keysNoUpdateStores(
      { body: {}, updatedAt: "2026-01-01", toString: 1 },
      "collection",
      "dc_cards",
      FIELDS
    );
    expect([...keys].sort()).toEqual(["toString", "updatedAt"]);
  });

  it("names another spelling of a field kept in its own table, which no write path takes out", () => {
    expect(
      keysNoUpdateStores(
        { body: {}, hero_block: { body: "hi" } },
        "collection",
        "dc_cards",
        FIELDS
      )
    ).toEqual(["hero_block"]);
  });

  it("leaves out a field group and a many-to-many, which the update stores in their own tables", () => {
    expect(
      keysNoUpdateStores(
        { body: {}, heroBlock: { body: "hi" }, tags: ["t1"] },
        "collection",
        "dc_cards",
        FIELDS
      )
    ).toEqual([]);
  });

  it("CONTROL: the row strip itself does take the field group and the many-to-many out", () => {
    expect(
      Object.keys(
        stripImmutableSystemFields(
          { body: {}, heroBlock: { body: "hi" }, tags: ["t1"] },
          "collection",
          "dc_cards",
          FIELDS
        )
      )
    ).toEqual(["body"]);
  });
});
