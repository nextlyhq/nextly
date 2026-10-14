/**
 * The migration modules commerce ships carry exactly the schema it declares.
 *
 * A production install gets commerce's tables only from these modules, never
 * from the development push, so a column declared without a regenerated
 * module would exist in every development database and in no production one.
 * This catches that before release, on every dialect, without a database.
 */
import { migrationChecksum } from "@nextlyhq/plugin-sdk/schema";
import { describe, expect, it } from "vitest";

import { migrations } from "./migrations";
import { COMMERCE_TABLES, SCHEMA_PREFIX, SCHEMA_VERSION } from "./tables";

const DIALECTS = ["postgresql", "mysql", "sqlite"] as const;

function newest() {
  const last = migrations.at(-1);
  if (!last) throw new Error("commerce ships no migration module");
  return last;
}

describe("commerce's migration modules", () => {
  it("create every table and column commerce declares, on every dialect", () => {
    const shipped = newest();
    for (const dialect of DIALECTS) {
      const tables = shipped.snapshot[dialect].tables;
      expect(tables.map(t => t.name).sort(), dialect).toEqual(
        COMMERCE_TABLES.map(t => `${SCHEMA_PREFIX}__${t.name}`).sort()
      );
      for (const declared of COMMERCE_TABLES) {
        const table = tables.find(
          t => t.name === `${SCHEMA_PREFIX}__${declared.name}`
        );
        expect(
          table?.columns.map(c => `${c.name}${c.nullable ? "?" : ""}`).sort(),
          `${dialect} ${declared.name}`
        ).toEqual(
          declared.columns.map(c => `${c.name}${c.nullable ? "?" : ""}`).sort()
        );
      }
    }
  });

  it("end at the schema version commerce declares, rising one module at a time", () => {
    expect(newest().schemaVersion).toBe(SCHEMA_VERSION);
    const versions = migrations.map(m => m.schemaVersion);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("are each sealed by their own checksum, so none was edited by hand", () => {
    for (const module of migrations) {
      const { checksum, ...content } = module;
      expect(migrationChecksum(content), module.name).toBe(checksum);
    }
  });
});
