/**
 * A MySQL Single or field-group table created by the generator Nextly used before its tables came
 * from the schema pipeline holds a `text` field as TEXT, where the schema declares VARCHAR(255).
 * Every later apply proposes narrowing it, and this pins what each route does with that proposal:
 *
 * - `db:sync` (and the dev reload, which runs the same pipeline) narrows it without asking when
 *   every stored value fits, and refuses, naming the column, when one does not. Before, it asked
 *   in a terminal and failed without one, on every install with such a table.
 * - `migrate:baseline` records the column as TEXT, so the next `migrate:create` writes the
 *   narrowing into a file that `nextly migrate` runs unattended. `migrate` runs each file in
 *   strict mode, so on a server that is not in strict mode the value is kept and the migration
 *   fails, where before MySQL cut it to 255 characters with only a warning.
 *
 * MySQL only: PostgreSQL and SQLite tables were never created this way. Each run gets a database
 * of its own on the test server, because a baseline adopts every managed table it finds.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import mysql from "mysql2/promise";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { baselineCore } from "../../../../cli/commands/migrate-baseline";
import {
  syncCollections,
  syncComponents,
  syncSingles,
} from "../../../../cli/commands/dev-build";
import { ensureCoreTables } from "../../../../cli/commands/dev-server";
import {
  parseSqlSections,
  runFileMigrations,
  splitSqlStatements,
} from "../../../../cli/commands/migrate";
import type { CommandContext } from "../../../../cli/program";
import type { CLIDatabaseAdapter } from "../../../../cli/utils/adapter";
import type { LoadConfigResult } from "../../../../cli/utils/config-loader";
import { createLogger } from "../../../../cli/utils/logger";
import type { ResolvedDevOptions } from "../../../../cli/commands/db-sync";
import {
  defineConfig,
  defineFieldGroup,
  defineSingle,
  text,
} from "../../../../config";
import { getDialectTables } from "../../../../database/index";
import { createAdapter } from "../../../../database/factory";
import { SchemaRegistry } from "../../../../database/schema-registry";
import { clearCachedSnapshot } from "../../../../init/schema-snapshot-cache";
import { resolveSingleTableName } from "../../../singles/services/resolve-single-table-name";
import { toMinimalEntities } from "../../migrate-create/config-entities";
import { generateMigration } from "../../migrate-create/generate";
import { resolveComponentTableName } from "../../utils/resolve-table-name";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

/**
 * Runs just before the apply's pre-resolution DDL, after the classifier has counted: a write
 * landing here is the one a count alone cannot see. Unset, the executor runs as it is.
 */
let beforePreResolution: (() => Promise<void>) | undefined;
vi.mock("../pre-resolution/executor", async importOriginal => {
  const original =
    await importOriginal<typeof import("../pre-resolution/executor")>();
  return {
    ...original,
    executePreResolutionOps: async (
      ...args: Parameters<typeof original.executePreResolutionOps>
    ) => {
      const hook = beforePreResolution;
      beforePreResolution = undefined;
      await hook?.();
      return original.executePreResolutionOps(...args);
    },
  };
});

/**
 * Runs once the Single's column has been counted `afterCount.times` times: the classifier counts it
 * first and the pre-resolution pass again, so a write here on the second count is one neither saw.
 */
let afterCount: { times: number; run: () => Promise<void> } | undefined;
vi.mock("../classifier/count-helpers", async importOriginal => {
  const original =
    await importOriginal<typeof import("../classifier/count-helpers")>();
  let seen = 0;
  return {
    ...original,
    countLongerThan: async (
      ...args: Parameters<typeof original.countLongerThan>
    ) => {
      const n = await original.countLongerThan(...args);
      if (
        afterCount &&
        args[2] === SINGLE_TABLE &&
        ++seen === afterCount.times
      ) {
        const hook = afterCount;
        afterCount = undefined;
        seen = 0;
        await hook.run();
      }
      return n;
    },
  };
});

const MYSQL_URL = process.env.TEST_MYSQL_URL ?? "";
const describeMysql = describe.skipIf(!MYSQL_URL);

const RUN_ID = randomBytes(3).toString("hex");
const SINGLE_SLUG = `legacysite${RUN_ID}`;
const GROUP_SLUG = `legacyseo${RUN_ID}`;
const SINGLE_TABLE = resolveSingleTableName({ slug: SINGLE_SLUG });
const GROUP_TABLE = resolveComponentTableName(GROUP_SLUG);

const config = defineConfig({
  collections: [],
  singles: [
    defineSingle({ slug: SINGLE_SLUG, fields: [text({ name: "title" })] }),
  ],
  fieldGroups: [
    defineFieldGroup({
      slug: GROUP_SLUG,
      fields: [text({ name: "meta_title" })],
    }),
  ],
});

const logger = createLogger({ quiet: true });
const context = { logger, options: {} } as CommandContext;

interface Harness {
  adapter: CLIDatabaseAdapter;
  db: unknown;
  /** A connection of the test's own, for the fixture and for reading back. */
  root: mysql.Connection;
  dbName: string;
  url: string;
  migrationsDir: string;
  dispose: () => Promise<void>;
}

let seq = 0;

async function makeHarness(poolMax?: number): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "nextly-legacy-text-"));
  const dbName = `nextly_legacy_text_${RUN_ID}_${seq++}`;
  const server = new URL(MYSQL_URL);
  server.pathname = "/";
  const root = await mysql.createConnection(server.toString());
  await root.query(`CREATE DATABASE \`${dbName}\``);
  await root.query(`USE \`${dbName}\``);
  const url = new URL(MYSQL_URL);
  url.pathname = `/${dbName}`;
  process.env.DB_DIALECT = "mysql";
  process.env.DATABASE_URL = url.toString();
  const adapter = await createAdapter({
    type: "mysql",
    url: url.toString(),
    ...(poolMax === undefined ? {} : { pool: { max: poolMax } }),
  } as Parameters<typeof createAdapter>[0]);
  return {
    adapter: adapter as unknown as CLIDatabaseAdapter,
    db: (adapter as unknown as DrizzleAdapter).getDrizzle(),
    root,
    dbName,
    url: url.toString(),
    migrationsDir: join(dir, "migrations"),
    dispose: async () => {
      await adapter.disconnect();
      await root.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
      await root.end();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** What `nextly db:sync` runs, in its order, with no terminal attached. */
async function dbSync(h: Harness): Promise<void> {
  // The pipeline skips an apply whose desired schema it applied last; every call here is a run of
  // its own, against a database that changed underneath it.
  clearCachedSnapshot();
  const drizzleAdapter = h.adapter as unknown as DrizzleAdapter;
  const registry = new SchemaRegistry("mysql");
  registry.registerStaticSchemas(getDialectTables("mysql"));
  drizzleAdapter.setTableResolver(registry);
  const options = { cwd: "", autoSync: true } as ResolvedDevOptions;
  const configResult = { config } as LoadConfigResult;
  await ensureCoreTables(h.adapter, options, context);
  await syncCollections(configResult, h.adapter, options, context);
  await syncSingles(configResult, h.adapter, options, context);
  await syncComponents(configResult, h.adapter, options, context);
}

/**
 * The tables as the old generator left them: built by today's sync, then each `text` field's
 * column put back to the TEXT that generator gave it, holding a value of `length` characters.
 * The generator no longer exists to call, so its one difference is restated here, on the
 * test's own tables.
 */
async function legacyTables(h: Harness, length: number): Promise<void> {
  await dbSync(h);
  await h.root.query(
    `ALTER TABLE \`${SINGLE_TABLE}\` MODIFY COLUMN \`title\` TEXT NULL`
  );
  await h.root.query(
    `ALTER TABLE \`${GROUP_TABLE}\` MODIFY COLUMN \`meta_title\` TEXT NULL`
  );
  const value = "x".repeat(length);
  await h.root.query(
    `INSERT INTO \`${SINGLE_TABLE}\` (id, title, slug, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())`,
    [randomBytes(8).toString("hex"), value, SINGLE_SLUG]
  );
  await h.root.query(
    `INSERT INTO \`${GROUP_TABLE}\` (id, _parent_id, _parent_table, _parent_field, _order, _component_type, meta_title, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, NOW(), NOW())`,
    [
      randomBytes(8).toString("hex"),
      randomBytes(8).toString("hex"),
      SINGLE_TABLE,
      "seo",
      GROUP_SLUG,
      value,
    ]
  );
}

/** Each column's live type and the length of the value it holds. */
async function readBack(
  h: Harness
): Promise<{ title: [string, number]; metaTitle: [string, number] }> {
  const column = async (table: string, name: string) => {
    const [types] = (await h.root.query(
      `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [h.dbName, table, name]
    )) as unknown as [Array<{ t: string }>];
    const [lengths] = (await h.root.query(
      `SELECT CHAR_LENGTH(\`${name}\`) AS n FROM \`${table}\``
    )) as unknown as [Array<{ n: number }>];
    return [types[0]?.t, Number(lengths[0]?.n)] as [string, number];
  };
  return {
    title: await column(SINGLE_TABLE, "title"),
    metaTitle: await column(GROUP_TABLE, "meta_title"),
  };
}

/** `migrate:baseline`, then `migrate:create` as the CLI composes it, returning the UP statements. */
async function baselineThenCreate(h: Harness): Promise<string[]> {
  const adopted = await baselineCore({
    adapter: h.adapter,
    db: h.db,
    dialect: "mysql",
    migrationsDir: h.migrationsDir,
    logger,
  });
  expect(adopted.kind).toBe("baselined");
  const result = await generateMigration({
    name: "after_upgrade",
    dialect: "mysql",
    migrationsDir: h.migrationsDir,
    collections: [],
    singles: toMinimalEntities(config.singles ?? [], e =>
      resolveSingleTableName({ slug: e.slug, dbName: e.dbName })
    ),
    components: toMinimalEntities(config.fieldGroups ?? [], e =>
      resolveComponentTableName(e.slug)
    ),
    nonInteractive: true,
  });
  expect(result).not.toBeNull();
  const sql = await readFile(result!.sqlPath, "utf-8");
  return splitSqlStatements(parseSqlSections(sql).upSql, "mysql");
}

describeMysql("legacy MySQL TEXT columns on Singles and field groups", () => {
  let h: Harness;
  let previousDialect: string | undefined;
  let previousUrl: string | undefined;

  beforeEach(async () => {
    previousDialect = process.env.DB_DIALECT;
    previousUrl = process.env.DATABASE_URL;
    h = await makeHarness();
  });

  afterEach(async () => {
    await h.dispose();
    // Integration files share one fork, so an environment left set here would be read by every
    // file that follows.
    if (previousDialect === undefined) delete process.env.DB_DIALECT;
    else process.env.DB_DIALECT = previousDialect;
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  });

  it("db:sync narrows them with no terminal when every value fits, and keeps the values", async () => {
    await legacyTables(h, 255);

    await dbSync(h);

    expect(await readBack(h)).toEqual({
      title: ["varchar(255)", 255],
      metaTitle: ["varchar(255)", 255],
    });
  });

  it("db:sync refuses when a value is longer than the declared length, naming it, and changes nothing", async () => {
    await legacyTables(h, 300);

    await expect(dbSync(h)).rejects.toThrow(
      /cannot become varchar\(255\): 1 row\(s\) hold a value longer than 255 characters/
    );

    expect(await readBack(h)).toEqual({
      title: ["text", 300],
      metaTitle: ["text", 300],
    });
  });

  it("nextly migrate refuses the narrowing on a server that is not in strict mode, keeps the value, and restores the session", async () => {
    await legacyTables(h, 300);
    const up = await baselineThenCreate(h);
    expect(up.some(s => /MODIFY COLUMN `title` varchar\(255\)/i.test(s))).toBe(
      true
    );

    // One pooled connection, set to no strict mode, stands for a server configured that way: the
    // runner's transaction gets that connection, and the mode it is handed back with is readable.
    const lax = await createAdapter({
      type: "mysql",
      url: h.url,
      pool: { max: 1 },
    } as Parameters<typeof createAdapter>[0]);
    try {
      const laxDrizzle = lax as unknown as DrizzleAdapter;
      await laxDrizzle.executeQuery("SET SESSION sql_mode = ''");
      await expect(
        runFileMigrations({
          adapter: lax as unknown as CLIDatabaseAdapter,
          db: laxDrizzle.getDrizzle(),
          dialect: "mysql",
          migrationsDir: h.migrationsDir,
          logger,
        })
      ).rejects.toThrow(/Data too long/);
      const [mode] = await laxDrizzle.executeQuery<{ mode: string }>(
        "SELECT @@SESSION.sql_mode AS mode"
      );
      expect(mode.mode).toBe("");
    } finally {
      await lax.disconnect();
    }

    expect(await readBack(h)).toEqual({
      title: ["text", 300],
      metaTitle: ["text", 300],
    });
  });

  it("nextly migrate refuses the narrowing on a strict server", async () => {
    await legacyTables(h, 300);
    await baselineThenCreate(h);

    await expect(
      runFileMigrations({
        adapter: h.adapter,
        db: h.db,
        dialect: "mysql",
        migrationsDir: h.migrationsDir,
        logger,
      })
    ).rejects.toThrow(/Data too long/);

    expect(await readBack(h)).toEqual({
      title: ["text", 300],
      metaTitle: ["text", 300],
    });
  });

  /** Both pooled connections without strict mode, standing for a server configured that way. */
  async function laxPool(): Promise<void> {
    // Two transactions held open at once take one connection each, and the adapter puts back only
    // a setting it changed itself, so each keeps the mode set here.
    const drizzleAdapter = h.adapter as unknown as DrizzleAdapter;
    let release!: () => void;
    const held = new Promise<void>(resolve => (release = resolve));
    let entered = 0;
    const laxen = () =>
      drizzleAdapter.transaction(async ctx => {
        await ctx.execute("SET SESSION sql_mode = ''");
        if (++entered === 2) release();
        await held;
      });
    await Promise.all([laxen(), laxen()]);
  }

  const writeLongTitle = async () => {
    await h.root.query(`UPDATE \`${SINGLE_TABLE}\` SET title = ?`, [
      "y".repeat(300),
    ]);
  };

  it("db:sync refuses a long value written after the classifier's count, before any DDL, naming it", async () => {
    await h.dispose();
    h = await makeHarness(2);
    await legacyTables(h, 255);
    await laxPool();
    beforePreResolution = writeLongTitle;

    await expect(dbSync(h)).rejects.toThrow(
      /cannot become varchar\(255\): 1 row\(s\) hold a value longer than 255/
    );

    expect((await readBack(h)).title).toEqual(["text", 300]);
  });

  it("db:sync refuses, rather than cuts, a long value written after its last count, on a server that is not in strict mode", async () => {
    await h.dispose();
    h = await makeHarness(2);
    await legacyTables(h, 255);
    await laxPool();
    afterCount = { times: 2, run: writeLongTitle };

    // The driver's error names the statement it refused; MySQL's reason, "Data too long", is its
    // cause. What separates this from an unguarded apply is that the apply fails at all.
    await expect(dbSync(h)).rejects.toThrow(
      /MODIFY COLUMN `title` varchar\(255\)/
    );

    expect((await readBack(h)).title).toEqual(["text", 300]);
  });
});
