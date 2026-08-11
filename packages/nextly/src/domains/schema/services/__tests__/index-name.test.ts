/**
 * The DDL that creates an index and the desired schema the diff compares a table against have to
 * name it identically. When they disagreed, every diff reported the installed index as
 * unexpected and the declared one as missing, and a reconcile replaced an index with an
 * identical index for as long as anyone kept running it.
 */
import { describe, expect, it } from "vitest";

import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { collectionIndexSpecs } from "../../pipeline/diff/build-from-fields";
import {
  columnTypeIsIndexable,
  indexNameForColumn,
  MAX_INDEX_NAME_LENGTH,
  uniquenessCanBeAnIndex,
} from "../index-name";

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
      // PostgreSQL keys every type this fixture uses, so the answer is yes — stated rather than
      // defaulted, because the context requires it and a silent default would be the permissive
      // answer this rule exists to stop.
      uniquenessIsIndexable: () => true,
    }).map(spec => spec.name);

    // Every index the desired schema declares must be one the DDL actually installs, or the
    // diff proposes creating something that is already there under another name.
    for (const name of declared) {
      expect(emitted).toContain(name);
    }
  });
});

describe("columnTypeIsIndexable", () => {
  it("refuses a mysql json column, which mysql cannot index", () => {
    expect(columnTypeIsIndexable("json", "mysql")).toBe(false);
  });

  it("allows the same column where the dialect can index it", () => {
    expect(columnTypeIsIndexable("jsonb", "postgresql")).toBe(true);
    expect(columnTypeIsIndexable("text", "sqlite")).toBe(true);
  });

  it("allows every other mysql type", () => {
    expect(columnTypeIsIndexable("varchar(36)", "mysql")).toBe(true);
    expect(columnTypeIsIndexable("text", "mysql")).toBe(true);
  });
});

describe("the DDL and the desired schema agree on WHICH indexes exist", () => {
  it("neither declares nor writes an index for a mysql json column", () => {
    const fields = [
      { name: "payload", type: "json", required: false, index: true },
    ];

    const emitted = new DynamicCollectionSchemaService(
      undefined,
      "mysql"
    ).generateMigrationSQL("dc_probe", fields as never);

    const declared = collectionIndexSpecs("dc_probe", fields as never, {
      hasSlugColumn: false,
      hasCreatedAtColumn: false,
      hasCreatedByColumn: false,
      localizedNames: new Set<string>(),
      columnNameFor: field => field.name,
      columnIsIndexable: () => columnTypeIsIndexable("json", "mysql"),
      // Same column, the narrower question: MySQL cannot key a JSON column, so its uniqueness
      // cannot be a named index either.
      uniquenessIsIndexable: () => uniquenessCanBeAnIndex("json", "mysql"),
    }).map(spec => spec.name);

    // Declaring it while the generator skips it makes every reconcile emit a CREATE INDEX that
    // MySQL rejects — the same failure, once per attempt, forever.
    expect(emitted).not.toContain("idx_dc_probe_payload");
    expect(declared).not.toContain("idx_dc_probe_payload");
  });
});
