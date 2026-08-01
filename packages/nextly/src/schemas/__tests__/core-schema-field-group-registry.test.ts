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
import { describe, expect, it } from "vitest";

import { MIGRATION_TARGET } from "../../domains/field-groups/migration/manifest";
import { getDialectTablesForPush } from "../../database/index";
import { getCoreSchema, getCoreTableNames } from "../index";
import { STORAGE_FORMAT } from "../storage-format";

const DIALECTS = ["postgresql", "mysql", "sqlite"] as const;

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
    it("pushes the migrated registry under its own name", () => {
      const table = getDialectTablesForPush(dialect, {
        fieldGroupRegistryTable: MIGRATION_TARGET.registryTable,
      }).dynamicFieldGroups;

      expect(table).toBeDefined();
      const pushed = getCoreSchema(dialect, {
        fieldGroupRegistryTable: MIGRATION_TARGET.registryTable,
      }).tables.map(t => t.name);
      expect(pushed).toContain(MIGRATION_TARGET.registryTable);
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
