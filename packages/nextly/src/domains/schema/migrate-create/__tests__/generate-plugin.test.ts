/**
 * `migrate:create --plugin`: the module generator.
 *
 * The separating assertion throughout is that each dialect's SQL EQUALS what
 * the shared diff-and-render core produces for the same `TableSpec`s —
 * recomputed here from the same primitives the app path uses — so a second,
 * drifting SQL implementation cannot pass by producing plausible strings.
 */
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { migrationChecksum } from "../../migrate/plugin/plugin-migration";
import { diffSnapshots } from "../../pipeline/diff/diff";
import type { ColumnSpec, TableSpec } from "../../pipeline/diff/types";
import { generateSQL } from "../../pipeline/sql-templates/index";

import { buildInverseOperations } from "../down-generator";
import {
  buildPluginMigration,
  formatPluginMigrationsIndex,
  generatePluginMigration,
} from "../generate-plugin";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

function tableSpec(withScore: boolean): TableSpec {
  const columns: ColumnSpec[] = [
    { name: "id", type: "varchar(36)", nullable: false, primaryKey: true },
    { name: "label", type: "varchar(255)", nullable: false },
  ];
  if (withScore) {
    columns.push({ name: "score", type: "int", nullable: true });
  }
  return { name: "fx__notes", columns, indexes: [] };
}

function tablesByDialect(
  spec: TableSpec
): Record<SupportedDialect, TableSpec[]> {
  return { postgresql: [spec], mysql: [spec], sqlite: [spec] };
}

/** What the shared core renders for the same transition — the expectation. */
function sharedCoreRender(
  previous: TableSpec[],
  desired: TableSpec[],
  dialect: SupportedDialect
): { up: string[]; down: string[] } {
  const prev = { tables: previous };
  const operations = diffSnapshots(prev, { tables: desired });
  return {
    up: operations.map(op => generateSQL(op, dialect)),
    down: buildInverseOperations(operations, prev).map(op =>
      generateSQL(op, dialect)
    ),
  };
}

const FIRST = {
  pluginName: "fixture",
  schemaVersion: 1,
  name: "init",
  now: new Date("2026-09-23T10:45:00Z"),
  tablesByDialect: tablesByDialect(tableSpec(false)),
  existing: [],
};

describe("buildPluginMigration", () => {
  it("renders every dialect through the shared core on first generation", () => {
    const built = buildPluginMigration(FIRST);
    expect(built).not.toBeNull();

    for (const dialect of DIALECTS) {
      const expected = sharedCoreRender(
        [],
        FIRST.tablesByDialect[dialect],
        dialect
      );
      expect(built!.module.dialects[dialect]).toEqual(expected);
    }

    // A CREATE, on every dialect, not merely any SQL.
    for (const dialect of DIALECTS) {
      expect(built!.module.dialects[dialect].up[0]).toMatch(/CREATE TABLE/i);
    }

    // The checksum is over exactly the statements shipped.
    expect(built!.module.checksum).toBe(
      migrationChecksum(built!.module.dialects)
    );
    expect(built!.module.name).toBe("20260923_104500_000_init");
    expect(built!.module.schemaVersion).toBe(1);
    expect(built!.module.before.postgresql).toEqual({ tables: [] });
    expect(built!.module.snapshot.postgresql).toEqual({
      tables: FIRST.tablesByDialect.postgresql,
    });
  });

  it("an added column produces an ADD whose DOWN drops it", () => {
    const first = buildPluginMigration(FIRST)!.module;
    const second = buildPluginMigration({
      pluginName: "fixture",
      schemaVersion: 2,
      name: "add_score",
      now: new Date("2026-09-23T10:46:00Z"),
      tablesByDialect: tablesByDialect(tableSpec(true)),
      existing: [first],
    })!;

    for (const dialect of DIALECTS) {
      const expected = sharedCoreRender(
        first.snapshot[dialect].tables,
        second.module.snapshot[dialect].tables,
        dialect
      );
      expect(second.module.dialects[dialect]).toEqual(expected);
      expect(second.module.dialects[dialect].up.join("\n")).toMatch(/score/i);
      expect(second.module.dialects[dialect].down.join("\n")).toMatch(/score/i);
    }
    expect(second.module.before.postgresql).toEqual(first.snapshot.postgresql);
  });

  it("returns null when nothing changed (the exit-2 contract)", () => {
    const first = buildPluginMigration(FIRST)!.module;
    const again = buildPluginMigration({
      ...FIRST,
      schemaVersion: 2,
      existing: [first],
    });
    expect(again).toBeNull();
  });

  it("refuses an un-bumped schemaVersion", () => {
    const first = buildPluginMigration(FIRST)!.module;
    expect(() => buildPluginMigration({ ...FIRST, existing: [first] })).toThrow(
      /schemaVersion/i
    );
    expect(() => buildPluginMigration({ ...FIRST, existing: [first] })).toThrow(
      /must move past 1 .*\(it is 1\)/
    );
  });

  it("moves the checksum when the SQL moves", () => {
    const first = buildPluginMigration(FIRST)!.module;
    const second = buildPluginMigration({
      pluginName: "fixture",
      schemaVersion: 2,
      name: "add_score",
      now: new Date("2026-09-23T10:46:00Z"),
      tablesByDialect: tablesByDialect(tableSpec(true)),
      existing: [first],
    })!.module;
    expect(second.checksum).not.toBe(first.checksum);
  });
});

describe("formatPluginMigrationsIndex", () => {
  it("orders by module name regardless of insertion order", () => {
    const a = buildPluginMigration(FIRST)!.module;
    const b = buildPluginMigration({
      pluginName: "fixture",
      schemaVersion: 2,
      name: "zz_last",
      now: new Date("2026-09-23T10:47:00Z"),
      tablesByDialect: tablesByDialect(tableSpec(true)),
      existing: [a],
    })!.module;
    const index = formatPluginMigrationsIndex([b, a]);
    const aPos = index.indexOf(a.name);
    const bPos = index.indexOf(b.name);
    expect(aPos).toBeGreaterThan(-1);
    expect(bPos).toBeGreaterThan(-1);
    expect(aPos).toBeLessThan(bPos);
    expect(index).toContain("export const migrations = [");
  });
});

describe("generatePluginMigration (file writes)", () => {
  it("writes the module and the rewritten barrel", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nextly-plugin-migrations-"));

    const first = await generatePluginMigration({
      ...FIRST,
      migrationsDir: dir,
    });
    expect(first).not.toBeNull();

    const files = await readdir(dir);
    expect(files).toContain(`${first!.moduleName}.ts`);
    expect(files).toContain("index.ts");

    const moduleContent = await readFile(first!.modulePath, "utf-8");
    expect(moduleContent).toContain("satisfies PluginMigration");
    expect(moduleContent).toContain('"schemaVersion": 1');

    const firstModule = buildPluginMigration(FIRST)!.module;
    const second = await generatePluginMigration({
      pluginName: "fixture",
      schemaVersion: 2,
      name: "add_score",
      now: new Date("2026-09-23T10:46:00Z"),
      tablesByDialect: tablesByDialect(tableSpec(true)),
      existing: [firstModule],
      migrationsDir: dir,
    });
    expect(second).not.toBeNull();

    const indexContent = await readFile(second!.indexPath, "utf-8");
    expect(indexContent).toContain(`./${first!.moduleName}`);
    expect(indexContent).toContain(`./${second!.moduleName}`);
    // Name order, not generation order — but both modules share the ordering
    // rule, so first (< second by timestamp) must be imported first.
    expect(indexContent.indexOf(`./${first!.moduleName}`)).toBeLessThan(
      indexContent.indexOf(`./${second!.moduleName}`)
    );
  });

  it("writes nothing when there is no change", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nextly-plugin-migrations-"));
    const firstModule = buildPluginMigration(FIRST)!.module;
    const result = await generatePluginMigration({
      ...FIRST,
      schemaVersion: 2,
      existing: [firstModule],
      migrationsDir: dir,
    });
    expect(result).toBeNull();
    expect(await readdir(dir)).toEqual([]);
  });
});
