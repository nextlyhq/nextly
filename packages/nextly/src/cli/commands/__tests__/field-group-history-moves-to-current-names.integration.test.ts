/**
 * A project's migration history moves to the current field-group names in one explicit step, and
 * every command after it follows the history, on every configured dialect.
 *
 * The history records the names its field groups are kept under in each snapshot. A site whose
 * storage moved (`nextly migrate:field-groups`) runs `nextly migrate:create
 * --field-group-names=current`, which writes a migration with no statement whose snapshot is the
 * newest one under the current names. `nextly migrate` records it on a database that moved, and
 * refuses it, naming the storage migration, on one that has not. A migrated database behind a
 * legacy history is refused by name, rather than reported as missing every `comp_` table.
 *
 * Each run owns its database, reached by the commands through `DATABASE_URL` as an app's would: a
 * file on SQLite, a scratch database on the servers.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { writeLegacyFieldGroupMigration } from "../../../__tests__/helpers/legacy-field-group-history";
import {
  defineCollection,
  defineConfig,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import { loadDialectTables } from "../../../database/dialect-tables";
import { createAdapter } from "../../../database/factory";
import { getDialectTables } from "../../../database/index";
import { clearServices, shutdownServices } from "../../../di/register";
import { hashManifest } from "../../../domains/field-groups/migration/manifest";
import { runFieldGroupMigration } from "../../../domains/field-groups/migration/run";
import { beginMigration } from "../../../domains/field-groups/migration/state";
import { forgetFieldGroupStorageNames } from "../../../domains/field-groups/storage/resolve-storage-names";
import { MetaService } from "../../../domains/meta/services/meta-service";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { refuseRollbackUnderCurrentHistory } from "../../../domains/schema/migrate/field-group-rollback";
import { parseSqlSections } from "../../../domains/schema/migrate/sql-sections";
import { freshPushSchema } from "../../../domains/schema/pipeline/fresh-push";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateBaseline } from "../migrate-baseline";
import { runMigrateCheck } from "../migrate-check";
import { runMigrateFieldGroups } from "../migrate-field-groups";
import { runMigrateCreate } from "../migrate-create";
import { runMigrateResolve } from "../migrate-resolve";

/** The configuration the commands load, set by each step before it runs them. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const SILENT = createLogger({ quiet: true });

function declarations(cardFields: string[]) {
  const fieldGroups = [
    defineFieldGroup({
      slug: "fh_card",
      fields: cardFields.map(name => text({ name })),
    }),
  ];
  const collections = [
    defineCollection({
      slug: "fh_posts",
      fields: [
        text({ name: "title" }),
        fieldGroup({ name: "card", component: "fh_card" }),
      ],
    }),
  ];
  return { fieldGroups, collections };
}

const FIRST = declarations(["heading"]);
const WITH_SUBTITLE = declarations(["heading", "subtitle"]);
const configOf = (d: typeof FIRST) =>
  defineConfig({ ...d, db: { migrationsDir: "./migrations" } });

/** Where the project's Schema Builder definitions are kept. */
const BUILDER_FILE = "./schema/builder.json";
const withBuilder = (d: typeof FIRST) =>
  defineConfig({
    ...d,
    db: { migrationsDir: "./migrations", uiSchemaFile: BUILDER_FILE },
  });

/** The Schema Builder's definitions: one field group, `fh_banner`, with `fields`. */
function writeBuilderGroup(fields: string[]): void {
  mkdirSync(join(dir, "schema"), { recursive: true });
  writeFileSync(
    join(dir, BUILDER_FILE),
    JSON.stringify({
      version: 1,
      collections: [],
      singles: [],
      components: [
        {
          slug: "fh_banner",
          labels: { singular: "Banner", plural: "Banners" },
          fields: fields.map(name => ({ name, type: "text" })),
        },
      ],
    })
  );
}

let dir: string;
let closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-fg-history-"));
  mkdirSync(join(dir, "migrations"));
});

afterEach(async () => {
  await shutdownServices().catch(() => {});
  for (const close of closers.splice(0)) await close();
  forgetFieldGroupStorageNames();
  vi.unstubAllEnvs();
  _resetEnvCache();
  setNonInteractive(false);
  rmSync(dir, { recursive: true, force: true });
});

/** A database of this test's own, which the commands reach through `DATABASE_URL`. */
async function openDatabase(dialect: TestDialect): Promise<string> {
  let url: string;
  if (dialect === "sqlite") {
    url = `file:${join(dir, "app.db")}`;
  } else {
    const scratch = await createScratchDatabase(dialect, "nextly_fg_history");
    url = scratch.url;
    closers.push(() => scratch.drop());
  }
  vi.stubEnv("DB_DIALECT", dialect);
  vi.stubEnv("DATABASE_URL", url);
  _resetEnvCache();
  return url;
}

/** Another empty database for the same project, which the commands then reach. */
async function openAnother(
  dialect: TestDialect,
  name: string
): Promise<string> {
  if (dialect !== "sqlite") return openDatabase(dialect);
  const url = `file:${join(dir, `${name}.db`)}`;
  vi.stubEnv("DATABASE_URL", url);
  _resetEnvCache();
  return url;
}

/** An adapter of the test's own on the database at `url`. */
async function connect(
  dialect: TestDialect,
  url: string
): Promise<DrizzleAdapter> {
  const adapter = (await createAdapter({
    type: dialect,
    url,
  } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
  closers.unshift(() => adapter.disconnect().catch(() => {}));
  return adapter;
}

/** Start the app over the database at `url`, declaring `declared`. */
async function start(
  dialect: TestDialect,
  url: string,
  declared: typeof FIRST
): Promise<TestNextly> {
  await shutdownServices().catch(() => {});
  clearServices();
  forgetFieldGroupStorageNames();
  return createTestNextly({
    adapter: (await connect(dialect, url)) as never,
    ...declared,
  });
}

function command(): { context: CommandContext; said: string[] } {
  const said: string[] = [];
  const capture = (message: string) => {
    said.push(message);
  };
  return {
    context: {
      logger: {
        ...SILENT,
        info: capture,
        warn: capture,
        success: capture,
        error: capture,
      },
      options: {},
      cwd: dir,
    } as CommandContext,
    said,
  };
}

/**
 * Run `fn`, turning `process.exit` into a thrown `exit <code>`, and say what it said: a refusal
 * the command throws rather than prints is part of what it said.
 */
async function run(
  fn: (context: CommandContext) => Promise<void>
): Promise<{ exit: number | undefined; said: string }> {
  const { context, said } = command();
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  // A refusal is printed in the error shape, on standard error rather than through the logger.
  const printed = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(chunk => {
      said.push(String(chunk));
      return true;
    });
  const logged = vi.spyOn(console, "error").mockImplementation((...parts) => {
    said.push(parts.map(String).join(" "));
  });
  try {
    await fn(context);
    return { exit: undefined, said: said.join("\n") };
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return { exit: Number(match[1]), said: said.join("\n") };
    return { exit: -1, said: [...said, String(error)].join("\n") };
  } finally {
    exit.mockRestore();
    printed.mockRestore();
    logged.mockRestore();
    forgetFieldGroupStorageNames();
  }
}

/** The project's first migration, on the legacy field-group names (`legacy-field-group-history`). */
function legacyInit(config: ReturnType<typeof configOf>): Promise<void> {
  return writeLegacyFieldGroupMigration({
    config,
    projectRoot: dir,
    migrationsDir: join(dir, "migrations"),
    dialect: process.env.DB_DIALECT as TestDialect,
    name: "init",
  });
}

/** `migrate:create`, non-interactively, with the given options. */
function create(
  name: string | undefined,
  options: Record<string, unknown> = {}
) {
  setNonInteractive(true);
  return run(context =>
    runMigrateCreate(
      name,
      { cwd: dir, ...options } as Parameters<typeof runMigrateCreate>[1],
      context
    )
  );
}

const migrate = () => run(context => runMigrate({ cwd: dir }, context));
const check = () =>
  run(context =>
    runMigrateCheck(
      { cwd: dir } as Parameters<typeof runMigrateCheck>[0],
      context
    )
  );

/** `nextly migrate:resolve --applied <file>`, with the given options. */
const resolveApplied = (file: string, options: Record<string, unknown>) =>
  run(context =>
    runMigrateResolve(
      { cwd: dir, applied: file, ...options } as Parameters<
        typeof runMigrateResolve
      >[0],
      context
    )
  );

/** `nextly migrate:field-groups --down`, a preview unless `options` applies it. */
const storageDown = (options: Record<string, unknown>) =>
  run(context =>
    runMigrateFieldGroups({ cwd: dir, down: true, ...options }, context)
  );

/** The files a run wrote, by name: `<name>.sql` and its snapshot. */
function written(name: string): { sql: string; snapshot: string } {
  const sql = readdirSync(join(dir, "migrations")).find(f =>
    f.endsWith(`_${name}.sql`)
  );
  if (sql === undefined) throw new Error(`no migration named ${name}`);
  return {
    sql: join(dir, "migrations", sql),
    snapshot: join(
      dir,
      "migrations",
      "meta",
      sql.replace(/\.sql$/, ".snapshot.json")
    ),
  };
}

/**
 * `nextly migrate:field-groups --apply --backup-confirmed`, on the database at `url`, through a
 * started app's adapter, whose schema registry holds every table the migration rewrites.
 */
async function migrateStorage(
  dialect: TestDialect,
  url: string
): Promise<void> {
  const app = await start(dialect, url, FIRST);
  const outcome = await runFieldGroupMigration({
    adapter: app.adapter as never,
    logger: SILENT as never,
    direction: "up",
    dryRun: false,
    // The test creates and drops this database itself.
    backupConfirmed: true,
  });
  forgetFieldGroupStorageNames();
  await shutdownServices().catch(() => {});
  expect(outcome).toMatchObject({ ran: true });
}

/** The files the ledger records applied, by file name. */
async function appliedNames(
  dialect: TestDialect,
  adapter: DrizzleAdapter
): Promise<string[]> {
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const rows = (await adapter.executeQuery(
    `SELECT ${q("filename")} AS filename FROM ${q("nextly_schema_events")} WHERE ${q("event_type")} = 'file_apply' AND ${q("status")} = 'applied'`
  )) as Array<{ filename: string }>;
  return rows.map(row => row.filename).sort();
}

describe.each(getConfiguredTestDialects())(
  "a migration history moving to the current field-group names (%s)",
  dialect => {
    /** A project on the legacy names with one post, its history applied. */
    async function legacyProject(): Promise<string> {
      const url = await openDatabase(dialect);
      loaded.config = configOf(FIRST);
      // An earlier release's history: a new project's now starts on the current names.
      await legacyInit(configOf(FIRST));
      const applied = await migrate();
      expect(applied.exit, applied.said).toBeUndefined();
      const app = await start(dialect, url, FIRST);
      await app.nextly.create({
        collection: "fh_posts" as never,
        data: { title: "P", card: { heading: "H" } } as never,
      });
      await shutdownServices().catch(() => {});
      return url;
    }

    it("writes the transition with no statement, records it on a migrated database, and every later file follows the current names", async () => {
      const url = await legacyProject();
      await migrateStorage(dialect, url);

      const moved = await create(undefined, { fieldGroupNames: "current" });
      expect(moved.exit, moved.said).toBeUndefined();
      const transition = written("field_group_current_names");
      const sections = parseSqlSections(
        await readFile(transition.sql, "utf-8")
      );
      // No statement in UP: the storage moves through `migrate:field-groups` alone.
      expect(
        sections.upSql
          .split("\n")
          .map(line => line.trim())
          .filter(line => line !== "" && !line.startsWith("--"))
      ).toEqual([]);
      const snapshot = JSON.parse(
        await readFile(transition.snapshot, "utf-8")
      ) as {
        version: number;
        fieldGroupStorage?: string;
        snapshot: {
          tables: Array<{ name: string; columns: { name: string }[] }>;
        };
      };
      expect(snapshot).toMatchObject({
        version: 2,
        fieldGroupStorage: "current",
      });
      const card = snapshot.snapshot.tables.find(t => t.name === "fg_fh_card");
      expect(card?.columns.map(c => c.name)).toContain("_field_group_type");
      expect(snapshot.snapshot.tables.map(t => t.name)).not.toContain(
        "comp_fh_card"
      );

      const applied = await migrate();
      expect(applied.exit, applied.said).toBeUndefined();
      const adapter = await connect(dialect, url);
      expect(
        (await appliedNames(dialect, adapter)).some(name =>
          name.includes("_field_group_current_names")
        )
      ).toBe(true);

      // Offline, the history and the config agree: no drift, though the first file's own DOWN
      // still names the legacy table it created.
      const checked = await check();
      expect(checked.exit, checked.said).toBeUndefined();
      expect(checked.said).toMatch(/no drift/);
      // Only the first file's own line does, for the legacy table its DOWN drops.
      expect(
        checked.said
          .split("\n")
          .filter(line => !/_init(?:\.sql)?\b/.test(line))
          .join("\n")
      ).not.toMatch(/\bcomp_|dynamic_components|_component_type/);

      // A code-first edit after the move is planned against the current names.
      loaded.config = configOf(WITH_SUBTITLE);
      const edit = await create("add_subtitle");
      expect(edit.exit, edit.said).toBeUndefined();
      const editSql = await readFile(written("add_subtitle").sql, "utf-8");
      expect(editSql).toMatch(/fg_fh_card/);
      expect(editSql).not.toMatch(/comp_fh_card/);
      const after = await migrate();
      expect(after.exit, after.said).toBeUndefined();

      const app = await start(dialect, url, WITH_SUBTITLE);
      const [post] = (
        await app.nextly.find({ collection: "fh_posts" as never })
      ).items as Array<{ card?: { heading?: string; subtitle?: unknown } }>;
      expect(post.card?.heading).toBe("H");
    }, 120_000);

    // The registry row of a field group the Schema Builder made is written by `nextly migrate`
    // from the snapshot: into the registry the database holds, naming the table it is stored in.
    it("writes a Schema Builder group's registry row under the current names once the history moved", async () => {
      const url = await openDatabase(dialect);
      // A Builder group's rows are written by the migrations, which SQLite asks consent for
      // where it cannot read the triggers a table carries; CI gives it, as here.
      vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", "1");
      writeBuilderGroup(["heading"]);
      loaded.config = withBuilder(FIRST);
      await legacyInit(withBuilder(FIRST));
      const first = await migrate();
      expect(first.exit, first.said).toBeUndefined();
      await migrateStorage(dialect, url);
      expect(
        (await create(undefined, { fieldGroupNames: "current" })).exit
      ).toBeUndefined();
      const moved = await migrate();
      expect(moved.exit, moved.said).toBeUndefined();

      writeBuilderGroup(["heading", "subtitle"]);
      const edit = await create("banner_subtitle");
      expect(edit.exit, edit.said).toBeUndefined();
      const applied = await migrate();
      expect(applied.exit, applied.said).toBeUndefined();

      const adapter = await connect(dialect, url);
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      // A row the registry lacks is written by the run from the snapshot's record, as a database
      // that lost it, or never had it, gets it back.
      await adapter.executeQuery(
        `DELETE FROM ${q("dynamic_field_groups")} WHERE ${q("slug")} = 'fh_banner'`
      );
      const rewritten = await migrate();
      expect(rewritten.exit, rewritten.said).toBeUndefined();

      const rows = (await adapter.executeQuery(
        `SELECT ${q("table_name")} AS table_name, ${q("fields")} AS fields FROM ${q("dynamic_field_groups")} WHERE ${q("slug")} = 'fh_banner'`
      )) as Array<{ table_name: string; fields: unknown }>;
      expect(rows.map(row => row.table_name)).toEqual(["fg_fh_banner"]);
      expect(JSON.stringify(rows[0]?.fields)).toContain("subtitle");
    });

    // A history on the current names drops a removed group's `fg_<slug>` table, which the
    // removal check must still read as that group, or its dependents go unnamed.
    it("refuses to drop a field group a remaining collection places, after the history moved", async () => {
      const url = await legacyProject();
      await migrateStorage(dialect, url);
      expect(
        (await create(undefined, { fieldGroupNames: "current" })).exit
      ).toBeUndefined();
      const moved = await migrate();
      expect(moved.exit, moved.said).toBeUndefined();

      loaded.config = defineConfig({
        collections: FIRST.collections,
        fieldGroups: [],
        db: { migrationsDir: "./migrations" },
      });
      const dropped = await create("drop_card");

      expect(dropped.exit).not.toBeUndefined();
      expect(dropped.said).toContain(
        '"fh_card" cannot be deleted while other schema depends on it. Fields that place it: fh_posts.card.'
      );
      expect(
        readdirSync(join(dir, "migrations")).filter(f =>
          f.endsWith("_drop_card.sql")
        )
      ).toEqual([]);
    });

    it("refuses the transition on a database whose field groups have not moved, and records nothing", async () => {
      const url = await legacyProject();

      const moved = await create(undefined, { fieldGroupNames: "current" });
      expect(moved.exit, moved.said).toBeUndefined();
      const refused = await migrate();

      expect(refused.exit).not.toBeUndefined();
      expect(refused.said).toMatch(
        /nextly migrate:field-groups --apply --backup-confirmed/
      );
      const adapter = await connect(dialect, url);
      expect(
        (await appliedNames(dialect, adapter)).some(name =>
          name.includes("_field_group_current_names")
        )
      ).toBe(false);
    });

    it("names the step a migrated database behind a legacy history needs, rather than every table as missing", async () => {
      const url = await legacyProject();
      await migrateStorage(dialect, url);

      const refused = await migrate();

      expect(refused.exit).not.toBeUndefined();
      expect(refused.said).toMatch(
        /nextly migrate:create --field-group-names=current/
      );
      expect(refused.said).not.toMatch(/table comp_fh_card/);
    });

    it("refuses the transition while the config has another change to migrate, before writing anything", async () => {
      await legacyProject();
      loaded.config = configOf(WITH_SUBTITLE);

      const moved = await create(undefined, { fieldGroupNames: "current" });

      expect(moved.exit, moved.said).not.toBeUndefined();
      expect(moved.said).toMatch(/changes to "comp_fh_card"/);
      expect(
        readdirSync(join(dir, "migrations")).filter(f =>
          f.endsWith("_field_group_current_names.sql")
        )
      ).toEqual([]);
    });

    // A release before the naming record could write a snapshot on the current names after the
    // storage moved, with nothing in it to say so. Its field-group tables hold the current type
    // column, which only a moved database has: it is read as on the current names, and the next
    // file is planned against the fg_ tables rather than dropping them for comp_ copies.
    it("reads an unmarked snapshot an earlier release wrote on the current names as current", async () => {
      const url = await legacyProject();
      await migrateStorage(dialect, url);
      expect(
        (await create(undefined, { fieldGroupNames: "current" })).exit
      ).toBeUndefined();
      // As that release wrote it: the same tables, as version 1 with no record of their names.
      const { snapshot } = written("field_group_current_names");
      const file = JSON.parse(await readFile(snapshot, "utf-8")) as Record<
        string,
        unknown
      >;
      file.version = 1;
      delete file.fieldGroupStorage;
      writeFileSync(snapshot, JSON.stringify(file, null, 2));
      loaded.config = configOf(WITH_SUBTITLE);

      const edit = await create("add_subtitle");

      expect(edit.exit, edit.said).toBeUndefined();
      const editSql = await readFile(written("add_subtitle").sql, "utf-8");
      expect(editSql).toMatch(/fg_fh_card/);
      expect(editSql).not.toMatch(/comp_fh_card/);
      const applied = await migrate();
      expect(applied.exit, applied.said).toBeUndefined();
    });

    // A field group an earlier release created after the move keeps the legacy type column, and
    // the history, read under the database's names, records the current one there. The move of the
    // history is refused before it is recorded, naming the re-baseline.
    it("refuses to move the history over a table still on the legacy type column, pointing at a baseline", async () => {
      const url = await legacyProject();
      await migrateStorage(dialect, url);
      // As that release left it: the table under the current name, on the legacy type column.
      const adapter = await connect(dialect, url);
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      await adapter.executeQuery(
        `ALTER TABLE ${q("fg_fh_card")} RENAME COLUMN ${q("_field_group_type")} TO ${q("_component_type")}`
      );
      expect(
        (await create(undefined, { fieldGroupNames: "current" })).exit
      ).toBeUndefined();

      const refused = await migrate();

      expect(refused.exit, refused.said).not.toBeUndefined();
      expect(refused.said).toContain("FIELD_GROUP_TYPE_COLUMN_NOT_RECORDED");
      expect(refused.said).toContain("fg_fh_card");
      expect(
        (await appliedNames(dialect, adapter)).some(name =>
          name.includes("_field_group_current_names")
        )
      ).toBe(false);
    });

    // `migrate:resolve --applied` records a file without running it. The move of the history is
    // held to the same rule there as in `nextly migrate`, whether or not the file is compared.
    for (const [how, options] of [
      ["compared with the database", {}],
      ["not compared", { skipVerify: true }],
      ["in a dry run", { dryRun: true }],
    ] as const) {
      it(`refuses to record a file on the current names on a database that has not moved, ${how}`, async () => {
        const url = await legacyProject();
        expect(
          (await create(undefined, { fieldGroupNames: "current" })).exit
        ).toBeUndefined();
        const transition = basename(written("field_group_current_names").sql);

        const refused = await resolveApplied(transition, options);

        // A dry run reports what a real run would refuse, and ends as a run that did its work.
        if ("dryRun" in options) {
          expect(refused.said).toContain("A real run would refuse");
        } else {
          expect(refused.exit, refused.said).not.toBeUndefined();
        }
        expect(refused.said).toContain("are still on the legacy ones");
        expect(refused.said).toContain("nextly migrate:field-groups");
        const adapter = await connect(dialect, url);
        expect(await appliedNames(dialect, adapter)).not.toContain(transition);
      }, 120_000);
    }

    // A template's older-format snapshot says nothing of the current names, and no snapshot can be
    // compared: recorded without the comparison, as before.
    it("still records a template's older-format file without comparing it", async () => {
      const url = await legacyProject();
      const name = "20261125_120000_000_template";
      writeFileSync(
        join(dir, "migrations", `${name}.sql`),
        "-- Migration: template\n\n-- UP\nSELECT 1;\n\n-- DOWN\nSELECT 1;\n"
      );
      writeFileSync(
        join(dir, "migrations", "meta", `${name}.snapshot.json`),
        JSON.stringify({ version: 1, collections: [], singles: [] })
      );

      const recorded = await resolveApplied(`${name}.sql`, {
        skipVerify: true,
      });

      expect(recorded.exit, recorded.said).toBeUndefined();
      const adapter = await connect(dialect, url);
      expect(await appliedNames(dialect, adapter)).toContain(`${name}.sql`);

      // And the storage of a database whose newest file is one may move back.
      await migrateStorage(dialect, url);
      const down = await storageDown({});
      expect(down.exit, down.said).toBeUndefined();
      expect(down.said).toContain("Preview of a down migration");
    }, 120_000);

    it("records a file on the current names on a database that moved", async () => {
      const url = await legacyProject();
      await migrateStorage(dialect, url);
      expect(
        (await create(undefined, { fieldGroupNames: "current" })).exit
      ).toBeUndefined();
      const transition = basename(written("field_group_current_names").sql);

      const recorded = await resolveApplied(transition, {});

      expect(recorded.exit, recorded.said).toBeUndefined();
      const adapter = await connect(dialect, url);
      expect(await appliedNames(dialect, adapter)).toContain(transition);
    }, 120_000);

    /** The project moved whole: its storage, then its history, applied. */
    async function movedProject(): Promise<string> {
      const url = await legacyProject();
      await migrateStorage(dialect, url);
      expect(
        (await create(undefined, { fieldGroupNames: "current" })).exit
      ).toBeUndefined();
      const moved = await migrate();
      expect(moved.exit, moved.said).toBeUndefined();
      return url;
    }

    // Once the applied history is on the current names, no command moves it back, so neither does
    // the storage. The preview refuses too: it describes a run that would be refused.
    for (const [how, options] of [
      ["a real run", { apply: true, backupConfirmed: true }],
      ["a preview", {}],
    ] as const) {
      it(`refuses to move the storage back under a history on the current names, in ${how}`, async () => {
        const url = await movedProject();

        const refused = await storageDown(options);

        expect(refused.exit, refused.said).not.toBeUndefined();
        expect(refused.said).toContain("cannot be moved back");
        expect(refused.said).toContain("_field_group_current_names");
        const adapter = await connect(dialect, url);
        expect(await adapter.tableExists("fg_fh_card")).toBe(true);
        expect(await adapter.tableExists("comp_fh_card")).toBe(false);
      }, 120_000);
    }

    it("moves the storage back while the history is still on the legacy names", async () => {
      const url = await legacyProject();
      await migrateStorage(dialect, url);

      const down = await storageDown({ apply: true, backupConfirmed: true });

      expect(down.exit, down.said).toBeUndefined();
      const adapter = await connect(dialect, url);
      expect(await adapter.tableExists("comp_fh_card")).toBe(true);
      expect(await adapter.tableExists("fg_fh_card")).toBe(false);
      const app = await start(dialect, url, FIRST);
      const [post] = (
        await app.nextly.find({ collection: "fh_posts" as never })
      ).items as Array<{ card?: { heading?: string } }>;
      expect(post.card?.heading).toBe("H");
    }, 120_000);

    it("refuses where the history's names cannot be told, naming the file", async () => {
      const url = await movedProject();
      const transition = written("field_group_current_names");
      const content = await readFile(transition.snapshot, "utf-8");

      // A snapshot that cannot be read.
      writeFileSync(transition.snapshot, "{");
      const unreadable = await storageDown({});
      expect(unreadable.exit, unreadable.said).not.toBeUndefined();
      expect(unreadable.said).toContain("its snapshot cannot be read");
      expect(unreadable.said).toContain(
        "Run the command from the project that holds its migrations"
      );
      writeFileSync(transition.snapshot, content);

      // Another project's folder: the ledger records files this one does not hold.
      renameSync(join(dir, "migrations"), join(dir, "elsewhere"));
      const missing = await storageDown({});
      expect(missing.exit, missing.said).not.toBeUndefined();
      expect(missing.said).toContain("is not in the migrations folder");

      const adapter = await connect(dialect, url);
      expect(await adapter.tableExists("fg_fh_card")).toBe(true);
    }, 120_000);

    // A hand-written file has no snapshot and says nothing: the newest file that has one decides.
    it("reads past a hand-written file to the newest one that says which names it is on", async () => {
      const url = await movedProject();
      const files = readdirSync(join(dir, "migrations"))
        .filter(f => f.endsWith(".sql"))
        .sort();
      const byHand = `${files
        .at(-1)!
        .replace(/_[^\d].*$/, "")
        .replace(/^\d{4}/, "2099")}_by_hand.sql`;
      writeFileSync(
        join(dir, "migrations", byHand),
        "-- Migration: by_hand\n-- nextly:blank\n\n-- UP\nSELECT 1;\n\n-- DOWN\nSELECT 1;\n"
      );
      const applied = await migrate();
      expect(applied.exit, applied.said).toBeUndefined();
      const adapter = await connect(dialect, url);
      expect(await appliedNames(dialect, adapter)).toContain(byHand);

      const refused = await storageDown({});

      expect(refused.exit, refused.said).not.toBeUndefined();
      expect(refused.said).toContain("cannot be moved back");
    }, 120_000);

    // The engine refuses the opposite direction while a run is in flight, so a stopped `--down` is
    // finished only by `--down`: it is not judged, even from a folder that holds no migration.
    it("passes a move back that is in flight on, whatever the folder holds", async () => {
      const url = await movedProject();
      const app = await start(dialect, url, FIRST);
      const adapter = app.adapter as unknown as DrizzleAdapter;
      const entries = [
        {
          kind: "registry" as const,
          from: "dynamic_components",
          to: "dynamic_field_groups",
        },
      ];
      await beginMigration(new MetaService(adapter, SILENT as never), {
        direction: "down",
        migrationId: "fh-stalled",
        plan: { registryHash: "fh", manifestHash: hashManifest(entries) },
        appliedManifest: entries,
      });

      await expect(
        refuseRollbackUnderCurrentHistory({
          adapter,
          migrationsDir: join(dir, "no-such-folder"),
        })
      ).resolves.toBeUndefined();
    }, 120_000);

    // A move back undoes only what the recorded move holds. A new site's holds the registry alone:
    // its groups' tables would stay on the current names beside a legacy registry, and the storage
    // could then move neither way.
    it("refuses to move a new site back, whose groups were created on the current names", async () => {
      const url = await openDatabase(dialect);
      loaded.config = configOf(FIRST);
      const first = await start(dialect, url, FIRST);
      await first.nextly.create({
        collection: "fh_posts" as never,
        data: { title: "P", card: { heading: "H" } } as never,
      });
      await shutdownServices().catch(() => {});

      const refused = await storageDown({ apply: true, backupConfirmed: true });

      expect(refused.exit, refused.said).not.toBeUndefined();
      expect(refused.said).toContain("fh_card was created on the current ones");
      const adapter = await connect(dialect, url);
      expect(await adapter.tableExists("dynamic_field_groups")).toBe(true);
      expect(await adapter.tableExists("dynamic_components")).toBe(false);
      const app = await start(dialect, url, FIRST);
      const [post] = (
        await app.nextly.find({ collection: "fh_posts" as never })
      ).items as Array<{ card?: { heading?: string } }>;
      expect(post.card?.heading).toBe("H");
    }, 180_000);

    it("refuses to move a site back once a group was created after its move, in a preview too", async () => {
      const url = await legacyProject();
      await migrateStorage(dialect, url);
      const later = {
        ...FIRST,
        fieldGroups: [
          ...FIRST.fieldGroups,
          defineFieldGroup({
            slug: "fh_later",
            fields: [text({ name: "note" })],
          }),
        ],
      };
      const app = await start(dialect, url, later);
      expect(await app.adapter.tableExists("fg_fh_later")).toBe(true);
      await shutdownServices().catch(() => {});

      for (const options of [{}, { apply: true, backupConfirmed: true }]) {
        const refused = await storageDown(options);
        expect(refused.exit, refused.said).not.toBeUndefined();
        expect(refused.said).toContain(
          "fh_later was created on the current ones"
        );
      }
      const adapter = await connect(dialect, url);
      expect(await adapter.tableExists("fg_fh_card")).toBe(true);
    }, 180_000);

    // A baseline writes the history of a database that has none: on the names it keeps its field
    // groups under, so the next file is planned against the tables it holds.
    for (const naming of ["current", "legacy"] as const) {
      it(`baselines a database on the ${naming} names as on them, and the next file follows`, async () => {
        const url = await openDatabase(dialect);
        loaded.config = configOf(FIRST);
        if (naming === "legacy") {
          const adapter = await connect(dialect, url);
          await loadDialectTables(dialect);
          await freshPushSchema(
            dialect,
            adapter.getDrizzle(),
            getDialectTables(dialect)
          );
        }
        await start(dialect, url, FIRST);
        await shutdownServices().catch(() => {});

        setNonInteractive(true);
        const baseline = await run(context =>
          runMigrateBaseline({ cwd: dir }, context)
        );

        expect(baseline.exit, baseline.said).toBeUndefined();
        const [file] = readdirSync(join(dir, "migrations", "meta"));
        const snapshot = JSON.parse(
          await readFile(join(dir, "migrations", "meta", file!), "utf-8")
        ) as {
          version: number;
          fieldGroupStorage?: string;
          snapshot: { tables: Array<{ name: string }> };
        };
        expect(snapshot.version).toBe(naming === "current" ? 2 : 1);
        expect(snapshot.fieldGroupStorage).toBe(
          naming === "current" ? "current" : undefined
        );
        const group = naming === "current" ? "fg_fh_card" : "comp_fh_card";
        expect(snapshot.snapshot.tables.map(t => t.name)).toContain(group);

        loaded.config = configOf(WITH_SUBTITLE);
        const edit = await create("add_subtitle");
        expect(edit.exit, edit.said).toBeUndefined();
        const sql = await readFile(written("add_subtitle").sql, "utf-8");
        expect(sql).toContain(group);
        expect(sql).not.toContain(
          naming === "current" ? "comp_fh_card" : "fg_fh_card"
        );
        const applied = await migrate();
        expect(applied.exit, applied.said).toBeUndefined();
      }, 180_000);
    }

    // A history that moved is legacy up to its move and current after it. Replayed on an empty
    // database, its first files make the legacy storage they describe, the run stops at the move
    // naming the storage migration, and goes on once that has run.
    it("replays a moved history on an empty database up to the move, and goes on once the storage moves", async () => {
      await movedProject();
      loaded.config = configOf(WITH_SUBTITLE);
      const edit = await create("add_subtitle");
      expect(edit.exit, edit.said).toBeUndefined();
      const edited = await migrate();
      expect(edited.exit, edited.said).toBeUndefined();

      const fresh = await openAnother(dialect, "fresh");
      const stopped = await migrate();
      expect(stopped.exit, stopped.said).not.toBeUndefined();
      expect(stopped.said).toContain("FIELD_GROUP_STORAGE_NOT_MIGRATED");
      const adapter = await connect(dialect, fresh);
      expect(await adapter.tableExists("comp_fh_card")).toBe(true);
      expect(await adapter.tableExists("fg_fh_card")).toBe(false);

      await migrateStorage(dialect, fresh);
      const rest = await migrate();
      expect(rest.exit, rest.said).toBeUndefined();
      expect(await adapter.tableExists("fg_fh_card")).toBe(true);
      expect(await adapter.tableExists("comp_fh_card")).toBe(false);
      const app = await start(dialect, fresh, WITH_SUBTITLE);
      const created = await app.nextly.create({
        collection: "fh_posts" as never,
        data: { title: "P", card: { heading: "H", subtitle: "S" } } as never,
      });
      expect(created.item).toBeTruthy();
    }, 240_000);
  }
);
