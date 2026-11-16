/**
 * What a Schema Builder save of a Single or a field group guarantees about the project it leaves,
 * beyond writing its migration: the commands that read the project find nothing left to do, a save
 * that cannot write its migration or its definition changes nothing, a save over a history the
 * commands would refuse is refused the same way, a save over a busy table changes nothing, and the
 * definition file holds what the registry holds. Known gaps are skipped where they stand.
 *
 * Each case runs for a Single and a field group, through the services every Builder entry point
 * reaches, on every configured dialect.
 */
import {
  chmodSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateCore } from "../../../../cli/commands/migrate";
import { runMigrateCheck } from "../../../../cli/commands/migrate-check";
import { runMigrateCreate } from "../../../../cli/commands/migrate-create";
import type { CommandContext } from "../../../../cli/program";
import { createLogger } from "../../../../cli/utils/logger";
import { defineConfig } from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { _resetEnvCache } from "../../../../shared/lib/env";
import { SingleRegistryService } from "../../../singles/services/single-registry-service";
import { readTableDefinition } from "../../__tests__/helpers/table-definition";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { setNonInteractive } from "../../migrate/can-prompt";
import { NO_CONSENT } from "../../migrate/data-loss-consent";

const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
// `cli/program` imports every command; the commands driven here are handed their context.
vi.mock("../../../../cli/program", () => ({
  createContext: () => ({ logger: createQuietLogger() }),
}));
// The commands load the project's configuration through this loader; here it is the one the
// instance was booted with.
vi.mock("../../../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../../cli/utils/config-loader")
  >()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

function createQuietLogger() {
  const none = () => {};
  return { debug: none, info: none, warn: none, error: none, success: none };
}

const MIGRATIONS = "./database/history";
const DEFINITION = "./schema/builder.json";
const PROJECT = defineConfig({
  collections: [],
  db: { migrationsDir: MIGRATIONS, uiSchemaFile: DEFINITION },
});

type Field = { name: string; type: string };
/** The registry row as stored: every column, so a refused save that moves any of them shows. */
type Row = { label?: unknown; fields?: unknown } | null;

/** One kind of entity a Builder save writes, and how its Builder saves it. */
interface Kind {
  name: string;
  slug: string;
  table: string;
  /** The definition file's list holding it. */
  listed: "singles" | "components";
  create(fields: Field[]): Promise<unknown>;
  change(
    t: TestNextly,
    fields: Field[],
    rename?: { from: string; to: string }
  ): Promise<unknown>;
  remove(): Promise<unknown>;
  /** The registry row, as stored, or null. */
  row(t: TestNextly): Promise<Row>;
  /** Store `value` in the `heading` field of one entry, as the entity's own writes store it. */
  seed(t: TestNextly, value: string): Promise<void>;
}

const renameResolutions = (
  table: string,
  rename: { from: string; to: string } | undefined
) =>
  rename === undefined
    ? {}
    : {
        renameResolutions: [
          {
            tableName: table,
            fromColumn: rename.from,
            toColumn: rename.to,
            choice: "rename",
          },
        ],
      };

/** A Single, saved through its Schema Builder dialog. */
const SINGLE: Kind = {
  name: "a Single",
  slug: "notice",
  table: "single_notice",
  listed: "singles",
  create: fields =>
    dispatchSingles(
      "createSingle",
      {},
      { slug: "notice", label: "Notice", fields }
    ),
  change: async (t, fields, rename) =>
    dispatchSingles(
      "applySingleSchemaChanges",
      { slug: "notice" },
      {
        fields,
        confirmed: true,
        // The version the Builder read, as its dialog sends it back.
        schemaVersion: (
          await t.getService("singleRegistryService").getSingle("notice")
        ).schemaVersion,
        ...renameResolutions("single_notice", rename),
      }
    ),
  remove: () => dispatchSingles("deleteSingle", { slug: "notice" }, undefined),
  row: t => t.getService("singleRegistryService").getSingleForWrite("notice"),
  seed: async (t, value) => {
    await t.nextly.updateSingle({
      slug: "notice",
      data: { heading: value, _overwrite: true },
    } as never);
  },
};

const KINDS: Kind[] = [
  SINGLE,
  {
    ...SINGLE,
    // The same Single, its schema changed through the API's settings save, which detects a rename
    // itself rather than being told of one.
    name: "a Single's settings save",
    change: (_t, fields) =>
      dispatchSingles("updateSingleSchema", { slug: "notice" }, { fields }),
  },
  {
    name: "a field group",
    slug: "meta",
    table: "comp_meta",
    listed: "components",
    create: fields =>
      dispatchComponents(
        "createComponent",
        {},
        { slug: "meta", label: "Meta", fields }
      ),
    change: async (t, fields, rename) =>
      dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "meta" },
        {
          fields,
          confirmed: true,
          schemaVersion: (
            await t.getService("fieldGroupRegistryService").getComponent("meta")
          ).schemaVersion,
          ...renameResolutions("comp_meta", rename),
        }
      ),
    remove: () =>
      dispatchComponents("deleteComponent", { slug: "meta" }, undefined),
    row: t =>
      t.getService("fieldGroupRegistryService").findComponentForWrite("meta"),
    // One instance of the group, placed in an entry of some parent, as a parent's save stores it.
    seed: async (t, value) => {
      await (
        t.adapter as unknown as { executeQuery(sql: string): Promise<unknown> }
      ).executeQuery(
        `INSERT INTO comp_meta (id, _parent_id, _parent_table, _parent_field, _order, heading) VALUES ('kept-1', 'parent-1', 'dc_parent', 'meta', 0, '${value}')`
      );
    },
  },
];

const text = (name: string): Field => ({ name, type: "text" });

// A read-only folder stops no write on Windows or as root, so a case relying on one cannot fail.
const MODES_NOT_ENFORCED =
  process.platform === "win32" || process.getuid?.() === 0;

let instance: TestNextly | undefined;
let basePath: string;
let holder: DrizzleAdapter | undefined;
const previousEnv = {
  dialect: process.env.DB_DIALECT,
  url: process.env.DATABASE_URL,
};

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-entity-save-"));
  // The Builder's save applies its change, and records it, in development.
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(async () => {
  // A folder a case made read-only is given back before it is removed.
  for (const dir of [
    join(basePath, "database", "history"),
    join(basePath, "schema"),
  ]) {
    if (existsSync(dir)) chmodSync(dir, 0o755);
  }
  await holder?.disconnect();
  holder = undefined;
  await instance?.destroy();
  instance = undefined;
  vi.unstubAllEnvs();
  for (const [key, value] of [
    ["DB_DIALECT", previousEnv.dialect],
    ["DATABASE_URL", previousEnv.url],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  _resetEnvCache();
  await rm(basePath, { recursive: true, force: true });
});

describe.each(getConfiguredTestDialects())(
  "a Builder save of a Single or a field group (%s)",
  dialect => {
    /** The instance, on SQLite over a file a second connection can open. */
    async function boot(): Promise<TestNextly> {
      const db = { migrationsDir: MIGRATIONS, uiSchemaFile: DEFINITION };
      if (dialect !== "sqlite") {
        instance = await createTestNextly({
          dialect: dialect as TestDialect,
          basePath,
          db,
        });
        return instance;
      }
      const url = `file:${join(basePath, "test.db")}`;
      process.env.DB_DIALECT = "sqlite";
      process.env.DATABASE_URL = url;
      _resetEnvCache();
      const adapter = await createAdapter({ type: "sqlite", url } as Parameters<
        typeof createAdapter
      >[0]);
      instance = await createTestNextly({ adapter, basePath, db });
      return instance;
    }

    const adapterOf = (t: TestNextly) => t.adapter as unknown as DrizzleAdapter;
    const migrationsDir = () => join(basePath, "database", "history");
    const migrationFiles = () =>
      existsSync(migrationsDir())
        ? readdirSync(migrationsDir())
            .filter(f => f.endsWith(".sql"))
            .sort()
        : [];
    const snapshotFiles = () =>
      existsSync(join(migrationsDir(), "meta"))
        ? readdirSync(join(migrationsDir(), "meta")).sort()
        : [];
    const definitionText = () => {
      const file = join(basePath, "schema", "builder.json");
      return existsSync(file) ? readFileSync(file, "utf-8") : undefined;
    };
    const defined = (kind: Kind) => {
      const parsed = JSON.parse(definitionText() ?? "{}") as Record<
        string,
        { slug: string; labels?: { singular?: string }; fields?: unknown }[]
      >;
      return (parsed[kind.listed] ?? []).find(each => each.slug === kind.slug);
    };
    async function columns(t: TestNextly, table: string): Promise<string[]> {
      const adapter = adapterOf(t) as unknown as {
        executeQuery<R>(sql: string): Promise<R[]>;
      };
      const read = await readTableDefinition(
        statement => adapter.executeQuery(statement),
        adapterOf(t).getCapabilities().dialect,
        table
      );
      return read.columns.map(c => c.name).sort();
    }
    function ledger(t: TestNextly) {
      return new SchemaEventsRepository(
        adapterOf(t).getDrizzle() as never,
        adapterOf(t).getCapabilities().dialect
      );
    }
    async function appliedFiles(t: TestNextly): Promise<string[]> {
      return (await ledger(t).listFileApplies())
        .filter(row => row.status === "applied")
        .map(row => String(row.filename))
        .sort();
    }
    /** Each file in `dir` by name, with its contents: a file rewritten in place shows too. */
    const contentsOf = (dir: string, names: readonly string[]) =>
      Object.fromEntries(
        names.map(name => [name, readFileSync(join(dir, name), "utf-8")])
      );
    /**
     * Everything a refused save must leave as it found it: every migration and snapshot with its
     * contents, the definition, every apply the ledger holds whatever its outcome, the table's
     * columns, and the whole registry row.
     */
    async function standing(t: TestNextly, kind: Kind) {
      return {
        files: contentsOf(migrationsDir(), migrationFiles()),
        snapshots: contentsOf(join(migrationsDir(), "meta"), snapshotFiles()),
        definition: definitionText(),
        ledger: (await ledger(t).listFileApplies())
          .map(row => JSON.stringify(row))
          .sort(),
        columns: await columns(t, kind.table),
        row: await kind.row(t),
      };
    }
    /** The values `column` holds, one for each stored row of `table`. */
    async function storedValue(
      t: TestNextly,
      table: string,
      column: string
    ): Promise<unknown> {
      const rows = await (
        adapterOf(t) as unknown as {
          executeQuery<R>(sql: string): Promise<R[]>;
        }
      ).executeQuery<{ value: unknown }>(
        `SELECT ${column} AS value FROM ${table}`
      );
      return rows.map(row => row.value);
    }

    /** Run a command over the project, as its CLI would; its exit code and what it said. */
    async function command(
      run: (context: CommandContext) => Promise<void>
    ): Promise<{ code: number | undefined; said: string[] }> {
      loaded.config = PROJECT;
      const restore = {
        dialect: process.env.DB_DIALECT,
        url: process.env.DATABASE_URL,
      };
      // Neither command connects: each needs only the dialect.
      process.env.DB_DIALECT = dialect;
      process.env.DATABASE_URL =
        dialect === "sqlite"
          ? `file:${join(basePath, "test.db")}`
          : dialect === "mysql"
            ? "mysql://unused:unused@localhost:1/unused"
            : "postgres://unused:unused@localhost:1/unused";
      _resetEnvCache();
      const said: string[] = [];
      const capture = (message: string) => {
        said.push(message);
      };
      const context = {
        logger: {
          ...createLogger({ quiet: true }),
          error: capture,
          info: capture,
          success: capture,
        },
        options: {},
        cwd: basePath,
      } as CommandContext;
      const printed = vi.spyOn(console, "error").mockImplementation(message => {
        said.push(String(message));
      });
      const exit = vi.spyOn(process, "exit").mockImplementation(code => {
        throw new Error(`exit ${String(code)}`);
      });
      try {
        await run(context);
        return { code: undefined, said };
      } catch (error) {
        const match = /^exit (\d+)$/.exec((error as Error).message);
        if (match) return { code: Number(match[1]), said };
        throw error;
      } finally {
        exit.mockRestore();
        printed.mockRestore();
        for (const [key, value] of [
          ["DB_DIALECT", restore.dialect],
          ["DATABASE_URL", restore.url],
        ] as const) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
        _resetEnvCache();
      }
    }

    /**
     * `nextly migrate` and `migrate:check` over the project as the save left it: each finds
     * nothing to do. `migrate` runs against the instance's database.
     */
    async function nothingLeftToDo(t: TestNextly): Promise<void> {
      const migrated = await migrateCore({
        extensionSchema: undefined,
        dialect: adapterOf(t).getCapabilities().dialect,
        db: adapterOf(t).getDrizzle(),
        adapter: adapterOf(t) as never,
        migrationsDir: migrationsDir(),
        logger: createLogger({ quiet: true }),
        lockMode: "fail-fast",
        consent: NO_CONSENT,
        interactive: false,
      } as never);
      expect(migrated).toMatchObject({ applied: 0, coreChanged: false });

      const checked = await command(context =>
        runMigrateCheck({ cwd: basePath }, context)
      );
      expect(checked.code, checked.said.join("\n")).toBeUndefined();
    }

    /** `migrate:create` over the project as the save left it writes no migration. */
    async function nothingLeftToCreate(): Promise<void> {
      const filesBefore = migrationFiles();
      const created = await command(context => {
        // As `--non-interactive` does: no rename is asked about.
        setNonInteractive(true);
        return runMigrateCreate("after", { cwd: basePath }, context).finally(
          () => setNonInteractive(false)
        );
      });
      expect(created.code, created.said.join("\n")).toBeUndefined();
      // A file written here is a change the save left unrecorded; its text says which.
      const written = migrationFiles().filter(f => !filesBefore.includes(f));
      expect(
        written,
        written
          .map(f => readFileSync(join(migrationsDir(), f), "utf-8"))
          .join("\n")
      ).toEqual([]);
    }

    describe("a Single's settings save whose registry row fails after its file applied", () => {
      it("throws an internal error, keeps the file recorded applied, and the same save again writes the row", async () => {
        const t = await boot();
        const kind = KINDS[1];
        await kind.create([text("heading")]);
        // The first registry write after the file is the settings save's own row.
        const failOnce = vi
          .spyOn(SingleRegistryService.prototype, "updateSingle")
          .mockRejectedValueOnce(new Error("the row write was refused"));

        await expect(
          kind.change(t, [text("heading"), text("body")])
        ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
        failOnce.mockRestore();
        // The file ran and is recorded applied; the row still describes the Single as it was.
        expect(await columns(t, kind.table)).toContain("body");
        expect(
          (await kind.row(t))?.fields?.map(
            field => (field as { name: string }).name
          )
        ).toEqual(["heading"]);

        // The same save again: nothing left for the table, and the row is written.
        await kind.change(t, [text("heading"), text("body")]);
        expect(
          (await kind.row(t))?.fields?.map(
            field => (field as { name: string }).name
          )
        ).toEqual(["heading", "body"]);
        await nothingLeftToDo(t);
      }, 60_000);
    });

    describe.each(KINDS)("$name", kind => {
      it("leaves nothing for migrate or migrate:check to do after its create, change and delete", async () => {
        const t = await boot();

        await kind.create([text("heading")]);
        await nothingLeftToDo(t);

        await kind.change(t, [text("heading"), text("body")]);
        await nothingLeftToDo(t);

        await kind.remove();
        // Its file recorded applied would pass both commands with the table still standing.
        expect(await adapterOf(t).tableExists(kind.table)).toBe(false);
        await nothingLeftToDo(t);
      }, 60_000);

      // Known gap: after any Builder save, migrate:create writes a permissions-only empty migration.
      it.skip("leaves nothing for migrate:create to write after its create, change and delete", async () => {
        const t = await boot();

        await kind.create([text("heading")]);
        await nothingLeftToCreate();

        await kind.change(t, [text("heading"), text("body")]);
        await nothingLeftToCreate();

        await kind.remove();
        await nothingLeftToCreate();
      }, 60_000);

      it("writes every file into db.migrationsDir, and nothing into the old dynamic folder", async () => {
        const t = await boot();

        await kind.create([text("heading")]);
        await kind.change(t, [text("heading"), text("body")]);
        await kind.remove();

        expect(
          migrationFiles().filter(f => f.includes(`_${kind.slug}_`))
        ).toHaveLength(3);
        expect(
          existsSync(join(basePath, "src", "db", "migrations", "dynamic"))
        ).toBe(false);
      });

      it("records its whole definition as the registry holds it, through a create, a change and a delete", async () => {
        const t = await boot();

        await kind.create([text("heading")]);
        const created = await kind.row(t);
        expect(defined(kind)?.fields).toEqual(created?.fields);
        expect(defined(kind)?.labels?.singular).toBe(created?.label);

        await kind.change(t, [text("heading"), text("body")]);
        const changed = await kind.row(t);
        expect(defined(kind)?.fields).toEqual(changed?.fields);

        await kind.remove();
        expect(await kind.row(t)).toBeNull();
        expect(defined(kind)).toBeUndefined();
      });

      it("renames a field as a rename, keeping its column's place in the history and its values", async () => {
        const t = await boot();
        await kind.create([text("heading")]);
        // A stored value: a rebuild that drops the column and adds the new one would lose it.
        await kind.seed(t, "kept");

        await kind.change(t, [text("headline")], {
          from: "heading",
          to: "headline",
        });

        const update = migrationFiles().find(f =>
          f.endsWith(`_${kind.slug}_update.sql`)
        );
        expect(update).toBeDefined();
        const up = readFileSync(join(migrationsDir(), update!), "utf-8").split(
          "-- DOWN"
        )[0]!;
        expect(up).toMatch(/RENAME COLUMN/i);
        expect(up).not.toMatch(/DROP COLUMN/i);
        const names = await columns(t, kind.table);
        expect(names).toContain("headline");
        expect(names).not.toContain("heading");
        expect(await storedValue(t, kind.table, "headline")).toEqual(["kept"]);
        expect(await appliedFiles(t), JSON.stringify(migrationFiles())).toEqual(
          migrationFiles()
        );
        await nothingLeftToDo(t);
      }, 60_000);

      // A Single's relationship to many entries keeps them in a junction table, which the save's
      // file makes with its keys, as the file runs in place of the push.
      it.runIf(kind.listed === "singles")(
        "adds a relationship to many entries, its junction table made by the file",
        async () => {
          const t = await boot();
          // Created as the Builder creates a collection.
          await dispatchCollections(
            {} as ServiceContainer,
            "createCollection",
            {},
            { name: "authors", label: "Author", fields: [text("name")] }
          );
          await kind.create([text("heading")]);
          const filesBefore = migrationFiles();

          await kind.change(t, [
            text("heading"),
            {
              name: "writers",
              type: "relationship",
              options: { relationType: "manyToMany", target: "authors" },
            } as Field,
          ]);

          const up = migrationFiles()
            .filter(f => !filesBefore.includes(f))
            .map(
              f =>
                readFileSync(join(migrationsDir(), f), "utf-8").split(
                  "-- DOWN"
                )[0]!
            )
            .join("\n");
          const junction =
            /CREATE TABLE (?:IF NOT EXISTS )?["`]?(\w+)["`]?/i.exec(up)?.[1];
          expect(junction, up).toBeDefined();
          expect(await adapterOf(t).tableExists(junction!)).toBe(true);
          // Every file recorded applied. The project-wide checks stay with the cases above: a
          // collection created through the Builder fails `migrate:check` on its own settings.
          expect(await appliedFiles(t)).toEqual(migrationFiles());
        },
        60_000
      );

      it.skipIf(MODES_NOT_ENFORCED)(
        "refuses a change while the migrations folder cannot be written, and changes nothing",
        async () => {
          const t = await boot();
          await kind.create([text("heading")]);
          const before = await standing(t, kind);

          chmodSync(migrationsDir(), 0o555);
          const refused = await kind
            .change(t, [text("heading"), text("body")])
            .then(
              () => undefined,
              (error: unknown) => error
            );
          chmodSync(migrationsDir(), 0o755);

          expect(refused).toBeInstanceOf(Error);
          expect(await standing(t, kind)).toEqual(before);
        }
      );

      it.skipIf(MODES_NOT_ENFORCED)(
        "refuses a change while the definition file cannot be written, and runs nothing",
        async () => {
          const t = await boot();
          await kind.create([text("heading")]);
          const before = await standing(t, kind);

          // The definition is replaced by a rename inside its folder, so the folder is what stops it.
          chmodSync(join(basePath, "schema"), 0o555);
          const refused = await kind
            .change(t, [text("heading"), text("body")])
            .then(
              () => undefined,
              (error: unknown) => error
            );
          chmodSync(join(basePath, "schema"), 0o755);

          expect(refused).toBeInstanceOf(Error);
          expect(await standing(t, kind)).toEqual(before);
        }
      );

      describe("over a history the migrate commands refuse", () => {
        const HISTORY_CASES: {
          what: string;
          make(t: TestNextly, applied: string): Promise<void>;
        }[] = [
          {
            what: "an applied file was edited",
            make: async (_t, applied) => {
              const file = join(migrationsDir(), applied);
              writeFileSync(
                file,
                `${readFileSync(file, "utf-8")}\n-- edited\n`
              );
            },
          },
          {
            what: "the build lacks an applied migration",
            make: async (_t, applied) => {
              rmSync(join(migrationsDir(), applied));
            },
          },
          {
            what: "an attempt at an applied file is unresolved",
            make: async (t, applied) => {
              // An attempt that recorded no outcome: its process stopped part way.
              await ledger(t).recordStart({
                eventType: "file_apply",
                source: "cli-migrate",
                filename: applied,
              });
            },
          },
        ];

        it.each(HISTORY_CASES)(
          "refuses a change while $what, and changes nothing",
          async ({ make }) => {
            const t = await boot();
            await kind.create([text("heading")]);
            const [applied] = await appliedFiles(t);
            expect(applied).toBeDefined();
            await make(t, applied!);
            const before = await standing(t, kind);

            await expect(
              kind.change(t, [text("heading"), text("body")])
            ).rejects.toMatchObject({
              code: "NEXTLY_MIGRATION_HISTORY_REFUSED",
            });

            expect(await standing(t, kind)).toEqual(before);
          }
        );
      });

      describe("while another session holds its table", () => {
        let free: () => void = () => {};
        let holding: Promise<unknown> = Promise.resolve();
        const previous = {
          tryBound: process.env.NEXTLY_LOCK_TIMEOUT,
          total: process.env.NEXTLY_LOCK_TIMEOUT_TOTAL,
        };

        beforeEach(() => {
          // Short bounds, so the tries run in seconds: one second a try, four in all.
          process.env.NEXTLY_LOCK_TIMEOUT = "1";
          process.env.NEXTLY_LOCK_TIMEOUT_TOTAL = "4";
        });

        afterEach(async () => {
          free();
          await holding.catch(() => {});
          for (const [key, value] of [
            ["NEXTLY_LOCK_TIMEOUT", previous.tryBound],
            ["NEXTLY_LOCK_TIMEOUT_TOTAL", previous.total],
          ] as const) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        });

        /**
         * A second session holds the table until `free()`: on PostgreSQL and MySQL an open
         * transaction that has read it, so a schema change waits for its lock; on SQLite an open
         * write transaction on a second connection to the file, which holds the whole database.
         */
        async function holdTheTable(t: TestNextly): Promise<void> {
          let held: () => void = () => {};
          const isHeld = new Promise<void>(resolve => {
            held = resolve;
          });
          const freed = new Promise<void>(resolve => {
            free = resolve;
          });
          const on =
            dialect === "sqlite"
              ? (holder = (await createAdapter({
                  type: "sqlite",
                  url: `file:${join(basePath, "test.db")}`,
                } as Parameters<
                  typeof createAdapter
                >[0])) as unknown as DrizzleAdapter)
              : adapterOf(t);
          holding = on.transaction(async tx => {
            if (dialect === "sqlite") {
              // A write, which holds the whole file whatever table it names; the entity's own
              // table may hold no row for an UPDATE to write.
              await tx.execute(
                "CREATE TABLE IF NOT EXISTS entity_save_hold (id integer)"
              );
              await tx.execute("INSERT INTO entity_save_hold (id) VALUES (1)");
            } else {
              await tx.execute(`SELECT id FROM ${kind.table}`);
            }
            held();
            await freed;
          });
          await isHeld;
        }

        it("stops with nothing changed", async () => {
          const t = await boot();
          await kind.create([text("heading")]);
          const before = await standing(t, kind);
          await holdTheTable(t);

          await expect(
            kind.change(t, [text("heading"), text("body")])
          ).rejects.toBeInstanceOf(Error);

          free();
          await holding.catch(() => {});
          expect(await standing(t, kind)).toEqual(before);
        }, 30_000);

        // Known gap: on SQLite the shared schema lock stops first, as a raw SQLITE_BUSY, no tries.
        it.skipIf(dialect === "sqlite")(
          "waits in tries, then stops as table busy",
          async () => {
            const t = await boot();
            await kind.create([text("heading")]);
            await holdTheTable(t);

            await expect(
              kind.change(t, [text("heading"), text("body")])
            ).rejects.toMatchObject({
              code: "NEXTLY_TABLE_BUSY",
              statusCode: 409,
            });
          },
          30_000
        );
      });
    });
  }
);
