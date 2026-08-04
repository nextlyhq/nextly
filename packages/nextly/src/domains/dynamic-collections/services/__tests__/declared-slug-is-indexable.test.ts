/**
 * A declared `slug` field gets a column the generated UNIQUE index can be built on.
 *
 * Every table this service creates carries a UNIQUE index on `slug`, and MySQL refuses to index a
 * `TEXT` column without a prefix length. So this column has to be bounded on MySQL whatever else is
 * true of the field, and the generator asks the canonical descriptor for it rather than using its
 * own type map, which renders `text`.
 *
 * That makes it a constraint of the column and not a statement about which builder created the
 * table: reading the width the way the creating service reads it renders `text`, MySQL rejects the
 * CREATE INDEX, and the table is never created at all — taking the localized companion and every
 * read that depends on it with it.
 *
 * The characterization snapshots cannot catch this. Their fixtures name the field `slugKey`, and
 * the canonical lookup fires only on a field whose column is literally `slug`, so that path is
 * never entered there and the `slug varchar(255)` those snapshots pin is the SYSTEM column.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../dynamic-collection-schema-service";

const declaredSlug = [
  { name: "slug", type: "text" },
] as unknown as FieldDefinition[];

const ddlFor = (dialect: "postgresql" | "mysql" | "sqlite"): string =>
  new DynamicCollectionSchemaService(undefined, dialect).generateMigrationSQL(
    "dc_pinned",
    declaredSlug,
    { hasStatus: false }
  );

describe("a declared slug field", () => {
  it("is bounded on MySQL, where the index needs it to be", () => {
    const sql = ddlFor("mysql");

    // The column and the index that requires it, asserted together: either alone would still pass
    // if the generator stopped emitting the other.
    expect(sql).toMatch(/`slug`\s+varchar\(\d+\)/i);
    expect(sql).toMatch(/CREATE UNIQUE INDEX .*`slug`/i);
    // The type MySQL cannot index. Named explicitly because it is what the service's own map
    // returns, so this is the value the column falls back to when the canonical lookup is skipped.
    expect(sql).not.toMatch(/`slug`\s+text/i);
  });

  // The other two dialects index a text column happily, so they keep `text` rather than being
  // pulled toward MySQL's constraint. Pinned so a fix for MySQL cannot widen every dialect's slug
  // column as a side effect.
  it("keeps the type the other dialects already index", () => {
    for (const dialect of ["postgresql", "sqlite"] as const) {
      const sql = ddlFor(dialect);
      expect(sql).toMatch(/"slug"\s+text/i);
      expect(sql).toMatch(/CREATE UNIQUE INDEX .*"slug"/i);
    }
  });
});
