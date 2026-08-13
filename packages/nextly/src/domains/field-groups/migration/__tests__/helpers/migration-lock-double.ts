/**
 * The migration lock, as an in-memory double that can be added to an existing adapter double.
 *
 * A Schema Builder change now runs inside the storage migration's lock, so every suite that drives
 * one of those services through a double reaches the lock's reads and writes — even suites whose
 * subject is the entity DDL and nothing else. Two ways of answering that are wrong in opposite
 * directions, and this exists to avoid both. A double missing the methods makes every schema change
 * look broken, which is what happens today. A double that resolves everything makes every claim
 * succeed, which certifies exclusion that is not there.
 *
 * So the lock is modelled rather than stubbed: one row, claimed by whoever finds it free, refused to
 * everyone else. Statements are compiled through a real dialect, so this reads the SQL and the bound
 * parameters an adapter would hand its driver rather than a shape agreed between test and helper.
 *
 * Shared, and shaped as an ADDITION to a double rather than a replacement for one, because the
 * suites that need it already model their own entity's surface and have nothing to gain by
 * re-modelling it here.
 */
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { MIGRATION_LOCK_TABLE } from "../../session";

/** The single row the lock is: whether it has been seeded at all, and who holds it. */
export interface LockRow {
  seeded: boolean;
  owner: string | null;
}

/**
 * `heldBy` absent means the row has never been seeded, which is what a database that has never run
 * a migration has. Passing `null` seeds it free, and a string seeds it held by someone else.
 */
export function createLockRow(heldBy?: string | null): LockRow {
  return { seeded: heldBy !== undefined, owner: heldBy ?? null };
}

const SELECT_OWNER =
  /^SELECT "\w+" FROM "nextly_field_group_lock" WHERE "id" = \$1$/;
const CLAIM =
  /^UPDATE "nextly_field_group_lock" SET "owner" = \$1 WHERE "id" = \$2$/;
const RELEASE =
  /^UPDATE "nextly_field_group_lock" SET "owner" = NULL WHERE "id" = \$1 AND "owner" = \$2$/;

/**
 * Apply one statement to the lock row and answer as the database would.
 *
 * Unrecognised statements throw rather than resolving empty. A lock read that quietly returned no
 * rows would be indistinguishable from an unseeded row, so a change to the statements this module
 * issues would silently start certifying the wrong state instead of failing here.
 */
export function interpretLockStatement(
  lock: LockRow,
  statement: SQL
): Record<string, unknown>[] {
  const { sql: text, params } = new PgDialect().sqlToQuery(statement);
  const flat = text.replace(/\s+/g, " ").trim();

  if (SELECT_OWNER.test(flat)) {
    return lock.seeded ? [{ id: 1, owner: lock.owner }] : [];
  }
  if (CLAIM.test(flat)) {
    // An occupied row refuses a new claim, exactly as the real one does.
    if (lock.owner === null) lock.owner = params[0] as string | null;
    return [];
  }
  if (RELEASE.test(flat)) {
    if (lock.owner === params[1]) lock.owner = null;
    return [];
  }
  throw new Error(`unrecognised statement: ${flat}`);
}

/**
 * Whether a statement belongs to the lock rather than to the entity under test.
 *
 * Exported because the suites need it: taking the lock issues `CREATE TABLE IF NOT EXISTS` for the
 * lock's own table, so a schema change that executes no DDL of its own no longer executes nothing
 * at all. Asked in one place so a suite asserting "this path issued no DDL" keeps saying that, and
 * keeps saying it accurately, rather than each suite carrying its own idea of what to ignore.
 */
export function isMigrationLockStatement(sql: string): boolean {
  return sql.includes(MIGRATION_LOCK_TABLE);
}

export interface MigrationLockSurfaceOptions {
  /**
   * The `nextly_meta` migration marker the exclusion reads after taking the lock, or absent for a
   * database with no run recorded — which is the state a schema change is expected to proceed from.
   */
  marker?: unknown;
  /** A claim already in the row, so the lock reads as held by another run. */
  heldBy?: string | null;
  /** Whether the lock table is already there. */
  lockTableExists?: boolean;
}

/** The adapter methods this composes with; anything else the double declares is carried through. */
interface AdapterDoubleBase {
  tableExists: (name: string) => Promise<boolean>;
  getDrizzle?: () => Record<string, unknown>;
}

/**
 * Add the lock's surface to an adapter double.
 *
 * `tableExists` is wrapped so the lock table answers from this helper and every other name still
 * answers from the double, whose own answer is usually load-bearing. `getDrizzle` is EXTENDED
 * rather than replaced, because the marker read is one call among several a double may already
 * serve through it.
 *
 * `executeQuery` is deliberately left alone. The lock's DDL is real DDL and belongs in whatever the
 * double records, so a suite can see that taking the lock created a table; {@link
 * isMigrationLockStatement} is how a suite separates that from its own. Absorbing it here would
 * hide a schema change the services now make on every call.
 */
export function withMigrationLockSurface<T extends AdapterDoubleBase>(
  base: T,
  options: MigrationLockSurfaceOptions = {}
): T & {
  queryStatement: (statement: SQL) => Promise<Record<string, unknown>[]>;
  transaction: (work: (ctx: unknown) => Promise<unknown>) => Promise<unknown>;
  migrationLock: { ownerNow: () => string | null };
} {
  const lock = createLockRow(options.heldBy);

  const readMarker = (): Promise<Record<string, unknown>[]> =>
    Promise.resolve(
      options.marker === undefined
        ? []
        : [{ key: "k", value: JSON.stringify(options.marker) }]
    );

  return {
    ...base,
    tableExists: (name: string) =>
      name === MIGRATION_LOCK_TABLE
        ? Promise.resolve(options.lockTableExists ?? true)
        : base.tableExists(name),
    getDrizzle: () => ({
      ...(base.getDrizzle?.() ?? {}),
      select: () => ({
        from: () => ({ where: () => ({ limit: readMarker }) }),
      }),
    }),
    queryStatement: (statement: SQL) =>
      Promise.resolve(interpretLockStatement(lock, statement)),
    transaction: (work: (ctx: unknown) => Promise<unknown>) =>
      work({
        lockRow: () => Promise.resolve(undefined),
        insert: (_table: string, data: { owner: string | null }) => {
          lock.seeded = true;
          lock.owner = data.owner;
          return Promise.resolve(data);
        },
        runStatement: (statement: SQL) => {
          interpretLockStatement(lock, statement);
          return Promise.resolve();
        },
        queryStatement: (statement: SQL) =>
          Promise.resolve(interpretLockStatement(lock, statement)),
      }),
    migrationLock: { ownerNow: () => lock.owner },
  };
}
