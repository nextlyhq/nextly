/**
 * Which foreign keys a Schema Builder collection's desired table carries.
 *
 * The keys its live table holds, while their columns remain, and the key of a
 * relationship whose column this push adds; nothing for a code-first
 * collection. The live tables here are the table builder's own output with a
 * key set by hand, as introspection would report it.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { withBuilderForeignKeys } from "../builder-foreign-keys";
import { desiredCollectionTable } from "../desired-collection-table";
import type { ForeignKeySpec, TableSpec } from "../diff/types";
import type { DesiredCollection } from "../types";

const TABLE = "dc_posts";

const author = (options: Record<string, unknown>, required = false) => ({
  name: "author",
  type: "relationship",
  required,
  options: { target: "authors", relationType: "manyToOne", ...options },
});

function collection(
  fields: unknown[],
  builderOwned = true,
  recordedFields?: readonly string[]
): DesiredCollection {
  return {
    slug: "posts",
    tableName: TABLE,
    fields: fields as never,
    builderOwned,
    ...(recordedFields ? { recordedFields } : {}),
  };
}

/** The table as the database holds it: these fields, and these keys. */
function live(fields: unknown[], foreignKeys: ForeignKeySpec[]): TableSpec {
  return {
    ...desiredCollectionTable(collection(fields), "sqlite"),
    foreignKeys,
  };
}

const LIVE_KEY: ForeignKeySpec = {
  name: "fk_dc_posts_author",
  columns: ["author"],
  referencesTable: "dc_authors",
  referencesColumns: ["id"],
  onDelete: "set null",
  onUpdate: "no action",
};

function keysFor(desired: DesiredCollection, liveTable?: TableSpec) {
  return withBuilderForeignKeys(
    desiredCollectionTable(desired, "sqlite"),
    desired,
    liveTable,
    "sqlite"
  ).foreignKeys;
}

describe("withBuilderForeignKeys", () => {
  it("adds the key of a relationship whose column the push adds", () => {
    const desired = collection([
      { name: "title", type: "text" },
      author({ onDelete: "cascade" }),
    ]);
    expect(
      keysFor(desired, live([{ name: "title", type: "text" }], []))
    ).toEqual([{ ...LIVE_KEY, onDelete: "cascade" }]);
  });

  it("keeps the key a live relationship has, and adds none where it has none", () => {
    const fields = [{ name: "title", type: "text" }, author({})];
    expect(keysFor(collection(fields), live(fields, [LIVE_KEY]))).toEqual([
      LIVE_KEY,
    ]);
    // Added before keys were created this way: no key, and none planned.
    expect(keysFor(collection(fields), live(fields, []))).toEqual([]);
  });

  // MySQL commits each schema statement, so an apply that added a relationship's column can stop
  // before its key. The registry still records the fields from before, so the next apply sees a
  // field it adds over a column that is already there, and creates the key the first one did not.
  it("adds the key of a relationship this change adds whose column an earlier apply left without one", () => {
    const fields = [{ name: "title", type: "text" }, author({})];
    expect(
      keysFor(collection(fields, true, ["title"]), live(fields, []))
    ).toEqual([LIVE_KEY]);
  });

  it("leaves a recorded relationship without a key as it was", () => {
    const fields = [{ name: "title", type: "text" }, author({})];
    expect(
      keysFor(collection(fields, true, ["title", "author"]), live(fields, []))
    ).toEqual([]);
  });

  it("reads a legacy relationship without judging it", () => {
    // Required and nulled on delete: impossible to create, but stored by an
    // older save. Every later save of the collection visits it.
    const legacy = author({ onDelete: "set null" }, true);
    const fields = [{ name: "title", type: "text" }, legacy];
    expect(keysFor(collection(fields), live(fields, [LIVE_KEY]))).toEqual([
      LIVE_KEY,
    ]);
  });

  it("refuses to create a key the column cannot honour", () => {
    const desired = collection([
      { name: "title", type: "text" },
      author({ onDelete: "set null" }, true),
    ]);
    let refused: unknown;
    try {
      keysFor(desired, live([{ name: "title", type: "text" }], []));
    } catch (error) {
      refused = error;
    }
    expect(NextlyError.isValidation(refused)).toBe(true);
  });

  it("drops a key with the column it covers", () => {
    const before = [{ name: "title", type: "text" }, author({})];
    expect(
      keysFor(
        collection([{ name: "title", type: "text" }]),
        live(before, [LIVE_KEY])
      )
    ).toEqual([]);
  });

  it("leaves a code-first collection's table as it was", () => {
    const desired = collection([author({})], false);
    expect(keysFor(desired, live([author({})], [LIVE_KEY]))).toBeUndefined();
  });
});
