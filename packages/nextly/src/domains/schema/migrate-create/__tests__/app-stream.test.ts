/**
 * The app's migration stream over extension schema.
 *
 * Two kinds of table ride it: the app's own `db.schema.extend` tables, whole,
 * and a plugin's table carrying an element the APP contributed — where only
 * that element is the app's to migrate. The second kind is where the stream
 * went wrong: a plugin table frozen in the app's snapshot went stale as the
 * plugin evolved, and the app's next migration re-added the plugin's columns.
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runChecks } from "../../../../cli/commands/migrate-check";
import { nothingToGenerate } from "../../../../cli/commands/migrate-create";
import { definePlugin } from "../../../../plugins/plugin-context";
import { clearActiveExtensionSchema } from "../../extension/active-schema";
import { getActiveExtensionSchema } from "../../extension/build-extension-schema";
import { col, defineTable } from "../../extension/dsl";
import { diffSnapshots } from "../../pipeline/diff/diff";
import {
  compileAppStreamTables,
  mergeContributions,
  narrowToContributions,
  NO_APP_STREAM_TABLES,
} from "../app-stream";
import { generateMigration } from "../generate";
import { loadLatestSnapshot } from "../snapshot-io";

const logger = { warn: () => {} };

/** The fixture plugin, at a given version of its own table. */
function plugin(extraColumn: boolean) {
  return definePlugin({
    name: "fx",
    version: "0.0.0",
    nextly: "*",
    contributes: {
      schema: {
        prefix: "fx",
        tables: [
          defineTable("notes", {
            id: col.id(),
            title: col.shortText(),
            ...(extraColumn ? { pinned: col.boolean({ default: false }) } : {}),
          }),
        ],
      },
    },
  });
}

/** An app hook contributing a hidden column and an index to the plugin's table. */
const contributesToPlugin = ({
  schema,
}: {
  schema: {
    extendTable(name: string, input: Record<string, unknown>): void;
  };
}) => {
  schema.extendTable("fx__notes", {
    columns: { appRef: col.shortText({ nullable: true }) },
    indexes: [{ columns: ["app_ref"], name: "idx_fx_notes_app_ref" }],
  });
};

/** An app hook declaring a table of the app's own. */
const declaresOwnTable = ({
  schema,
}: {
  schema: { addTable(definition: unknown): void };
}) => {
  schema.addTable(
    defineTable("app_audit", { id: col.id(), note: col.shortText() })
  );
};

function config(input: {
  pluginHasExtra?: boolean;
  extend?: unknown[];
}): Record<string, unknown> {
  return {
    plugins: [plugin(input.pluginHasExtra ?? false)],
    db: { schema: { extend: input.extend ?? [] } },
  };
}

async function generate(
  migrationsDir: string,
  cfg: Record<string, unknown>,
  name: string,
  now: Date
) {
  const appStream = await compileAppStreamTables({
    config: cfg as never,
    dialect: "postgresql",
    logger,
  });
  return generateMigration({
    name,
    dialect: "postgresql",
    migrationsDir,
    collections: [],
    singles: [],
    components: [],
    appStream,
    nonInteractive: true,
    now,
  });
}

let migrationsDir: string;

beforeEach(async () => {
  migrationsDir = await mkdtemp(join(tmpdir(), "nextly-app-stream-"));
});

afterEach(() => {
  clearActiveExtensionSchema();
});

describe("an element the app contributes to a plugin's table", () => {
  it("emits the ALTER, never a CREATE of the plugin's table", async () => {
    const result = await generate(
      migrationsDir,
      config({ extend: [contributesToPlugin] }),
      "contribute",
      new Date("2026-09-25T10:00:00.000Z")
    );

    const sql = await readFile(result!.sqlPath, "utf-8");
    const up = sql.split("-- DOWN")[0];
    expect(up).not.toMatch(/CREATE TABLE "fx__notes"/);
    expect(up).toMatch(/ALTER TABLE "fx__notes" ADD COLUMN "app_ref"/);
    expect(up).toMatch(/idx_fx_notes_app_ref/);
    // Only the app's elements: the plugin's own columns are its module's.
    expect(up).not.toMatch(/"title"/);
  });

  it("records which elements were the app's", async () => {
    await generate(
      migrationsDir,
      config({ extend: [contributesToPlugin] }),
      "contribute",
      new Date("2026-09-25T10:00:00.000Z")
    );
    const latest = await loadLatestSnapshot(join(migrationsDir, "meta"));
    expect(latest?.data.contributions).toEqual({
      fx__notes: {
        columns: ["app_ref"],
        indexes: ["idx_fx_notes_app_ref"],
        foreignKeys: [],
        checks: [],
      },
    });
  });

  it("emits nothing when only the PLUGIN's table has changed since", async () => {
    // The regression. The app's snapshot froze fx__notes as it was; the
    // plugin then added `pinned` through its own module. Diffing against the
    // frozen copy proposed ADD COLUMN "pinned" in the app's migration too,
    // and whichever of the two ran second failed on a column that existed.
    await generate(
      migrationsDir,
      config({ extend: [contributesToPlugin] }),
      "contribute",
      new Date("2026-09-25T10:00:00.000Z")
    );

    const second = await generate(
      migrationsDir,
      config({ pluginHasExtra: true, extend: [contributesToPlugin] }),
      "plugin_moved",
      new Date("2026-09-25T11:00:00.000Z")
    );
    expect(second).toBeNull();
  });

  it("drops only the app's elements when the app stops contributing", async () => {
    await generate(
      migrationsDir,
      config({ extend: [contributesToPlugin] }),
      "contribute",
      new Date("2026-09-25T10:00:00.000Z")
    );

    const result = await generate(
      migrationsDir,
      // The plugin moved as well, and that must not leak into the drop.
      config({ pluginHasExtra: true }),
      "withdraw",
      new Date("2026-09-25T11:00:00.000Z")
    );

    const sql = await readFile(result!.sqlPath, "utf-8");
    const up = sql.split("-- DOWN")[0];
    expect(up).toMatch(/DROP COLUMN "app_ref"/);
    expect(up).toMatch(/idx_fx_notes_app_ref/);
    expect(up).not.toMatch(/DROP TABLE/);
    expect(up).not.toMatch(/"pinned"/);

    // Nothing left to record: the plugin's table leaves the app's snapshot.
    const latest = await loadLatestSnapshot(join(migrationsDir, "meta"));
    expect(latest?.data.contributions).toBeUndefined();
    expect(latest?.data.snapshot.tables.map(table => table.name)).not.toContain(
      "fx__notes"
    );
  });

  it("is not reported as drift by migrate:check once generated", async () => {
    const cfg = config({ pluginHasExtra: true, extend: [contributesToPlugin] });
    await generate(
      migrationsDir,
      config({ extend: [contributesToPlugin] }),
      "contribute",
      new Date("2026-09-25T10:00:00.000Z")
    );

    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const errors: string[] = [];
    try {
      await runChecks({
        migrationsDir,
        desiredSnapshot: { tables: [] },
        appStream: await compileAppStreamTables({
          config: cfg as never,
          dialect: "postgresql",
          logger,
        }),
        logger: {
          error: (m: string) => errors.push(m),
          success: () => {},
          info: () => {},
          warn: () => {},
          debug: () => {},
        } as never,
      });
    } finally {
      exit.mockRestore();
    }
    expect(errors).toEqual([]);
  });

  it("does not publish the schema it compiles", async () => {
    // Compiling twice — once without the app's hooks — used to publish each in
    // turn, so the process could be left holding the baseline.
    await compileAppStreamTables({
      config: config({ extend: [contributesToPlugin] }) as never,
      dialect: "postgresql",
      logger,
    });
    expect(getActiveExtensionSchema("postgresql")).toBeNull();
  });
});

describe("a table the app declares itself", () => {
  it("is created by an app that declares nothing else", async () => {
    const result = await generate(
      migrationsDir,
      { db: { schema: { extend: [declaresOwnTable] } } },
      "own_table",
      new Date("2026-09-25T10:00:00.000Z")
    );
    const sql = await readFile(result!.sqlPath, "utf-8");
    expect(sql.split("-- DOWN")[0]).toMatch(/CREATE TABLE "app_audit"/);
  });

  it("is not reported as a DROP by migrate:check after it is generated", async () => {
    // The checker built its desired side from entities alone, so every table
    // an app declared was in the snapshot and absent from the check — a drop,
    // reported on every run.
    const cfg = { db: { schema: { extend: [declaresOwnTable] } } };
    await generate(
      migrationsDir,
      cfg,
      "own_table",
      new Date("2026-09-25T10:00:00.000Z")
    );

    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const errors: string[] = [];
    try {
      await runChecks({
        migrationsDir,
        desiredSnapshot: { tables: [] },
        appStream: await compileAppStreamTables({
          config: cfg as never,
          dialect: "postgresql",
          logger,
        }),
        logger: {
          error: (m: string) => errors.push(m),
          success: () => {},
          info: () => {},
          warn: () => {},
          debug: () => {},
        } as never,
      });
    } finally {
      exit.mockRestore();
    }
    expect(errors).toEqual([]);
  });
});

describe("migrate:create's nothing-to-do check", () => {
  it("still generates when the config is empty but the last snapshot is not", () => {
    // An app whose only schema was a contribution it has now withdrawn: the
    // config describes nothing, and the DROP COLUMN is still owed.
    expect(
      nothingToGenerate({
        entityCount: 0,
        appStream: NO_APP_STREAM_TABLES,
        recordedTableCount: 1,
      })
    ).toBe(false);
  });

  it("returns early only when both the config and the snapshot are empty", () => {
    expect(
      nothingToGenerate({
        entityCount: 0,
        appStream: NO_APP_STREAM_TABLES,
        recordedTableCount: 0,
      })
    ).toBe(true);
  });
});

describe("applying an app migration on a table a plugin has changed since", () => {
  /** The app's hook, plus an index on its column when `indexed`. */
  const contributes =
    (indexed: boolean) =>
    ({
      schema,
    }: {
      schema: {
        extendTable(name: string, input: Record<string, unknown>): void;
      };
    }) => {
      schema.extendTable("fx__notes", {
        columns: { appRef: col.shortText({ nullable: true }) },
        ...(indexed
          ? {
              indexes: [{ columns: ["app_ref"], name: "idx_fx_notes_app_ref" }],
            }
          : {}),
      });
    };

  it("runs the migration rather than refusing it as drift", async () => {
    // Migration 1: the app adds `app_ref`. Then the plugin's own module adds
    // `pinned`. Migration 2: the app indexes `app_ref`. At apply time the live
    // table has `pinned` — which neither snapshot of migration 2's pair
    // describes as the app's — so compared whole it matched neither side.
    await generate(
      migrationsDir,
      config({ extend: [contributes(false)] }),
      "contribute",
      new Date("2026-09-25T10:00:00.000Z")
    );
    const first = await loadLatestSnapshot(join(migrationsDir, "meta"));
    await generate(
      migrationsDir,
      config({ pluginHasExtra: true, extend: [contributes(true)] }),
      "index_it",
      new Date("2026-09-25T11:00:00.000Z")
    );
    const second = await loadLatestSnapshot(join(migrationsDir, "meta"));

    // Live: the plugin's `pinned` applied, migration 1 applied, no index yet.
    const target = second!.data.snapshot;
    const live = {
      tables: target.tables.map(table =>
        table.name === "fx__notes" ? { ...table, indexes: [] } : table
      ),
    };

    // The raw sides are the defect: live matches neither.
    expect(diffSnapshots(live, first!.data.snapshot).length).toBeGreaterThan(0);
    expect(diffSnapshots(live, target).length).toBeGreaterThan(0);

    const sides = narrowToContributions({
      before: first!.data.snapshot,
      target,
      live,
      contributions: mergeContributions(
        first!.data.contributions ?? {},
        second!.data.contributions ?? {}
      ),
    });
    // Live matches the baseline, so the file runs...
    expect(diffSnapshots(sides.live, sides.before)).toEqual([]);
    // ...and what it runs is the app's index, nothing of the plugin's.
    const ops = diffSnapshots(sides.before, sides.target);
    expect(ops.map(op => op.type)).toEqual(["add_index"]);
  });
});
