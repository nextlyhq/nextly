/**
 * Which columns the schema being applied makes unique, as the classifier asks it to decide whether
 * "fill with one value" can be offered: a field marked unique, or a single-column unique index on
 * the table, which a collection can declare without the field saying so.
 */
import { describe, expect, it } from "vitest";

import type { NextlySchemaSnapshot } from "../diff/types";
import type { DesiredSchema } from "../types";
import { uniqueColumnLookup } from "../unique-columns";

const desired: DesiredSchema = {
  collections: {
    users: {
      slug: "users",
      tableName: "dc_users",
      fields: [
        { name: "emailAddress", type: "email", unique: true },
        { name: "handle", type: "text" },
        { name: "bio", type: "text" },
      ] as never,
    },
  },
  singles: {},
  components: {},
};

const snapshot: NextlySchemaSnapshot = {
  tables: [
    {
      name: "dc_users",
      columns: [],
      indexes: [
        { name: "dc_users_handle_unique", columns: ["handle"], unique: true },
        { name: "dc_users_bio_idx", columns: ["bio"], unique: false },
        { name: "dc_users_pair", columns: ["handle", "bio"], unique: true },
      ],
    },
  ],
};

describe("uniqueColumnLookup", () => {
  const isUnique = uniqueColumnLookup(snapshot, desired);

  it("reads a field marked unique, by its column", () => {
    expect(isUnique("dc_users", "email_address")).toBe(true);
  });

  it("reads a single-column unique index the collection declares", () => {
    expect(isUnique("dc_users", "handle")).toBe(true);
  });

  it("does not read a plain index, or a unique index over several columns, as the column's", () => {
    expect(isUnique("dc_users", "bio")).toBe(false);
  });
});
