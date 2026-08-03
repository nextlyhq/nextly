/**
 * 🔴 The core schema is a DESIRED shape, so a name in it that the database does
 * not have is an instruction to CREATE that table.
 *
 * On a database whose field-group registry has been renamed by the storage
 * migration, declaring the legacy name creates an empty second registry — and
 * every reader prefers the legacy spelling when it is present, so the site's
 * field groups become unreachable with no error raised anywhere. That is the
 * failure these cases exist to prevent, on the command an operator runs after
 * an upgrade.
 */
import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { MIGRATION_TARGET } from "../../domains/field-groups/migration/manifest";
import { getDialectTablesForPush } from "../../database/index";
import { getCoreSchema, getCoreTableNames } from "../index";
import { STORAGE_FORMAT } from "../storage-format";

const DIALECTS = ["postgresql", "mysql", "sqlite"] as const;

/** The physical name a Drizzle table object carries, which is what the kit emits. */
const sqlNameOf = (table: unknown): string =>
  getTableName(table as Parameters<typeof getTableName>[0]);

describe("the core schema names the registry the database actually holds", () => {
  describe.each(DIALECTS)("%s", dialect => {
    it("declares the legacy registry when no name is given", () => {
      const names = getCoreSchema(dialect).tables.map(table => table.name);

      expect(names).toContain(STORAGE_FORMAT.registryTable);
      expect(names).not.toContain(MIGRATION_TARGET.registryTable);
    });

    // The case the option exists for. Both halves matter: naming the migrated
    // registry is not enough on its own, because leaving the legacy one in the
    // desired shape is what emits the CREATE.
    it("declares only the migrated registry once one is resolved", () => {
      const names = getCoreSchema(dialect, {
        fieldGroupRegistryTable: MIGRATION_TARGET.registryTable,
      }).tables.map(table => table.name);

      expect(names).toContain(MIGRATION_TARGET.registryTable);
      expect(names).not.toContain(STORAGE_FORMAT.registryTable);
    });

    // The bundle the push CREATES from, which must move in step with the
    // desired shape above: a diff computed against one and applied from the
    // other creates the table the diff said was already there.
    //
    // Asserted on the Drizzle object's own SQL name, because that is the name
    // drizzle-kit emits. Checking only that the entry exists would pass with
    // the legacy object still in place, which is the whole failure.
    it("pushes the migrated registry under its own name", () => {
      const bundle = getDialectTablesForPush(dialect, {
        fieldGroupRegistryTable: MIGRATION_TARGET.registryTable,
      });

      expect(sqlNameOf(bundle.dynamicFieldGroups)).toBe(
        MIGRATION_TARGET.registryTable
      );
    });

    it("pushes the legacy registry by default", () => {
      const bundle = getDialectTablesForPush(dialect);

      expect(sqlNameOf(bundle.dynamicFieldGroups)).toBe(
        STORAGE_FORMAT.registryTable
      );
    });
  });

  // The table list is what the live side is introspected under. Asking about a
  // table that is not there and then diffing the answer against one that is
  // produces the same CREATE from the other direction.
  it("asks the database about the registry it will compare against", () => {
    expect(getCoreTableNames()).toContain(STORAGE_FORMAT.registryTable);

    const migrated = getCoreTableNames({
      fieldGroupRegistryTable: MIGRATION_TARGET.registryTable,
    });
    expect(migrated).toContain(MIGRATION_TARGET.registryTable);
    expect(migrated).not.toContain(STORAGE_FORMAT.registryTable);
  });
});

/**
 * 🔴 The push bundle is what drizzle-kit CREATES from, and on MySQL and SQLite
 * the whole bundle is handed over on every apply — scope reduction is
 * PostgreSQL-only. So a caller that cannot establish which registry a database
 * holds must be able to declare NEITHER: naming the wrong one creates it, and a
 * CREATE is additive so no safety net stops it, while an omission at worst lets
 * drizzle-kit propose a DROP that `filterUnsafeStatements` blocks and reports.
 */
describe("the push bundle when the registry cannot be established", () => {
  describe.each(DIALECTS)("%s", dialect => {
    it("declares the legacy registry by default", () => {
      expect(getDialectTablesForPush(dialect).dynamicFieldGroups).toBeDefined();
    });

    it("declares neither registry when given null", () => {
      const bundle = getDialectTablesForPush(dialect, {
        fieldGroupRegistryTable: null,
      });

      expect("dynamicFieldGroups" in bundle).toBe(false);
      // Every other system table is still declared — omitting the registry must
      // not cost drizzle-kit its view of the rest, or it pairs them with new
      // tables for rename detection and prompts on a non-TTY boot.
      expect(bundle.dynamicCollections).toBeDefined();
      expect(bundle.dynamicSingles).toBeDefined();
    });
  });
});
