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

/**
 * A column this plugin contributed to a table another owner declares.
 *
 * The module has to carry it. A plugin ships its own migrations so that
 * installing it does not require the app to regenerate — a contributed column
 * left out of them exists at boot and never reaches an installation that only
 * applies shipped modules.
 */
describe("elements contributed to another owner's table", () => {
  /** `dep__orders` as its own owner declares it. */
  const dependencyTable: TableSpec = {
    name: "dep__orders",
    columns: [
      { name: "id", type: "varchar(36)", nullable: false, primaryKey: true },
    ],
    indexes: [],
  };

  /** The same table once this plugin has added its column. */
  const withContribution: TableSpec = {
    ...dependencyTable,
    columns: [
      ...dependencyTable.columns,
      { name: "fx_ref", type: "varchar(255)", nullable: true },
    ],
  };

  const CONTRIBUTING = {
    ...FIRST,
    contributedByDialect: tablesByDialect(withContribution),
    contributedBaselineByDialect: tablesByDialect(dependencyTable),
  };

  it("emits ADD COLUMN, not CREATE TABLE, for the foreign table", () => {
    // The whole point of the baseline. Without it the diff sees the table
    // appearing from nothing and the module claims to create a table this
    // plugin does not own.
    const built = buildPluginMigration(CONTRIBUTING);

    const up = built!.module.dialects.postgresql.up.join("\n");
    expect(up).toMatch(/ALTER TABLE .*dep__orders.* ADD COLUMN/i);
    expect(up).not.toMatch(/CREATE TABLE .*dep__orders/i);
  });

  it("keeps the foreign table OUT of the snapshot the apply path owns from", () => {
    // `recordOwner` upserts ownership from `snapshot`. A dependency's table
    // listed there would hand this plugin the row naming its real owner, and
    // the drop guard would then let this plugin's DOWN drop it.
    const built = buildPluginMigration(CONTRIBUTING);

    expect(built!.module.snapshot.postgresql.tables.map(t => t.name)).toEqual([
      "fx__notes",
    ]);
    expect(
      built!.module.contributed?.postgresql.tables.map(t => t.name)
    ).toEqual(["dep__orders"]);
  });

  it("emits nothing for the foreign table on a regeneration that changed nothing", () => {
    // The previous module's `contributed` becomes the next one's baseline, so
    // a column already shipped is not shipped again. A fresh baseline every
    // time would re-emit the same ADD COLUMN forever.
    const first = buildPluginMigration(CONTRIBUTING)!;
    const second = buildPluginMigration({
      ...CONTRIBUTING,
      schemaVersion: 2,
      existing: [first.module],
    });

    expect(second).toBeNull();
  });

  it("ignores a column the DEPENDENCY added to its own table", () => {
    // The dependency migrates first and owns its own columns. Diffing against
    // the previous module's stored view made its new column look like this
    // plugin's addition, and the stored snapshots then matched neither live
    // table — the upgrade stopped as drift over a change that was not ours.
    const first = buildPluginMigration(CONTRIBUTING)!;

    // The dependency has since added `note` to its own table; our contribution
    // is unchanged.
    const dependencyGrew: TableSpec = {
      ...dependencyTable,
      columns: [
        ...dependencyTable.columns,
        { name: "note", type: "varchar(255)", nullable: true },
      ],
    };
    const second = buildPluginMigration({
      ...CONTRIBUTING,
      schemaVersion: 2,
      existing: [first.module],
      contributedBaselineByDialect: tablesByDialect(dependencyGrew),
      contributedByDialect: tablesByDialect({
        ...dependencyGrew,
        columns: [
          ...dependencyGrew.columns,
          { name: "fx_ref", type: "varchar(255)", nullable: true },
        ],
      }),
    });

    // Nothing of ours changed, so there is nothing to emit — and in
    // particular no ADD COLUMN for the dependency's own `note`.
    expect(second).toBeNull();
  });

  it("still emits the plugin's OWN table changes", () => {
    // The control: a module that reported nothing would satisfy the
    // regeneration test above while breaking the feature.
    const built = buildPluginMigration(CONTRIBUTING);
    const up = built!.module.dialects.postgresql.up.join("\n");
    expect(up).toMatch(/CREATE TABLE .*fx__notes/i);
  });
});
