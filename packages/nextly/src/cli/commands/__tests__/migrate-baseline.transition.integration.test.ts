/**
 * Graduating a `db:sync` project to migrations, end to end.
 *
 * The unit tests around `planBaseline` prove the decisions; this proves the
 * flow. It drives the real sequence a developer runs — `db:sync`, then
 * `migrate:baseline`, then `migrate:create`, then `migrate` — against a real
 * database, because every step of the defect lives in the seam between two of
 * those commands and none of it is visible from inside one.
 *
 * The first test is the defect itself, kept as a test rather than as prose: on
 * a database `db:sync` built, `migrate:create` alone emits `CREATE TABLE` for
 * tables that already exist, and applying that file is refused. It is what the
 * second test must not do.
 *
 * Both dialects run the same body. SQLite and PostgreSQL introspect through
 * completely different queries, and the snapshot the baseline records is
 * whatever introspection returned — so a baseline that round-trips on one says
 * nothing about the other.
 *
 * Each run gets a database of its own. The baseline adopts every managed table
 * in the database by design, so a `dc_` table left behind by another suite
 * would be adopted here and then proposed for dropping by the next
 * `migrate:create`.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineCollection, defineConfig, text } from "../../../config";
import { getDialectTables } from "../../../database/index";
import { createAdapter } from "../../../database/factory";
import { SchemaRegistry } from "../../../database/schema-registry";
import { getSchemaEventsDdl } from "../../../domains/schema/events/schema-events-ddl";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { clearCachedSnapshot } from "../../../init/schema-snapshot-cache";
import { toMinimalEntities } from "../../../domains/schema/migrate-create/config-entities";
import { introspectLiveSnapshot } from "../../../domains/schema/pipeline/diff/introspect-live";
import { generateMigration } from "../../../domains/schema/migrate-create/generate";
import { resolveCollectionTableName } from "../../../domains/schema/utils/resolve-table-name";
import { createLogger } from "../../utils/logger";
import { baselineCore } from "../migrate-baseline";
import { ensureLocalizedCompanions, syncCollections } from "../dev-build";
import { ensureCoreTables } from "../dev-server";
import {
  parseSqlSections,
  runFileMigrations,
  splitSqlStatements,
} from "../migrate";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import type { CommandContext } from "../../program";
import type { CLIDatabaseAdapter } from "../../utils/adapter";
import type { LoadConfigResult } from "../../utils/config-loader";
import type { ResolvedDevOptions } from "../db-sync";

const PG_URL = process.env.TEST_POSTGRES_URL ?? "";

/**
 * Unique per run so a leftover database from a crashed run is never reused.
 *
 * Deliberately short. A junction table is named `<mainA>_<mainB>_<field>`, and
 * PostgreSQL truncates an identifier at 63 bytes without complaining — so a
 * long slug here would silently create a table under a different name than the
 * one asserted, and the junction case would fail for a reason that has nothing
 * to do with what it tests.
 */
const RUN_ID = randomBytes(4).toString("hex");

const SLUG = `baseline_posts_${RUN_ID}`;
const TABLE = resolveCollectionTableName(SLUG);

/** The config before the change, and after it. One added field between them. */
const configV1 = defineConfig({
  collections: [
    defineCollection({ slug: SLUG, fields: [text({ name: "title" })] }),
  ],
});
const configV2 = defineConfig({
  collections: [
    defineCollection({
      slug: SLUG,
      fields: [text({ name: "title" }), text({ name: "subtitle" })],
    }),
  ],
});

/** A localized collection, whose translations live in a companion table. */
const LOCALIZED_SLUG = `baseline_loc_${RUN_ID}`;
const LOCALIZED_TABLE = resolveCollectionTableName(LOCALIZED_SLUG);
const localizedConfig = defineConfig({
  localization: { locales: ["en", "es"], defaultLocale: "en" },
  collections: [
    defineCollection({
      slug: LOCALIZED_SLUG,
      localized: true,
      fields: [text({ name: "title", localized: true })],
    }),
  ],
});

const logger = createLogger({ quiet: true });
const context = { logger, options: {} } as CommandContext;

interface Harness {
  adapter: CLIDatabaseAdapter;
  db: unknown;
  dialect: SupportedDialect;
  migrationsDir: string;
  /** Tear down the database and the temp directory. */
  dispose: () => Promise<void>;
}

/**
 * A database nothing else can reach, plus an empty `migrations/` beside it.
 *
 * PostgreSQL gets a real database created for the run: introspection is scoped
 * to `public`, so a schema would not separate this suite's tables from any
 * other's.
 */
async function makeHarness(
  dialect: SupportedDialect,
  suffix = ""
): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "nextly-baseline-"));
  const migrationsDir = join(dir, "migrations");

  if (dialect === "sqlite") {
    process.env.DB_DIALECT = "sqlite";
    const adapter = await createAdapter({
      type: "sqlite",
      url: `file:${join(dir, "test.db")}`,
    } as Parameters<typeof createAdapter>[0]);
    return {
      adapter: adapter as unknown as CLIDatabaseAdapter,
      db: (adapter as unknown as DrizzleAdapter).getDrizzle(),
      dialect,
      migrationsDir,
      dispose: async () => {
        await adapter.disconnect();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  }

  const dbName = `nextly_baseline_${RUN_ID}${suffix ? `_${suffix}` : ""}`;
  const admin = new Pool({ connectionString: PG_URL });
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const url = new URL(PG_URL);
  url.pathname = `/${dbName}`;
  process.env.DB_DIALECT = "postgresql";
  process.env.DATABASE_URL = url.toString();
  const adapter = await createAdapter({
    type: "postgresql",
    url: url.toString(),
  } as Parameters<typeof createAdapter>[0]);

  return {
    adapter: adapter as unknown as CLIDatabaseAdapter,
    db: (adapter as unknown as DrizzleAdapter).getDrizzle(),
    dialect,
    migrationsDir,
    dispose: async () => {
      await adapter.disconnect();
      const cleanup = new Pool({ connectionString: PG_URL });
      await cleanup.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      await cleanup.end();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * What `nextly db:sync` does to a fresh database, minus the disk reads.
 *
 * Deliberately the real `syncCollections` rather than a hand-built
 * `CREATE TABLE`: the point of the whole test is that the tables the baseline
 * adopts are the ones the push pipeline actually produces, down to the column
 * types introspection will report.
 */
async function runDbSync(h: Harness, config: LoadConfigResult["config"]) {
  const drizzleAdapter = h.adapter as unknown as DrizzleAdapter;
  const registry = new SchemaRegistry(h.dialect);
  registry.registerStaticSchemas(getDialectTables(h.dialect));
  drizzleAdapter.setTableResolver(registry);

  const options = { cwd: "", autoSync: true } as ResolvedDevOptions;
  await ensureCoreTables(h.adapter, options, context);
  // The real command's order: the transition copy runs BEFORE the pushes,
  // while an entity gaining localization still has the translatable columns on
  // its main table for the copy to read, and the companion creation after.
  await ensureLocalizedCompanions(config, h.adapter, context, "beforeApply");
  await syncCollections(
    { config } as LoadConfigResult,
    h.adapter,
    options,
    context
  );
  await ensureLocalizedCompanions(config, h.adapter, context);

  // Removed LAST, after the push pipeline has run: `ensureCoreTables` declares
  // the ledger among the core schema and a push recreates it, so dropping it
  // earlier would not leave the database in the state this is modelling. A
  // db:sync project has never run `migrate`, which is what bootstraps the
  // ledger, so `migrate:baseline` is the first thing that writes to it and has
  // to create it. Creating it in the harness would supply the precondition the
  // command is responsible for.
  await dropLedger(h);
}

/** `migrate:create`, given a config, exactly as the CLI composes its arguments. */
async function runMigrateCreate(
  h: Harness,
  config: LoadConfigResult["config"],
  name: string
) {
  return generateMigration({
    name,
    dialect: h.dialect,
    migrationsDir: h.migrationsDir,
    collections: toMinimalEntities(config.collections, e =>
      resolveCollectionTableName(e.slug, e.dbName)
    ),
    singles: [],
    components: [],
    nonInteractive: true,
  });
}

/**
 * Remove the migration ledger, putting the database in the state a db:sync
 * project is really in: core tables present, nothing having ever migrated.
 *
 * `ensureCoreTables` declares the ledger among the core schema, so a fresh
 * push creates it. A database that predates that declaration does not have it,
 * and that is the case where a baseline that assumes the table would fail
 * after writing its files.
 */
async function dropLedger(h: Harness): Promise<void> {
  await (h.adapter as unknown as DrizzleAdapter).executeQuery(
    "DROP TABLE IF EXISTS nextly_schema_events"
  );
}

/**
 * What `migrate` Phase 1 does before it applies anything.
 *
 * `runFileMigrations` is Phase 2 alone, so a test driving it directly has to
 * stand in for Phase 1. Only the tests that reach `migrate` WITHOUT baselining
 * first need it — after a baseline the ledger is already there, because
 * creating it is part of adopting.
 */
async function bootstrapLedger(h: Harness): Promise<void> {
  for (const stmt of getSchemaEventsDdl(h.dialect)) {
    await (h.adapter as unknown as DrizzleAdapter).executeQuery(stmt);
  }
}

/** Whether a table exists, probed the way the write path probes it. */
async function tableExists(h: Harness, name: string): Promise<boolean> {
  try {
    await (h.adapter as unknown as DrizzleAdapter).executeQuery(
      `SELECT 1 FROM "${name}" LIMIT 0`
    );
    return true;
  } catch {
    return false;
  }
}

/** Whether the live table has a column, asked the way the drift engine asks. */
async function hasColumn(h: Harness, column: string): Promise<boolean> {
  try {
    await (h.adapter as unknown as DrizzleAdapter).executeQuery(
      `SELECT "${column}" FROM "${TABLE}" LIMIT 0`
    );
    return true;
  } catch {
    return false;
  }
}

function runSuite(dialect: SupportedDialect): void {
  let h: Harness;
  let previousDialect: string | undefined;
  let previousUrl: string | undefined;

  beforeEach(async () => {
    previousDialect = process.env.DB_DIALECT;
    previousUrl = process.env.DATABASE_URL;
    // The push pipeline caches the last applied desired-schema for the life of
    // the process. Each test here starts on a database that has never been
    // pushed to, so a hit carried over from the previous one would skip the
    // push and leave the tables the whole flow is about uncreated.
    clearCachedSnapshot();
    h = await makeHarness(dialect);
  });

  afterEach(async () => {
    await h.dispose();
    // Integration files share one fork, so an environment left set here would
    // be read by every file that follows.
    if (previousDialect === undefined) delete process.env.DB_DIALECT;
    else process.env.DB_DIALECT = previousDialect;
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  });

  it("without adopting, the first migration re-creates tables that exist and is refused", async () => {
    await runDbSync(h, configV1);

    // This is the reported defect. The config gained one field, but with no
    // snapshot to diff against, generation compares it to nothing.
    const result = await runMigrateCreate(h, configV2, "add_subtitle");
    expect(result).not.toBeNull();
    const sql = await readFile(result!.sqlPath, "utf-8");
    expect(sql).toContain("CREATE TABLE");
    expect(sql).toContain(TABLE);

    // And it cannot be applied: the database matches neither the empty
    // baseline the file assumes nor the target it describes. All three
    // recoveries the drift error offers fail from here, which is what leaves
    // the operator stuck.
    await bootstrapLedger(h);
    await expect(
      runFileMigrations({
        adapter: h.adapter,
        db: h.db,
        dialect: h.dialect,
        migrationsDir: h.migrationsDir,
        logger,
      })
    ).rejects.toThrow(/drift/i);

    expect(await hasColumn(h, "subtitle")).toBe(false);
  });

  it("adopts the database, then generates a delta that creates no table", async () => {
    await runDbSync(h, configV1);

    const adopted = await baselineCore({
      adapter: h.adapter,
      db: h.db,
      dialect: h.dialect,
      migrationsDir: h.migrationsDir,
      logger,
    });
    expect(adopted.kind).toBe("baselined");
    if (adopted.kind !== "baselined") throw new Error("expected a baseline");
    expect(adopted.tableCount).toBe(1);

    // Adopting created the ledger it recorded itself into. A database managed
    // by `db:sync` has never run `migrate`, which is what normally bootstraps
    // it, so a command that assumed the table would throw here — after both
    // files were already on disk.
    const recorded = await new SchemaEventsRepository(
      h.db,
      h.dialect
    ).listFileApplies();
    expect(recorded.map(r => r.filename)).toContain(basename(adopted.sqlPath));

    const result = await runMigrateCreate(h, configV2, "add_subtitle");
    expect(result).not.toBeNull();
    const sql = await readFile(result!.sqlPath, "utf-8");
    const up = splitSqlStatements(parseSqlSections(sql).upSql);

    // The change itself, and nothing that rebuilds what is already standing.
    // A `CREATE TABLE` here is the entire reported defect, so it is asserted
    // against the parsed statements rather than the whole file — the header
    // comment names the collection, and a substring check on the raw text
    // would pass for the wrong reason.
    expect(up.filter(s => /^ALTER TABLE .* ADD COLUMN/i.test(s))).toEqual([
      expect.stringContaining("subtitle"),
    ]);
    // Filtered rather than `.some(...)`: a boolean assertion that fails says
    // only "expected true to be false", and the statement it objected to is
    // the whole diagnosis.
    expect(up.filter(s => /^CREATE TABLE/i.test(s))).toEqual([]);
    expect(up.filter(s => /^DROP /i.test(s))).toEqual([]);

    // What remains is index creation, and it is expected here rather than a
    // leak from the baseline. The schema the push pipeline generates for a
    // collection declares no indexes at all, while the desired snapshot
    // `migrate:create` builds declares the slug, created_by and created_at
    // ones — so a database built by `db:sync` genuinely lacks them, the
    // baseline records that truthfully, and the first migration after
    // adoption is where they arrive.
    const unexpected = up.filter(
      s =>
        s.trim().length > 0 &&
        !/^ALTER TABLE .* ADD COLUMN/i.test(s) &&
        !/^CREATE (UNIQUE )?INDEX/i.test(s)
    );
    expect(unexpected).toEqual([]);

    // It applies. Exactly one file runs — the baseline was recorded as
    // applied when it was written, so it is not replayed against the database
    // it was taken from.
    const applied = await runFileMigrations({
      adapter: h.adapter,
      db: h.db,
      dialect: h.dialect,
      migrationsDir: h.migrationsDir,
      logger,
    });
    expect(applied).toBe(1);
    expect(await hasColumn(h, "subtitle")).toBe(true);
    // The column the baseline adopted is still there: adopting recorded the
    // schema, it did not rebuild it.
    expect(await hasColumn(h, "title")).toBe(true);
  });

  it("carries a localized companion into the baseline SQL, but not the snapshot", async () => {
    // The split is the point. A companion is derived, never declared by
    // config, so recording it in the SNAPSHOT would make the next diff want to
    // drop it. It still has to be in the SQL: `migrate:create` emits a
    // companion only while the previous snapshot shows the translatable
    // columns on the main table, and after a baseline that table is recorded
    // already without them — which reads as "already localized, the companion
    // exists" and emits nothing. So if the baseline does not carry it, no file
    // ever will, and a fresh environment gets a main table with nowhere to put
    // translations.
    await runDbSync(h, localizedConfig);
    expect(await tableExists(h, `${LOCALIZED_TABLE}_locales`)).toBe(true);

    const adopted = await baselineCore({
      adapter: h.adapter,
      db: h.db,
      dialect: h.dialect,
      migrationsDir: h.migrationsDir,
      logger,
      // The RAW collections, as the command passes them: the column
      // descriptor reads storage inputs the diff engine's reduction drops.
      localizedEntities: localizedConfig.collections.map(c => ({
        slug: c.slug,
        tableName: resolveCollectionTableName(c.slug),
        fields: c.fields,
        status: false,
        builtBy: "codeFirst" as const,
      })),
      defaultLocale: "en",
    });
    if (adopted.kind !== "baselined") throw new Error("expected a baseline");

    const up = splitSqlStatements(
      parseSqlSections(await readFile(adopted.sqlPath, "utf-8")).upSql
    );
    const companionStatements = up.filter(st =>
      st.includes(`${LOCALIZED_TABLE}_locales`)
    );
    expect(companionStatements).not.toEqual([]);
    // Emitted through the production companion DDL, not rebuilt from the
    // introspected shape: the snapshot model has no concept of a foreign key,
    // so a companion reconstructed from one loses the cascade and deleting a
    // document strands its translations.
    expect(companionStatements.join("\n")).toMatch(/ON DELETE CASCADE/i);
    expect(companionStatements.join("\n")).toContain(LOCALIZED_TABLE);

    const recorded = JSON.parse(
      await readFile(adopted.snapshotPath, "utf-8")
    ) as { snapshot: { tables: { name: string; localized?: boolean }[] } };
    const names = recorded.snapshot.tables.map(t => t.name);
    expect(names).toContain(LOCALIZED_TABLE);
    expect(names).not.toContain(`${LOCALIZED_TABLE}_locales`);

    // And the main table is marked localized. An introspected snapshot records
    // columns and nothing about localization, and `planCompanionMigrations`
    // treats a missing marker as unknown rather than inferring from shape — so
    // without this, later DISABLING localization emits only the column re-add
    // and leaves the translations unrestored, unarchived and the companion
    // undropped.
    const main = recorded.snapshot.tables.find(
      (t: { name: string }) => t.name === LOCALIZED_TABLE
    ) as { localized?: boolean } | undefined;
    expect(main?.localized).toBe(true);
  });

  it("records the companion columns the database has, not the ones config asks for", async () => {
    // The drift error walks an operator into editing config BEFORE adopting,
    // so the two disagreeing is the ordinary case rather than the exotic one.
    // A baseline states where the schema starts, so it has to state what is
    // actually there: recording a column the adopted database does not have
    // describes a database that never existed, and the next `migrate:create`
    // sees the companion already present and emits nothing to reconcile it.
    await runDbSync(h, localizedConfig);
    expect(await tableExists(h, `${LOCALIZED_TABLE}_locales`)).toBe(true);

    const adopted = await baselineCore({
      adapter: h.adapter,
      db: h.db,
      dialect: h.dialect,
      migrationsDir: h.migrationsDir,
      logger,
      // Config has moved on: `subtitle` is localized here but was never
      // pushed, so the live companion carries `title` alone.
      localizedEntities: [
        {
          slug: LOCALIZED_SLUG,
          tableName: LOCALIZED_TABLE,
          fields: [
            ...localizedConfig.collections[0].fields,
            text({ name: "subtitle", localized: true }),
          ],
          status: false,
          builtBy: "codeFirst" as const,
        },
      ],
      defaultLocale: "en",
    });
    if (adopted.kind !== "baselined") throw new Error("expected a baseline");

    const up = splitSqlStatements(
      parseSqlSections(await readFile(adopted.sqlPath, "utf-8")).upSql
    );
    const companion = up
      .filter(st => st.includes(`${LOCALIZED_TABLE}_locales`))
      .join("\n");

    expect(companion).toContain("title");
    expect(companion).not.toContain("subtitle");
    // Structure still comes from the production DDL builder — it is the only
    // source for a foreign key, which the snapshot model cannot express.
    expect(companion).toMatch(/ON DELETE CASCADE/i);

    // And the recorded localized columns match, since a later disable
    // restores, archives and drops exactly these.
    const recorded = JSON.parse(
      await readFile(adopted.snapshotPath, "utf-8")
    ) as {
      snapshot: { tables: { name: string; localizedColumns?: string[] }[] };
    };
    const main = recorded.snapshot.tables.find(t => t.name === LOCALIZED_TABLE);
    expect(main?.localizedColumns).toEqual(["title"]);
  });

  it("refuses to adopt a companion holding a column nothing describes", async () => {
    // The other direction, and it cannot be resolved by preferring either
    // side. A column standing in the database that no field describes has no
    // logical kind, and introspection recovers only the physical type — so the
    // companion cannot be rebuilt faithfully. Emitting it without the column
    // would produce a baseline whose fresh environments come up missing
    // translations, which is the failure this command exists to prevent.
    await runDbSync(h, localizedConfig);
    expect(await tableExists(h, `${LOCALIZED_TABLE}_locales`)).toBe(true);

    const refused = await baselineCore({
      adapter: h.adapter,
      db: h.db,
      dialect: h.dialect,
      migrationsDir: h.migrationsDir,
      logger,
      // `title` was removed from the config while its column, and whatever
      // translations it holds, are still in the database.
      localizedEntities: [
        {
          slug: LOCALIZED_SLUG,
          tableName: LOCALIZED_TABLE,
          fields: [text({ name: "summary", localized: true })],
          status: false,
          builtBy: "codeFirst" as const,
        },
      ],
      defaultLocale: "en",
    });

    expect(refused.kind).toBe("companion-mismatch");
    if (refused.kind !== "companion-mismatch") return;
    expect(refused.mismatches).toEqual([
      { table: `${LOCALIZED_TABLE}_locales`, columns: ["title"] },
    ]);

    // Nothing was written: a refusal that left a half-adopted history behind
    // would be worse than the state it refused. The directory is created by
    // the write itself, so its absence counts as empty.
    const files = await readdir(h.migrationsDir).catch(() => []);
    expect(files.filter(f => f.endsWith(".sql"))).toEqual([]);
  });

  it("rebuilds the same schema in an environment that has only the files", async () => {
    // The reason a baseline writes real SQL instead of a marker: a new
    // environment, a CI job, or `migrate:fresh` builds the schema from the
    // history alone. Nothing proved that until here — the other tests assert
    // what the file CONTAINS, and containing the right statements is not the
    // same as producing the right schema.
    //
    // So the baseline is applied to a second, empty database and the two are
    // introspected and compared. This is the assertion that was failing while
    // generated `CREATE TABLE` omitted primary keys entirely.
    await runDbSync(h, configV1);

    const adopted = await baselineCore({
      adapter: h.adapter,
      db: h.db,
      dialect: h.dialect,
      migrationsDir: h.migrationsDir,
      logger,
    });
    if (adopted.kind !== "baselined") throw new Error("expected a baseline");

    const source = await introspectLiveSnapshot(h.db, h.dialect, [TABLE]);
    const target = await makeHarness(h.dialect, "rebuilt");
    try {
      for (const stmt of splitSqlStatements(
        parseSqlSections(await readFile(adopted.sqlPath, "utf-8")).upSql
      )) {
        await (target.adapter as unknown as DrizzleAdapter).executeQuery(stmt);
      }

      const rebuilt = await introspectLiveSnapshot(target.db, target.dialect, [
        TABLE,
      ]);
      expect(rebuilt.tables).toEqual(source.tables);
      // Named explicitly as well, because a deep-equal of two snapshots that
      // both lost the key would still pass.
      expect(
        rebuilt.tables[0]?.columns.find(c => c.name === "id")?.primaryKey
      ).toBe(true);
    } finally {
      await target.dispose();
    }
  });

  it("keeps a relationship's junction table out of the snapshot but in the SQL", async () => {
    // A many-to-many field creates `<mainA>_<mainB>_<field>`, which carries the
    // managed prefix. Recorded in the snapshot, the next `migrate:create`
    // compares it against a desired snapshot that declares only collections,
    // singles and components, sees an extra table, and emits `DROP TABLE` —
    // silently destroying every relationship row on the graduation path.
    await runDbSync(h, configV1);
    const junction = `${TABLE}_${TABLE}_related`;
    await (h.adapter as unknown as DrizzleAdapter).executeQuery(
      `CREATE TABLE "${junction}" (a text NOT NULL, b text NOT NULL)`
    );

    const adopted = await baselineCore({
      adapter: h.adapter,
      db: h.db,
      dialect: h.dialect,
      migrationsDir: h.migrationsDir,
      logger,
      localizedEntities: configV1.collections.map(c => ({
        slug: c.slug,
        tableName: resolveCollectionTableName(c.slug),
        fields: c.fields,
        status: false,
        builtBy: "codeFirst" as const,
      })),
    });
    if (adopted.kind !== "baselined") throw new Error("expected a baseline");

    const recorded = JSON.parse(
      await readFile(adopted.snapshotPath, "utf-8")
    ) as { snapshot: { tables: { name: string }[] } };
    expect(recorded.snapshot.tables.map(t => t.name)).not.toContain(junction);

    // But a fresh environment still needs it, so it is in the SQL.
    const up = splitSqlStatements(
      parseSqlSections(await readFile(adopted.sqlPath, "utf-8")).upSql
    );
    expect(up.filter(st => st.includes(junction))).not.toEqual([]);

    // And the next migration still APPLIES. Excluding the junction from the
    // recorded snapshot is only half the job: `migrate`'s drift check builds
    // its own live snapshot, and if that one still contains the junction it
    // matches neither the baseline nor the target, so the first migration
    // after adoption stops with drift no migration could ever resolve.
    const delta = await runMigrateCreate(h, configV2, "add_subtitle");
    expect(delta).not.toBeNull();
    await expect(
      runFileMigrations({
        adapter: h.adapter,
        db: h.db,
        dialect: h.dialect,
        migrationsDir: h.migrationsDir,
        logger,
      })
    ).resolves.toBe(1);
    expect(await hasColumn(h, "subtitle")).toBe(true);
  });

  it("refuses to give a project that already migrated a second starting point", async () => {
    await runDbSync(h, configV1);
    await baselineCore({
      adapter: h.adapter,
      db: h.db,
      dialect: h.dialect,
      migrationsDir: h.migrationsDir,
      logger,
    });
    const afterFirst = await readdir(join(h.migrationsDir, "meta"));

    // Acceptance 3, in the form that can actually go wrong: a project with a
    // history is not re-baselined. A second origin would leave every later
    // diff depending on which one was read.
    const again = await baselineCore({
      adapter: h.adapter,
      db: h.db,
      dialect: h.dialect,
      migrationsDir: h.migrationsDir,
      logger,
    });
    expect(again.kind).toBe("already-baselined");
    expect(await readdir(join(h.migrationsDir, "meta"))).toEqual(afterFirst);
  });
}

describe("db:sync to migrations (sqlite)", () => runSuite("sqlite"));

describe.skipIf(!PG_URL)("db:sync to migrations (postgres)", () =>
  runSuite("postgresql")
);
