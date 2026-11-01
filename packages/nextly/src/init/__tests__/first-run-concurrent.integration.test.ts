/**
 * Several processes starting together on a database nothing has set up all come up, and the
 * database ends with every core table.
 *
 * The first start of each process probes for the events ledger and, finding none, creates the
 * whole core schema. Two app instances deployed at once, or an app starting beside `nextly
 * migrate`, both find it missing. The push creates its tables with a plain `CREATE TABLE`, so
 * without exclusion the second process to reach a table fails on it (`duplicate_table` on
 * PostgreSQL, `ER_TABLE_EXISTS_ERROR` on MySQL), and two processes that each won a different
 * table each stop part way, leaving the tables after that point to nobody.
 *
 * Each case starts several connections, each a session of its own as a separate process would
 * have, on a database of its own, and runs the first start on all of them at once, several rounds
 * over, so one lucky interleaving cannot pass it. PostgreSQL and MySQL only: SQLite's driver is
 * synchronous, so its connections in one process run one after another and cannot interleave,
 * and contention across processes there is `schema-lock.integration.test.ts`'s.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { getTableName, isTable } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  availableDialects,
  createScratchDatabase,
} from "../../__tests__/helpers/fresh-database";
import { getDialectTables } from "../../database/index";
import { loadDialectTables } from "../../database/dialect-tables";
import { ensureFirstRunSetup, firstStartSchemaLock } from "../first-run";

/** How many processes start together: enough that, unprotected, most rounds collide. */
const PROCESSES = 8;
/** Rounds, each on a database of its own. */
const ROUNDS = 3;

/** The servers this run can reach; each one not set up is skipped, never failed. */
const AVAILABLE = new Set(availableDialects());
const SERVER_DIALECTS = ["postgresql", "mysql"] as const;

/** What one process's first start reported, beside its result. */
interface Start {
  result: Awaited<ReturnType<typeof ensureFirstRunSetup>>;
  errors: string[];
}

async function connect(
  dialect: "postgresql" | "mysql",
  url: string
): Promise<DrizzleAdapter> {
  const adapter = (dialect === "postgresql"
    ? createPostgresAdapter({ url, pool: { max: 2 } })
    : createMySqlAdapter({
        url,
        pool: { max: 2 },
      })) as unknown as DrizzleAdapter;
  await adapter.connect();
  return adapter;
}

async function firstStart(adapter: DrizzleAdapter): Promise<Start> {
  const errors: string[] = [];
  const logger = {
    info: () => {},
    warn: () => {},
    error: (message: string) => errors.push(message),
  };
  const result = await ensureFirstRunSetup({
    adapter,
    logger,
    holdSchemaLock: firstStartSchemaLock(adapter, logger),
  });
  return { result, errors };
}

/** The core table names the push declares for this dialect. */
function coreTableNames(dialect: "postgresql" | "mysql"): string[] {
  return Object.values(getDialectTables(dialect))
    .filter(table => isTable(table))
    .map(table => getTableName(table))
    .sort();
}

describe.each(SERVER_DIALECTS)(
  "first start on a new database (%s)",
  dialect => {
    it.skipIf(!AVAILABLE.has(dialect))(
      "every process starting at once comes up, and one of them sets up every core table",
      async () => {
        await loadDialectTables(dialect);
        for (let round = 1; round <= ROUNDS; round++) {
          const scratch = await createScratchDatabase(
            dialect,
            "first_run_race"
          );
          const adapters: DrizzleAdapter[] = [];
          try {
            for (let i = 0; i < PROCESSES; i++) {
              adapters.push(await connect(dialect, scratch.url));
            }
            const starts = await Promise.all(adapters.map(firstStart));

            const failures = starts.flatMap(start => start.errors);
            expect(failures, `round ${round}`).toEqual([]);
            expect(
              starts.map(start => start.result.ranSetup).filter(Boolean),
              `round ${round}: exactly one process sets up`
            ).toHaveLength(1);
            expect(
              starts
                .map(start => start.result)
                .filter(result => !result.ranSetup)
                .map(result => (result.ranSetup ? null : result.reason)),
              `round ${round}: the rest find it set up`
            ).toEqual(Array(PROCESSES - 1).fill("already_initialized"));

            const live = new Set(await adapters[0].listTables());
            expect(
              coreTableNames(dialect).filter(name => !live.has(name)),
              `round ${round}: core tables missing`
            ).toEqual([]);
          } finally {
            for (const adapter of adapters) await adapter.disconnect();
            await scratch.drop();
          }
        }
      },
      180_000
    );
  }
);
