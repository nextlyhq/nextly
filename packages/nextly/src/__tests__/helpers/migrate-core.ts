/**
 * `nextly migrate` without its command-line shell, for the upgrade tests: the
 * same `migrateCore` the CLI and both boot paths call, under its lock, with an
 * app that has no migration files of its own.
 *
 * @module __tests__/helpers/migrate-core
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrateCore } from "../../cli/commands/migrate";
import { getSchemaEventsDdl } from "../../domains/schema/events/schema-events-ddl";

import type { FreshDatabase } from "./fresh-database";

/** A logger for `migrateCore` that prints nothing. */
const silent = {
  header: () => {},
  info: () => {},
  success: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  keyValue: () => {},
  divider: () => {},
  newline: () => {},
  item: () => {},
  table: () => {},
  spinner: () => ({ stop: () => {} }),
  setOptions: () => {},
  getOptions: () => ({}),
} as unknown as Parameters<typeof migrateCore>[0]["logger"];

/**
 * An empty migrations directory, so only the core phase has work to do, and
 * its removal for the suite's `afterAll`.
 */
export function noMigrationsDir(prefix: string): {
  dir: string;
  remove: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Run the core migration against `fresh`. Reports whether the core phase
 * changed anything.
 */
export async function migrateFresh(
  fresh: FreshDatabase,
  migrationsDir: string
): Promise<boolean> {
  const { coreChanged } = await migrateCore({
    // A config that declares no schema hooks: the run is core-only.
    extensionSchema: undefined,
    dialect: fresh.dialect,
    db: fresh.db,
    // A wrapper carrying the one raw-statement method the core phase needs.
    adapter: {
      dialect: fresh.dialect,
      connect: () => Promise.resolve(),
      disconnect: () => Promise.resolve(),
      isConnected: () => true,
      getCapabilities: () => ({ dialect: fresh.dialect }),
      executeQuery: (statement: string) => fresh.exec(statement),
    } as unknown as Parameters<typeof migrateCore>[0]["adapter"],
    migrationsDir,
    logger: silent,
    lockMode: "fail-fast",
    // The schema lock needs a whole adapter, which this raw-statement wrapper is not, and it is
    // exercised against real databases in its own suites; here it runs the work as given.
    withLock: async (_adapter, _dialect, fn) => ({
      ran: true,
      value: await fn(),
    }),
    // How the CLI bootstraps the ledger: only when it is absent.
    ensureLedger: async () => {
      if ((await fresh.columnsOf("nextly_schema_events")).length > 0) return;
      for (const statement of getSchemaEventsDdl(fresh.dialect)) {
        await fresh.exec(statement);
      }
    },
  });
  return coreChanged;
}
