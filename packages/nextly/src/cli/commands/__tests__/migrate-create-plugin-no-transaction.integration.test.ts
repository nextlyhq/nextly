/**
 * `nextly migrate:create --plugin <entry> --blank --no-transaction`, end to
 * end: the command writes a module, the module is loaded the way the command
 * and a plugin's runtime load one, its author adds SQL, and the plugin phase
 * runs it outside a transaction on every configured dialect.
 *
 * A module that runs outside a transaction is one its author edits — its
 * statement is usually one the generator does not write, such as
 * `CREATE INDEX CONCURRENTLY` or `VACUUM` — so it is written sealed when it
 * loads, by `migrationChecksum` from `@nextlyhq/plugin-sdk/schema`. The
 * entry and the barrel are compiled by esbuild as the CLI's bundler compiles
 * them, every package import left external, and the SDK import resolves to
 * the built SDK through a project-local `node_modules`, as it does in a
 * plugin's own repository. Only the final `import()` is the test runner's:
 * the bundler's own is opaque to it.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { pathToFileURL } from "node:url";

import { Command } from "commander";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getSchemaEventsDdl } from "../../../domains/schema/events/schema-events-ddl";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { marksNoTransaction } from "../../../domains/schema/migrate/split-sql";
import {
  assertModuleIntact,
  type PluginMigration,
} from "../../../domains/schema/migrate/plugin/plugin-migration";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createContext } from "../../program";
import type { bundleAndRequire as BundleAndRequire } from "../../utils/config-bundler";
import { createLogger } from "../../utils/logger";
import { runPluginPhase } from "../migrate";
import {
  registerMigrateCreateCommand,
  runMigrateCreate,
} from "../migrate-create";

/**
 * The CLI's bundler with the test runner's `import()`: esbuild compiles the
 * file to an ES module beside it, every package import external, and the
 * module is imported from there so a package import resolves from the
 * project's own `node_modules`.
 */
const bundleAndRequire = vi.hoisted(
  () =>
    async function bundle(
      options: Parameters<typeof BundleAndRequire>[0]
    ): ReturnType<typeof BundleAndRequire> {
      const { build } = await import("esbuild");
      const outfile = `${options.filepath}.${Date.now()}.${Math.random()
        .toString(36)
        .slice(2)}.mjs`;
      await build({
        entryPoints: [options.filepath],
        bundle: true,
        platform: "node",
        format: "esm",
        packages: "external",
        outfile,
        logLevel: "silent",
      });
      const mod = (await import(
        /* @vite-ignore */ pathToFileURL(outfile).href
      )) as Record<string, unknown>;
      return { mod, dependencies: [] };
    }
);
vi.mock("../../utils/config-bundler", () => ({ bundleAndRequire }));

const PLUGIN = "@test/ntc";

/** The plugin's entry, declaring its tables through the SDK's DSL. */
function entry(schemaVersion: number, withTable: boolean): string {
  const tables = withTable
    ? `[defineTable("notes", { id: col.id(), label: col.shortText() })]`
    : "[]";
  return `import { col, defineTable } from "@nextlyhq/plugin-sdk/schema";\nexport default { name: "${PLUGIN}", version: "1.0.0", nextly: "*", schemaVersion: ${schemaVersion}, contributes: { schema: { prefix: "ntc", tables: ${tables} } } };\n`;
}

let project: string;
let migrationsDir: string;

/** The command, as `nextly migrate:create` runs it from the project root. */
async function create(
  options: Parameters<typeof runMigrateCreate>[1]
): Promise<void> {
  await runMigrateCreate(
    undefined,
    { plugin: "src/index.ts", cwd: project, ...options },
    createContext({ quiet: true })
  );
}

/** The plugin's modules, loaded through its barrel by the real bundler. */
async function shipped(): Promise<PluginMigration[]> {
  const { mod } = await bundleAndRequire({
    filepath: join(migrationsDir, "index.ts"),
    cwd: migrationsDir,
  });
  return (mod as { migrations: PluginMigration[] }).migrations;
}

/** Each dialect's statements, written into the module as its author would. */
const AUTHORED: Record<string, string[]> = {
  postgresql: ["INSERT INTO ntc_marks (id) VALUES ('ran')", "VACUUM ntc_marks"],
  mysql: ["INSERT INTO ntc_marks (id) VALUES ('ran')"],
  sqlite: ["INSERT INTO ntc_marks (id) VALUES ('ran')", "VACUUM"],
};

let blank: PluginMigration;
let edited: PluginMigration;

beforeAll(async () => {
  project = mkdtempSync(join(tmpdir(), "nextly-ntc-"));
  migrationsDir = join(project, "src", "migrations");
  mkdirSync(join(project, "src"), { recursive: true });
  mkdirSync(join(project, "node_modules", "@nextlyhq"), { recursive: true });
  symlinkSync(
    resolve(__dirname, "../../../../../plugin-sdk"),
    join(project, "node_modules", "@nextlyhq", "plugin-sdk"),
    "dir"
  );
  writeFileSync(join(project, "src", "index.ts"), entry(1, false), "utf8");

  await create({ blank: true, transaction: false, name: "backfill" });
  [blank] = await shipped();

  // The author's edit: the module's SQL, in place of its empty lists.
  const file = join(migrationsDir, `${blank.name}.ts`);
  let text = readFileSync(file, "utf8");
  for (const [dialect, statements] of Object.entries(AUTHORED)) {
    text = text.replace(
      new RegExp(`("${dialect}": \\{\\s*"up": )\\[\\]`),
      `$1${JSON.stringify(statements)}`
    );
  }
  writeFileSync(file, text, "utf8");
  [edited] = await shipped();
}, 120_000);

afterAll(() => {
  if (project) rmSync(project, { recursive: true, force: true });
});

describe("migrate:create --plugin --blank --no-transaction", () => {
  it("writes a module marked transaction: false that passes its own checksum", () => {
    expect(blank.transaction).toBe(false);
    expect(blank.dialects.postgresql).toEqual({ up: [], down: [] });
    expect(() => assertModuleIntact(PLUGIN, blank)).not.toThrow();
  });

  it("stays intact once its author adds SQL, sealed again when it loads", () => {
    expect(edited.dialects.sqlite.up).toEqual(AUTHORED.sqlite);
    expect(edited.checksum).not.toBe(blank.checksum);
    expect(() => assertModuleIntact(PLUGIN, edited)).not.toThrow();
  });

  it("leaves the next generated module diffing from the same schema", async () => {
    writeFileSync(join(project, "src", "index.ts"), entry(2, true), "utf8");
    await create({ name: "notes" });

    const modules = await shipped();
    expect(modules.map(m => m.name)).toEqual([
      edited.name,
      expect.stringMatching(/_notes$/) as unknown,
    ]);
    const notes = modules[1];
    expect(notes.transaction).toBeUndefined();
    expect(notes.before.sqlite.tables).toEqual([]);
    expect(notes.dialects.sqlite.up.join("\n")).toContain("ntc__notes");
    expect(() => assertModuleIntact(PLUGIN, notes)).not.toThrow();
    // The hand-sealed module is listed, and still loads intact.
    expect(() => assertModuleIntact(PLUGIN, modules[0])).not.toThrow();
  });
});

describe("migrate:create --no-transaction for the app's own files", () => {
  const env = { ...process.env };
  afterAll(() => {
    process.env.DATABASE_URL = env.DATABASE_URL;
    process.env.DB_DIALECT = env.DB_DIALECT;
    if (env.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
    if (env.DB_DIALECT === undefined) delete process.env.DB_DIALECT;
  });

  it("is an option of the command", () => {
    const program = new Command();
    registerMigrateCreateCommand(program);
    const command = program.commands.find(c => c.name() === "migrate:create");
    expect(command?.options.map(o => o.long)).toContain("--no-transaction");
  });

  it("writes a blank file whose first line is the marker", async () => {
    process.env.DATABASE_URL = `file:${join(project, "app.db")}`;
    process.env.DB_DIALECT = "sqlite";
    const appDir = mkdtempSync(join(tmpdir(), "nextly-ntc-app-"));
    try {
      await runMigrateCreate(
        undefined,
        { blank: true, transaction: false, name: "index_orders", cwd: appDir },
        createContext({ quiet: true })
      );
      const migrations = join(appDir, "src", "db", "migrations");
      const [file] = readdirSync(migrations).filter(f => f.endsWith(".sql"));
      const content = readFileSync(join(migrations, file), "utf8");
      expect(file).toMatch(/_index_orders\.sql$/);
      expect(marksNoTransaction(content)).toBe(true);
    } finally {
      rmSync(appDir, { recursive: true, force: true });
    }
  });

  it("refuses to mark a generated migration file", async () => {
    await expect(
      runMigrateCreate(
        "add_x",
        { transaction: false, cwd: project },
        createContext({ quiet: true })
      )
    ).rejects.toThrow(
      "Put the statements that need to run outside a transaction in a file of their own: nextly migrate:create --blank --no-transaction."
    );
  });
});

describe.each(getConfiguredTestDialects())(
  "the written module, run by nextly migrate (%s)",
  dialect => {
    let handle: TestNextly;

    beforeAll(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      if (!(await handle.adapter.tableExists("nextly_schema_events"))) {
        for (const statement of getSchemaEventsDdl(dialect)) {
          await handle.adapter.executeQuery(statement);
        }
      }
      await handle.adapter.executeQuery(
        "CREATE TABLE ntc_marks (id varchar(36) PRIMARY KEY)"
      );
    });

    afterAll(async () => {
      await handle?.adapter.executeQuery("DROP TABLE IF EXISTS ntc_marks");
      await handle?.destroy();
    });

    it("runs its statements outside a transaction and records it applied", async () => {
      await runPluginPhase({
        extensionSchema: undefined,
        dialect,
        db: handle.adapter.getDrizzle(),
        adapter: handle.adapter as unknown as Parameters<
          typeof runPluginPhase
        >[0]["adapter"],
        migrationsDir: "unused",
        logger: createLogger({ quiet: true }),
        pluginMigrationSets: [
          {
            pluginName: PLUGIN,
            pluginVersion: "1.0.0",
            migrations: [edited],
          },
        ],
      });

      expect(
        await handle.adapter.executeQuery("SELECT id FROM ntc_marks")
      ).toEqual([{ id: "ran" }]);
      const rows = await new SchemaEventsRepository(
        handle.adapter.getDrizzle(),
        dialect
      ).findFileApplies(`plugin:${PLUGIN}/${edited.name}`);
      expect(rows.map(row => row.status)).toEqual(["applied"]);
    });
  }
);
