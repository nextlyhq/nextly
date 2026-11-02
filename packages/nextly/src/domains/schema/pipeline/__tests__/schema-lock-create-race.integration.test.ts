/**
 * Runs that start together on a database no run has touched all create the lock tables at once.
 *
 * On PostgreSQL `CREATE TABLE IF NOT EXISTS` is not safe against itself: of two sessions creating
 * one table together, the second can fail with `duplicate_table`, `duplicate_object` (the table's
 * row type) or a unique violation on a catalog index. Each case here starts several connections,
 * each a session of its own, creating together, for every lock table and then through the lock
 * itself, and asserts that all of them succeed. MySQL is expected to pass without any tolerance
 * (its `IF NOT EXISTS` holds a metadata lock on the name), and this shows that it does.
 *
 * SQLite's driver is synchronous, so its sessions in one process run their statements one after
 * another and the creation case there shows only that the helper works on it; SQLite's own write
 * lock is what makes `IF NOT EXISTS` safe across processes. The case through the lock runs on the
 * servers only: SQLite connections in one process waiting on each other block the event loop the
 * holder needs, and contention across processes there is `schema-lock.integration.test.ts`'s.
 *
 * Each dialect runs on a database of its own, so the tables start absent.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { createTableIfAbsent } from "../../../../database/concurrent-create";
import {
  getMigrationLockDdl,
  MIGRATION_LOCK_TABLE,
} from "../../../field-groups/migration/session";
import {
  EARLIER_MIGRATE_LOCK_TABLE,
  getEarlierMigrateLockDdl,
  getSchemaLockDdl,
  SCHEMA_LOCK_TABLE,
  withSchemaLock,
} from "../schema-lock";

import {
  LOCK_DIALECTS,
  lockWorld,
  sleep,
  type LockWorld,
} from "./helpers/schema-lock-world";

/** How many sessions create together: enough that, unprotected, PostgreSQL fails most rounds. */
const SESSIONS = 8;
/** Rounds per table, each from a dropped table, so one lucky interleaving cannot pass the case. */
const ROUNDS = 5;

const quiet = { warn: () => {}, info: () => {} };

describe.each(LOCK_DIALECTS)("creating the lock tables on %s", dialect => {
  let world: LockWorld;
  let adapters: DrizzleAdapter[];

  beforeEach(async () => {
    world = await lockWorld(dialect, { fresh: true });
    adapters = [];
    for (let i = 0; i < SESSIONS; i++) {
      adapters.push(await world.connect({ poolMax: 2 }));
    }
    await world.reset(adapters[0]);
  });

  afterEach(async () => {
    await world.reset(adapters[0]);
    for (const adapter of adapters) await adapter.disconnect();
    await world.dispose();
  });

  /** Every lock table this dialect creates, with the production DDL that creates it. */
  const lockTables: ReadonlyArray<readonly [string, string[]]> = [
    [SCHEMA_LOCK_TABLE, getSchemaLockDdl(dialect)],
    [MIGRATION_LOCK_TABLE, getMigrationLockDdl(dialect)],
    ...(dialect === "postgresql"
      ? [
          [
            EARLIER_MIGRATE_LOCK_TABLE,
            getEarlierMigrateLockDdl(dialect),
          ] as const,
        ]
      : []),
  ];

  it.each(lockTables)(
    "%s: every session creating it at once succeeds, and one table results",
    async (table, ddl) => {
      for (let round = 0; round < ROUNDS; round++) {
        await adapters[0].executeQuery(`DROP TABLE IF EXISTS ${table}`);
        const results = await Promise.allSettled(
          adapters.map(async adapter => {
            for (const statement of ddl) {
              await createTableIfAbsent(adapter, dialect, table, statement);
            }
          })
        );
        const failures = results.flatMap(result =>
          result.status === "rejected" ? [String(result.reason)] : []
        );
        expect(failures, `round ${round + 1}`).toEqual([]);
        const tables = await adapters[0].listTables();
        expect(tables.filter(name => name === table)).toEqual([table]);
      }
    },
    60_000
  );

  it.skipIf(dialect === "sqlite")(
    "runs started together on a fresh database all take the lock, one at a time",
    async () => {
      let inside = 0;
      let mostInside = 0;
      const runs = adapters.map((adapter, index) =>
        withSchemaLock(
          {
            adapter,
            command: `nextly migrate #${index}`,
            whenHeld: "wait",
            waitMs: 45_000,
            pollMs: 100,
            logger: quiet,
          },
          async () => {
            inside++;
            mostInside = Math.max(mostInside, inside);
            await sleep(20);
            inside--;
            return index;
          }
        )
      );
      const results = await Promise.allSettled(runs);
      const failures = results.flatMap(result =>
        result.status === "rejected" ? [String(result.reason)] : []
      );
      expect(failures).toEqual([]);
      expect(
        results.map(result =>
          result.status === "fulfilled" ? result.value : undefined
        )
      ).toEqual(adapters.map((_, index) => ({ ran: true, value: index })));
      expect(mostInside).toBe(1);
    },
    60_000
  );
});
