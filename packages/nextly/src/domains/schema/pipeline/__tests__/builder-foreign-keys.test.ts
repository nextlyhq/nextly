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
import { builderKeyTables } from "../../../dynamic-collections/services/collection-tables";
import {
  withBuilderForeignKeys,
  withoutKeysOnKeylessRenames,
} from "../builder-foreign-keys";
import { desiredCollectionTable } from "../desired-collection-table";
import type {
  ForeignKeySpec,
  NextlySchemaSnapshot,
  Operation,
  TableSpec,
} from "../diff/types";
import type { DesiredCollection } from "../types";

const TABLE = "dc_posts";

const author = (options: Record<string, unknown>, required = false) => ({
  name: "author",
  type: "relationship",
  required,
  options: { target: "authors", relationType: "manyToOne", ...options },
});

const TITLE = { name: "title", type: "text" };

/** `author` under another name, as a rename leaves it. */
const writer = (options: Record<string, unknown> = {}) => ({
  ...author(options),
  name: "writer",
});

function collection(
  fields: unknown[],
  builderOwned = true,
  recordedFields?: readonly unknown[]
): DesiredCollection {
  return {
    slug: "posts",
    tableName: TABLE,
    fields: fields as never,
    builderOwned,
    ...(recordedFields ? { recordedFields: recordedFields as never } : {}),
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
      keysFor(collection(fields, true, [TITLE]), live(fields, []))
    ).toEqual([LIVE_KEY]);
  });

  it("leaves a recorded relationship without a key as it was", () => {
    const fields = [{ name: "title", type: "text" }, author({})];
    expect(
      keysFor(collection(fields, true, [TITLE, author({})]), live(fields, []))
    ).toEqual([]);
  });

  // MySQL commits a rename on its own, so an apply can rename a relationship's column and stop
  // before the registry learns the new name. The next apply has no rename to answer: the registry
  // records the old name, the change has the new one, and its column is already in place.
  it("plans no key on a relationship an earlier apply renamed", () => {
    expect(
      keysFor(
        collection([TITLE, writer()], true, [TITLE, author({})]),
        live([TITLE, writer()], [])
      )
    ).toEqual([]);
  });

  it("keys a relationship the change adds while a recorded one to another table is gone", () => {
    expect(
      keysFor(
        collection([TITLE, writer()], true, [
          TITLE,
          author({ target: "editors" }),
        ]),
        live([TITLE, writer()], [])
      )
    ).toEqual([expect.objectContaining({ columns: ["writer"] })]);
  });

  it("keys a relationship the change adds while the recorded one keeps its column", () => {
    expect(
      keysFor(
        collection([TITLE, writer()], true, [TITLE, author({})]),
        live([TITLE, author({}), writer()], [])
      )
    ).toEqual([expect.objectContaining({ columns: ["writer"] })]);
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

describe("withoutKeysOnKeylessRenames", () => {
  const key = (column: string): ForeignKeySpec => ({
    name: `fk_dc_posts_${column}`,
    columns: [column],
    referencesTable: "dc_authors",
    referencesColumns: ["id"],
    onDelete: "set null",
    onUpdate: "no action",
  });
  const table = (keys: ForeignKeySpec[]): TableSpec => ({
    name: TABLE,
    columns: [],
    foreignKeys: keys,
  });
  const snapshot = (keys: ForeignKeySpec[]): NextlySchemaSnapshot => ({
    tables: [table(keys)],
  });
  const renamed: Operation = {
    type: "rename_column",
    tableName: TABLE,
    fromColumn: "author",
    toColumn: "writer",
    fromType: "text",
    toType: "text",
  };
  const added: Operation = {
    type: "add_foreign_key",
    tableName: TABLE,
    foreignKey: key("writer"),
  };

  it("takes back the key planned on a renamed column whose old column had none", () => {
    const planned = withoutKeysOnKeylessRenames(
      [renamed, added],
      snapshot([key("writer")]),
      snapshot([]),
      new Set([TABLE])
    );
    expect(planned.operations).toEqual([renamed]);
    expect(planned.desired.tables[0].foreignKeys).toEqual([]);
  });

  it("keeps the key when the old column had one", () => {
    const planned = withoutKeysOnKeylessRenames(
      [renamed, added],
      snapshot([key("writer")]),
      snapshot([key("author")]),
      new Set([TABLE])
    );
    expect(planned.operations).toEqual([renamed, added]);
    expect(planned.desired.tables[0].foreignKeys).toEqual([key("writer")]);
  });

  it("keeps a key a table the Builder does not own declares", () => {
    const planned = withoutKeysOnKeylessRenames(
      [renamed, added],
      snapshot([key("writer")]),
      snapshot([]),
      new Set()
    );
    expect(planned.operations).toEqual([renamed, added]);
    expect(planned.desired.tables[0].foreignKeys).toEqual([key("writer")]);
  });
});

/** The admin's relationship shape: its target named by `relationTo` alone. */
const adminAuthor = (relationTo: unknown = "authors", extra = {}) => ({
  name: "author",
  type: "relationship",
  relationTo,
  ...extra,
});

/** The registry's tables, read for a Builder collection's own keys, as the pipeline reads them. */
const TARGETS = builderKeyTables([
  ["authors", "dc_authors"],
  ["editors", "dc_editors"],
]);

function keysWithTargets(desired: DesiredCollection, liveTable?: TableSpec) {
  return withBuilderForeignKeys(
    desiredCollectionTable(desired, "sqlite"),
    desired,
    liveTable,
    "sqlite",
    TARGETS
  ).foreignKeys;
}

describe("withBuilderForeignKeys, for the admin's relationTo", () => {
  it("keys a relationTo relationship the push adds", () => {
    const fields = [TITLE, adminAuthor()];
    expect(keysWithTargets(collection(fields), live([TITLE], []))).toEqual([
      LIVE_KEY,
    ]);
  });

  it("keys none to a target the registry does not hold", () => {
    const fields = [TITLE, adminAuthor("users")];
    expect(keysWithTargets(collection(fields), live([TITLE], []))).toEqual([]);
  });

  it("plans no key for a relationTo relationship recorded before, whose column has none", () => {
    const fields = [TITLE, adminAuthor()];
    expect(
      keysWithTargets(collection(fields, true, fields), live(fields, []))
    ).toEqual([]);
  });
});

describe("withBuilderForeignKeys refuses to leave a key checking the wrong thing", () => {
  const recorded = [TITLE, adminAuthor()];
  const keyed = live(recorded, [LIVE_KEY]);

  /** The refusal's code, or none. */
  function refusalOf(fields: unknown[], liveTable = keyed): string | null {
    try {
      keysWithTargets(collection(fields, true, recorded), liveTable);
      return null;
    } catch (error) {
      if (!NextlyError.is(error)) throw error;
      const errors = (error.publicData as { errors?: { code: string }[] })
        ?.errors;
      return errors?.[0]?.code ?? error.code;
    }
  }

  it("refuses pointing a keyed relationship at another collection", () => {
    expect(refusalOf([TITLE, adminAuthor("editors")])).toBe(
      "KEYED_RELATIONSHIP_CANNOT_CHANGE_TARGET"
    );
  });

  it("lets a keyed relationship switch to holding several entries, which converts it", () => {
    // The switch keeps each value as a one-item list, and the key goes with the conversion.
    expect(refusalOf([TITLE, adminAuthor("authors", { hasMany: true })])).toBe(
      null
    );
  });

  it("names the field in the message", () => {
    expect(() =>
      keysWithTargets(
        collection(
          [TITLE, adminAuthor("editors", { label: "Lead author" })],
          true,
          recorded
        ),
        keyed
      )
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              path: "fields.author",
              message: expect.stringContaining('"Lead author"'),
            }),
          ],
        },
      })
    );
  });

  it("lets a relationship whose column holds no key change freely", () => {
    expect(refusalOf([TITLE, adminAuthor("editors")], live(recorded, []))).toBe(
      null
    );
  });

  it("lets a keyed relationship keep its target while other things change", () => {
    expect(
      refusalOf([TITLE, adminAuthor("authors", { label: "Writer" })])
    ).toBe(null);
  });

  it("judges nothing when the save does not say what it records", () => {
    const fields = [TITLE, adminAuthor("editors")];
    expect(() => keysWithTargets(collection(fields), keyed)).not.toThrow();
  });
});

describe("withBuilderForeignKeys, for a kept key's actions", () => {
  const recorded = [TITLE, adminAuthor()];
  const keyed = live(recorded, [LIVE_KEY]);

  it("changes the actions a save changes, keeping the key's name and target", () => {
    // Made required, the relationship now restricts the delete of its author.
    expect(
      keysWithTargets(
        collection(
          [TITLE, adminAuthor("authors", { required: true })],
          true,
          recorded
        ),
        keyed
      )
    ).toEqual([{ ...LIVE_KEY, onDelete: "restrict" }]);
  });

  it("keeps the key as the table holds it when the save leaves the actions alone", () => {
    const heldElsewhere = live(recorded, [
      { ...LIVE_KEY, name: "fk_custom", onDelete: "cascade" },
    ]);
    expect(
      keysWithTargets(
        collection(
          [TITLE, adminAuthor("authors", { label: "Writer" })],
          true,
          recorded
        ),
        heldElsewhere
      )
    ).toEqual([{ ...LIVE_KEY, name: "fk_custom", onDelete: "cascade" }]);
  });
});
