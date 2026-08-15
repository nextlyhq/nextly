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

import { NextlyError } from "../../../../../errors/nextly-error";
import { MIGRATION_LOCK_TABLE } from "../../session";

/**
 * The database's clock, in seconds, under the test's control.
 *
 * 🔴 A model clock rather than the real one, and that is the whole reason this can test expiry at
 * all. The session asks the DATABASE for the time in every statement it issues, so the model has to
 * own a clock for the same reason the database does — and a test that had to wait two minutes for a
 * claim to lapse would simply never be written. Advancing it is the only way time passes here, so
 * every liveness outcome in a suite is one the test asked for rather than one the machine happened
 * to produce.
 */
export interface LockClock {
  now: () => number;
  /** Move the database's clock forward, so live claims can genuinely lapse. */
  advance: (seconds: number) => void;
}

/** Starts at a fixed instant: a model whose results depend on when it ran is not a model. */
export function createLockClock(startSeconds = 1_000_000): LockClock {
  let current = startSeconds;
  return {
    now: () => current,
    advance: (seconds: number) => {
      current += seconds;
    },
  };
}

/** The single row the lock is: whether it has been seeded at all, who holds it, and until when. */
export interface LockRow {
  seeded: boolean;
  owner: string | null;
  /**
   * When this claim lapses, on {@link LockRow.clock}'s scale, or `null` for a claim that never does.
   *
   * `null` is the row a release before this column existed left behind, and the session treats it as
   * LIVE. Modelled rather than normalised away, because "an old row blocks forever" is the
   * behaviour, and a double that quietly expired it would certify a takeover the real lock refuses.
   */
  expiresAt: number | null;
  readonly clock: LockClock;
}

export interface LockRowOptions {
  /** Shared with the suite so a test can advance it; its own by default. */
  clock?: LockClock;
  /** The seeded claim's expiry. Absent means `null`, which the session reads as never expiring. */
  expiresAt?: number | null;
}

/**
 * `heldBy` absent means the row has never been seeded, which is what a database that has never run
 * a migration has. Passing `null` seeds it free, and a string seeds it held by someone else.
 */
export function createLockRow(
  heldBy?: string | null,
  options: LockRowOptions = {}
): LockRow {
  return {
    seeded: heldBy !== undefined,
    owner: heldBy ?? null,
    expiresAt: options.expiresAt ?? null,
    clock: options.clock ?? createLockClock(),
  };
}

/** Whether the claim in the row would still exclude a contender, on the model's clock. */
export function isClaimLive(lock: LockRow): boolean {
  return (
    lock.owner !== null &&
    (lock.expiresAt === null || lock.expiresAt > lock.clock.now())
  );
}

/**
 * Whether the claim would still be there when its next renewal falls due.
 *
 * The stricter of the two questions the real statement answers: a lease can be live at the instant
 * it is read and gone before anything renews it, so a claimant needs this one rather than
 * {@link isClaimLive}. The margin is READ FROM THE STATEMENT rather than restated here — a copy
 * would keep agreeing with the session's constant right up until someone retuned it.
 */
export function isClaimUsable(lock: LockRow, marginSeconds: number): boolean {
  return (
    lock.owner !== null &&
    (lock.expiresAt === null ||
      lock.expiresAt > lock.clock.now() + marginSeconds)
  );
}

// Built from the constant rather than spelled out, so a rename of the table moves these with it.
const TABLE = MIGRATION_LOCK_TABLE;

/** Each dialect's word for "now", as the session compiles it. */
const NOW = String.raw`(?:clock_timestamp\(\)|UTC_TIMESTAMP\(\)|unixepoch\(\))`;

/**
 * Each dialect's expiry expression, capturing the placeholder that carries the TTL.
 *
 * The TTL is read from the BOUND PARAMETER rather than imported from the session, so the model
 * applies the number the statement actually carried. Importing the constant would agree with a
 * statement that had stopped binding it at all.
 */
const EXPIRY = String.raw`(?:clock_timestamp\(\) \+ make_interval\(secs => \$(?<ttlPg>\d+)\)|DATE_ADD\(UTC_TIMESTAMP\(\), INTERVAL \$(?<ttlMysql>\d+) SECOND\)|unixepoch\(\) \+ \$(?<ttlSqlite>\d+))`;

const LOCK_STATE = new RegExp(
  String.raw`^SELECT "owner", CASE WHEN "owner" IS NOT NULL AND \("expires_at" IS NULL OR "expires_at" > ${NOW}\) THEN 1 ELSE 0 END AS "live", CASE WHEN "owner" IS NOT NULL AND \("expires_at" IS NULL OR "expires_at" > ${EXPIRY}\) THEN 1 ELSE 0 END AS "usable" FROM "${TABLE}" WHERE "id" = \$\d+$`
);
const ROW_EXISTS = new RegExp(
  String.raw`^SELECT "id" FROM "${TABLE}" WHERE "id" = \$\d+$`
);
const CLAIM = new RegExp(
  String.raw`^UPDATE "${TABLE}" SET "owner" = \$(?<claim>\d+), "expires_at" = ${EXPIRY} WHERE "id" = \$\d+$`
);
const RENEW = new RegExp(
  String.raw`^UPDATE "${TABLE}" SET "expires_at" = ${EXPIRY} WHERE "id" = \$\d+ AND "owner" = \$(?<owner>\d+)$`
);
const RELEASE = new RegExp(
  String.raw`^UPDATE "${TABLE}" SET "owner" = NULL, "expires_at" = NULL WHERE "id" = \$\d+ AND "owner" = \$(?<owner>\d+)$`
);

type Groups = Record<string, string | undefined> | undefined;

/** The statements this module issues, named. */
export type LockStatementKind =
  | "exists"
  | "state"
  | "claim"
  | "renew"
  | "release";

/**
 * What a statement IS, separately from what it DOES.
 *
 * One matcher for both questions. A suite that needs to observe a particular statement — count the
 * reads, fail only the renewal — asks this rather than carrying a regex of its own, so there is
 * exactly one place that can be wrong about which statement is which.
 */
function matchLockStatement(
  flat: string
): { kind: LockStatementKind; groups: Groups } | undefined {
  for (const [kind, pattern] of [
    ["exists", ROW_EXISTS],
    ["state", LOCK_STATE],
    ["claim", CLAIM],
    ["renew", RENEW],
    ["release", RELEASE],
  ] as const) {
    const match = pattern.exec(flat);
    if (match) return { kind, groups: match.groups };
  }
  return undefined;
}

/** Compile a statement and say which of the lock's statements it is, if any. */
export function classifyLockStatement(
  statement: SQL
): LockStatementKind | undefined {
  const { sql: text } = new PgDialect().sqlToQuery(statement);
  return matchLockStatement(text.replace(/\s+/g, " ").trim())?.kind;
}

/** The value a captured `$n` placeholder was bound to. */
function bound(
  groups: Groups,
  params: readonly unknown[],
  ...names: string[]
): unknown {
  for (const name of names) {
    const placeholder = groups?.[name];
    if (placeholder !== undefined) return params[Number(placeholder) - 1];
  }
  return undefined;
}

/** The TTL the statement bound, refusing anything that is not a number of seconds. */
function boundTtl(groups: Groups, params: readonly unknown[]): number {
  const ttl = bound(groups, params, "ttlPg", "ttlMysql", "ttlSqlite");
  if (typeof ttl !== "number") {
    throw NextlyError.internal({
      logContext: {
        reason: "migration lock expiry did not bind a numeric ttl",
        bound: String(ttl),
      },
    });
  }
  return ttl;
}

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

  const matched = matchLockStatement(flat);
  const groups = matched?.groups;

  if (matched?.kind === "exists") {
    return lock.seeded ? [{ id: 1 }] : [];
  }
  if (matched?.kind === "state") {
    // Liveness is answered here because the real query answers it in the database, and the owner is
    // reported whether or not the claim has lapsed — the row still holds the name of whoever wrote
    // it last, and it is the flag rather than the absence of a name that says the claim is dead.
    return lock.seeded
      ? [
          {
            owner: lock.owner,
            live: isClaimLive(lock) ? 1 : 0,
            usable: isClaimUsable(lock, boundTtl(groups, params)) ? 1 : 0,
          },
        ]
      : [];
  }
  if (matched?.kind === "claim") {
    // 🔴 Unconditional, because the real statement is: `acquire` decides under a row lock and then
    // writes without naming an owner, so a takeover of a lapsed claim overwrites an occupied row.
    // A model that refused an occupied row would agree with the real one on the day it was written
    // and would then quietly certify that no takeover is possible.
    if (!lock.seeded) return [];
    lock.owner = bound(groups, params, "claim") as string | null;
    lock.expiresAt = lock.clock.now() + boundTtl(groups, params);
    return [];
  }
  if (matched?.kind === "renew") {
    if (lock.seeded && lock.owner === bound(groups, params, "owner")) {
      lock.expiresAt = lock.clock.now() + boundTtl(groups, params);
    }
    return [];
  }
  if (matched?.kind === "release") {
    if (lock.owner === bound(groups, params, "owner")) {
      lock.owner = null;
      lock.expiresAt = null;
    }
    return [];
  }
  // `NextlyError.internal` rather than a bare `Error`: this fires only when the statements the
  // session issues have moved and this interpreter has not, which is a programming mistake in the
  // same sense the session's own `internal` refusals are.
  throw NextlyError.internal({
    logContext: {
      reason: "unrecognised migration lock statement",
      statement: flat,
    },
  });
}

/**
 * One reader per double, used on EVERY path that reads the lock.
 *
 * A double serves the same row through several seams — the adapter, the transaction context, and
 * each of those separately for reads and writes — and a fixture modelling a schema fault has to
 * appear on all of them. That is not a matter of care: a table without `expires_at` has no such
 * column for any reader, so a copy of the gate on one seam and not another models a database that
 * cannot exist, and it lets the code under test succeed at exactly the point the fixture was
 * written to stop it. Measured here: an earlier version failed only the adapter-level read while
 * acquisition reads inside a transaction, and the broken code passed.
 *
 * Building the reader ONCE and handing it to every seam is what removes that, rather than three
 * copies of a predicate with a comment asking them to agree.
 *
 * `stateReadError` fails the liveness read alone, leaving every other statement working — the shape
 * of a lock table that predates its expiry column.
 */
export function createLockStatementReader(
  lock: LockRow,
  options: { stateReadError?: unknown } = {}
): (statement: SQL) => Record<string, unknown>[] {
  return statement => {
    if (
      options.stateReadError !== undefined &&
      classifyLockStatement(statement) === "state"
    ) {
      throw options.stateReadError;
    }
    return interpretLockStatement(lock, statement);
  };
}

/**
 * Whether a statement is the renewal a holder issues while it works.
 *
 * Exported so a suite can fail exactly that statement and nothing else. Selecting it by shape,
 * through the same regex the interpreter uses, is what keeps such a test honest: failing every write
 * for a window would also fail the claim or the release, and the run would then abort for a reason
 * that has nothing to do with renewal.
 */
export function isRenewalStatement(statement: SQL): boolean {
  return classifyLockStatement(statement) === "renew";
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
  /** The seeded claim's expiry, and the clock it is measured against. */
  clock?: LockClock;
  expiresAt?: number | null;
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
  migrationLock: {
    ownerNow: () => string | null;
    /** The database's clock in this model; advance it to let a claim lapse. */
    clock: LockClock;
    expiresAtNow: () => number | null;
  };
} {
  const lock = createLockRow(options.heldBy, {
    clock: options.clock,
    expiresAt: options.expiresAt,
  });

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
          // The seed names no expiry, so the column takes its default: a free row with nothing to
          // expire. Writing a live one here would seed a lock nobody could take.
          lock.expiresAt = null;
          return Promise.resolve(data);
        },
        runStatement: (statement: SQL) => {
          interpretLockStatement(lock, statement);
          return Promise.resolve();
        },
        queryStatement: (statement: SQL) =>
          Promise.resolve(interpretLockStatement(lock, statement)),
      }),
    migrationLock: {
      ownerNow: () => lock.owner,
      clock: lock.clock,
      expiresAtNow: () => lock.expiresAt,
    },
  };
}
