/**
 * The DDL that creates an index and the desired schema the diff compares a table against have to
 * name it identically. When they disagreed, every diff reported the installed index as
 * unexpected and the declared one as missing, and a reconcile replaced an index with an
 * identical index for as long as anyone kept running it.
 */
import { describe, expect, it } from "vitest";

import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { collectionIndexSpecs } from "../../pipeline/diff/build-from-fields";
import { indexNameForColumn, MAX_INDEX_NAME_LENGTH } from "../index-name";

const LONG_TABLE = `dc_${"a".repeat(50)}`;
const LONG_COLUMN = "b".repeat(50);

describe("indexNameForColumn", () => {
  it("leaves a name the databases can store unchanged", () => {
    expect(indexNameForColumn("dc_posts", "author")).toBe(
      "idx_dc_posts_author"
    );
  });

  it("bounds a long name at postgres' truncation point, not mysql's refusal point", () => {
    // MySQL refuses over 64; PostgreSQL accepts 64 and silently truncates to 63, so 64 is not a
    // name PostgreSQL keeps and two names differing only in the last character become one.
    //
    // Asserted against the literal 63 rather than the constant: reading the constant here would
    // make the test agree with whatever the constant says, including a value no database
    // accepts.
    expect(
      indexNameForColumn(LONG_TABLE, LONG_COLUMN).length
    ).toBeLessThanOrEqual(63);
    expect(MAX_INDEX_NAME_LENGTH).toBe(63);
  });

  it("keeps two long names apart that truncation alone would merge", () => {
    const a = indexNameForColumn(LONG_TABLE, `${"c".repeat(45)}alpha`);
    const b = indexNameForColumn(LONG_TABLE, `${"c".repeat(45)}omega`);
    expect(a).not.toBe(b);
  });

  it("answers the same for the same input, since the drop builds the name again", () => {
    expect(indexNameForColumn(LONG_TABLE, LONG_COLUMN)).toBe(
      indexNameForColumn(LONG_TABLE, LONG_COLUMN)
    );
  });
});

describe("the emitted DDL and the desired schema agree", () => {
  it("names a long index identically on both sides", () => {
    const fields = [
      { name: LONG_COLUMN, type: "number", required: false, index: true },
    ];

    const emitted = new DynamicCollectionSchemaService(undefined, "postgresql")
      .generateMigrationSQL(LONG_TABLE, fields as never)
      .match(/CREATE INDEX (?:IF NOT EXISTS )?"([^"]+)"/g)
      ?.map(m => m.replace(/.*"([^"]+)"$/, "$1"));

    const declared = collectionIndexSpecs(LONG_TABLE, fields as never, {
      hasSlugColumn: false,
      hasCreatedAtColumn: false,
      hasCreatedByColumn: false,
      localizedNames: new Set<string>(),
      columnNameFor: field => field.name,
    }).map(spec => spec.name);

    // Every index the desired schema declares must be one the DDL actually installs, or the
    // diff proposes creating something that is already there under another name.
    for (const name of declared) {
      expect(emitted).toContain(name);
    }
  });
});
