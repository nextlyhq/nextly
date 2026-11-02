/**
 * `nextly migrate:resolve` works on a database whose field-group lock row is not yet seeded.
 *
 * The command opens its database through `createCliAdapter` and installs no table resolver of its
 * own. The schema lock it takes seeds the field-group lock row through the adapter's transaction
 * `insert`, which writes only to a table the adapter's resolver holds — so the command depends on
 * the adapter `createCliAdapter` hands it resolving that table. Driven through the command itself
 * (`runMigrateResolve`), never with an adapter the test wired, so the resolver asserted is the one
 * the command got. On every configured dialect, each on a database of its own.
 *
 * Only the config file is not read from disk: the loader is handed a config naming the
 * migrations directory.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureSchemaEventsTable } from "../../../domains/schema/events/schema-events-ddl";
import {
  LOCK_DIALECTS,
  lockWorld,
  type LockWorld,
} from "../../../domains/schema/pipeline/__tests__/helpers/schema-lock-world";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrateResolve } from "../migrate-resolve";

vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({
    config: { db: { migrationsDir: "migrations" } },
    dependencies: [],
  }),
}));

const FILE = "20261030_000001_rsfl_items";

/** The one row the field-group lock contends for, as a raw count. */
async function lockRows(adapter: DrizzleAdapter): Promise<number> {
  const rows = (await adapter.executeQuery(
    "SELECT COUNT(*) AS n FROM nextly_field_group_lock WHERE id = 1"
  )) as Array<{ n: unknown }>;
  return Number(rows[0]?.n ?? 0);
}

/** The ledger's applied rows for `FILE`, as a raw count. */
async function appliedRows(adapter: DrizzleAdapter): Promise<number> {
  const rows = (await adapter.executeQuery(
    `SELECT COUNT(*) AS n FROM nextly_schema_events WHERE filename = '${FILE}.sql' AND status = 'applied'`
  )) as Array<{ n: unknown }>;
  return Number(rows[0]?.n ?? 0);
}

describe.each(LOCK_DIALECTS)("migrate:resolve on %s", dialect => {
  let world: LockWorld;
  let adapter: DrizzleAdapter;
  let dir: string;
  let previousDialect: string | undefined;
  let previousUrl: string | undefined;

  beforeEach(async () => {
    world = await lockWorld(dialect, { fresh: true });
    adapter = await world.connect();
    // No lock table at all, so no lock row: what a database that never took the lock has.
    await world.reset(adapter);
    await ensureSchemaEventsTable(adapter);

    dir = mkdtempSync(join(tmpdir(), "nextly-resolve-lock-row-"));
    mkdirSync(join(dir, "migrations"));
    writeFileSync(
      join(dir, "migrations", `${FILE}.sql`),
      `-- Migration: ${FILE}\n\n-- UP\nCREATE TABLE rsfl_items (id varchar(36) PRIMARY KEY);\n\n-- DOWN\nDROP TABLE rsfl_items;\n`,
      "utf8"
    );

    previousDialect = process.env.DB_DIALECT;
    previousUrl = process.env.DATABASE_URL;
    process.env.DB_DIALECT = dialect;
    process.env.DATABASE_URL =
      dialect === "sqlite" ? `file:${world.url}` : world.url;
    _resetEnvCache();
  }, 60_000);

  afterEach(async () => {
    if (previousDialect === undefined) delete process.env.DB_DIALECT;
    else process.env.DB_DIALECT = previousDialect;
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    _resetEnvCache();
    await adapter.disconnect();
    rmSync(dir, { recursive: true, force: true });
    await world.dispose();
  }, 60_000);

  it("seeds the field-group lock row and records the migration applied", async () => {
    expect(await adapter.tableExists("nextly_field_group_lock")).toBe(false);

    const said: string[] = [];
    const base = createLogger({ quiet: true });
    const context = {
      logger: {
        ...base,
        success: (message: string) => {
          said.push(message);
        },
      },
      options: {},
    } as CommandContext;

    await runMigrateResolve(
      { applied: FILE, skipVerify: true, cwd: dir },
      context
    );

    expect(said).toEqual([`Marked ${FILE} as applied.`]);
    expect(await appliedRows(adapter)).toBe(1);
    expect(await lockRows(adapter)).toBe(1);
  }, 90_000);
});
