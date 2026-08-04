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
import { join } from "node:path";

import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineCollection, defineConfig, text } from "../../../config";
import { getDialectTables } from "../../../database/index";
import { createAdapter } from "../../../database/factory";
import { SchemaRegistry } from "../../../database/schema-registry";
import { getSchemaEventsDdl } from "../../../domains/schema/events/schema-events-ddl";
import { clearCachedSnapshot } from "../../../init/schema-snapshot-cache";
import { toMinimalEntities } from "../../../domains/schema/migrate-create/config-entities";
import { generateMigration } from "../../../domains/schema/migrate-create/generate";
import { resolveCollectionTableName } from "../../../domains/schema/utils/resolve-table-name";
import { createLogger } from "../../utils/logger";
import { baselineCore } from "../migrate-baseline";
import { syncCollections } from "../dev-build";
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

/** Unique per run so a leftover database from a crashed run is never reused. */
const RUN_ID = randomBytes(8).toString("hex");

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
async function makeHarness(dialect: SupportedDialect): Promise<Harness> {
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

  const dbName = `nextly_baseline_${RUN_ID}`;
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
  // The ledger is bootstrapped out of band by `migrate` Phase 1, which has not
  // run yet at this point in a db:sync project's life.
  for (const stmt of getSchemaEventsDdl(h.dialect)) {
    await drizzleAdapter.executeQuery(stmt);
  }

  await syncCollections(
    { config } as LoadConfigResult,
    h.adapter,
    options,
    context
  );
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
