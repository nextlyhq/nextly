/**
 * An adapter double that models the migration lock rather than accepting writes.
 *
 * The lock is a read-modify-write over one row, so a double that let every claim
 * succeed would certify exclusion that does not exist — and a double missing a
 * method makes every caller look refused, which is just as misleading. Statements
 * are compiled through a real dialect so this interprets the SQL and bound
 * parameters an adapter would hand its driver.
 *
 * Shared because two suites need it: the session's own tests, and the reload path
 * that now holds the same lock.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SQL } from "drizzle-orm";

import {
  createLockRow,
  createLockStatementReader,
  type LockClock,
} from "./migration-lock-double";

export interface LockingAdapterOptions {
  /** Marker value the `nextly_meta` read returns, or `undefined` for none. */
  marker?: unknown;
  /** Pre-existing claim, so the lock reads as held. */
  heldBy?: string | null;
  /** Whether the lock table exists. */
  lockTableExists?: boolean;
  /**
   * Companion `_locales` tables that physically exist.
   *
   * The runtime decides a companion is there by probing it and treating a missing-table error as
   * the answer, so a double that resolves every statement reports a companion for every entity —
   * and certifies restore and seeding paths that would never run against a database without one.
   * Empty by default, which is what a fixture that never created a companion actually has.
   */
  companionTables?: readonly string[];
  /** The database's clock, so a suite can let a seeded claim lapse, and that claim's expiry. */
  clock?: LockClock;
  expiresAt?: number | null;
  /**
   * Thrown by the liveness read only, leaving every other statement working.
   *
   * Models a lock table created before `expires_at` existed: the row is there and seeds fine, and
   * only the query selecting that column fails. Applied on the transaction path as well as the
   * adapter one, because a column that is absent is absent for every reader — a fixture failing
   * just one of them lets acquisition succeed and certifies the outcome the code exists to prevent.
   */
  stateReadError?: unknown;
}

/** The probe {@link createLockingAdapter} has to answer honestly. */
const COMPANION_PROBE = /^SELECT 1 FROM ["`](\w+_locales)["`] LIMIT 0$/;

export function createLockingAdapter(options: LockingAdapterOptions = {}) {
  const lock = createLockRow(options.heldBy, {
    clock: options.clock,
    expiresAt: options.expiresAt,
  });
  const ddl: string[] = [];

  // The lock's own semantics live in one place, shared with the surface that adds them to other
  // suites' doubles. Two interpreters of the same statements would agree the day they were written
  // and drift silently afterwards, because each looks correct read on its own.
  const interpret = createLockStatementReader(lock, options);

  const adapter = {
    dialect: "postgresql" as const,
    getCapabilities: () => ({ dialect: "postgresql" }),
    getDrizzle: () => ({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve(
                options.marker === undefined
                  ? []
                  : [{ key: "k", value: JSON.stringify(options.marker) }]
              ),
          }),
        }),
      }),
    }),
    executeQuery: (sql: string) => {
      const probed = COMPANION_PROBE.exec(sql.replace(/\s+/g, " ").trim());
      if (probed && !(options.companionTables ?? []).includes(probed[1])) {
        // The shape the runtime's missing-table matcher looks for, in this double's own dialect.
        return Promise.reject(new Error(`no such table: ${probed[1]}`));
      }
      ddl.push(sql);
      return Promise.resolve([]);
    },
    queryStatement: (statement: SQL) => Promise.resolve(interpret(statement)),
    tableExists: (name: string) =>
      Promise.resolve(
        name === "nextly_field_group_lock"
          ? (options.lockTableExists ?? true)
          : true
      ),
    transaction: (work: (ctx: unknown) => Promise<unknown>) =>
      work({
        lockRow: () => Promise.resolve(undefined),
        insert: (_table: string, data: { owner: string | null }) => {
          lock.seeded = true;
          lock.owner = data.owner;
          // The seed names no expiry, so the column takes its default.
          lock.expiresAt = null;
          return Promise.resolve(data);
        },
        runStatement: (statement: SQL) => {
          interpret(statement);
          return Promise.resolve();
        },
        queryStatement: (statement: SQL) =>
          Promise.resolve(interpret(statement)),
      }),
  } as unknown as DrizzleAdapter;

  return {
    adapter,
    ownerNow: () => lock.owner,
    expiresAtNow: () => lock.expiresAt,
    clock: lock.clock,
    ddlIssued: () => [...ddl],
  };
}
