/**
 * The schema lock: one per database, held for the whole of every operation that changes the
 * schema, the migration ledger or the registry of collections, Singles and field groups.
 *
 * ## The row
 *
 * The lock is the single row of `nextly_schema_lock`. A claim names its owner (`host:pid#uuid`),
 * the command that holds it and when it was taken, and carries an expiry the holder RENEWS for as
 * long as it runs. So a live holder keeps the lock however long its run lasts, and a holder that
 * died lets it lapse within one lease, with nobody clearing it by hand. Every time is the
 * database's own (`database/lease-clock`), so contenders on machines whose clocks disagree still
 * agree about who holds it.
 *
 * A row rather than a connection-scoped lock (an advisory lock, MySQL's `GET_LOCK`) for the reasons
 * the field-group lock gave: holding a pooled connection for a whole run wedges a pool of one, a
 * transaction-mode pooler can hand the unlock to another backend, and the row behaves the same on
 * all three dialects. On SQLite it is what gives a second process on the same file something to be
 * excluded by: the claim is read and written inside one `BEGIN IMMEDIATE` transaction, which SQLite
 * runs one at a time across connections.
 *
 * ## The earlier locks
 *
 * Earlier versions took one of two locks, `nextly_migrate_lock` (`migrate` and its family; on
 * MySQL a named `GET_LOCK`) or `nextly_field_group_lock` (`db:sync`, the development push, the
 * Builder saves and the field-group migration). During an upgrade a process of an earlier version
 * may share the database, and it knows only its own lock. So a run takes this lock and then each
 * earlier lock as well, and holds all of them to the end:
 *
 * - an earlier lock that is already held counts as this one being held, until it lapses or is
 *   released, so a run never starts beside an earlier process that is working;
 * - an earlier process that starts while a run holds this lock finds its own lock held, and waits
 *   or refuses exactly as that version does.
 *
 * A path that took no lock in the earlier version (on SQLite, `nextly migrate`) cannot be excluded
 * this way: it never looks. The release notes say to stop older processes before the first run of
 * this version for that reason.
 *
 * ## Waiting, refusing, releasing
 *
 * A command-line run that finds the lock held waits for it (about a minute) and then stops with a
 * message naming the holder, the command and when it started, and when the lock lapses if that
 * holder has gone. A Schema Builder save is refused at once. However the holder ends — success,
 * refusal, error or, for a command, an interrupt — it releases every lock it holds before the
 * process exits.
 *
 * @module domains/schema/pipeline/schema-lock
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";
import type {
  Connection as CallbackConnection,
  Pool as CallbackPool,
} from "mysql2";

import {
  futureExpression,
  nowExpression,
  remainingSecondsExpression,
} from "../../../database/lease-clock";
import {
  deriveLeaseTimings,
  type LeaseTimings,
} from "../../../database/lease-timings";
import { NextlyError } from "../../../errors/nextly-error";
import { schemaLockColumnTypes } from "../../../schemas/field-group-lock";
import type { Logger } from "../../../shared/types";
import {
  isMissingTable,
  lockTableUnderstandsExpiry,
  observeMigrationLock,
  releaseMigrationClaim,
  withMigrationSession,
  type MigrationSession,
} from "../../field-groups/migration/session";

/** The table the one schema lock lives in. */
export const SCHEMA_LOCK_TABLE = "nextly_schema_lock";

/** The earlier migrate lock's table, PostgreSQL only. */
export const EARLIER_MIGRATE_LOCK_TABLE = "nextly_migrate_lock";

/** The earlier field-group lock's table, held beside this lock through the field-group session. */
const FIELD_GROUP_LOCK_TABLE = "nextly_field_group_lock";

/** The lock is a single row; its key never varies. */
const ROW_ID = 1;

/**
 * How long a claim outlives a holder that stopped without releasing it, in seconds.
 *
 * Short because the holder renews: liveness is the renewal's job, so the lease only decides how
 * soon a dead holder's lock becomes free. Two minutes leaves room for many renewals to fail on a
 * slow database before a live holder could lose it, and is the same lease the field-group lock was
 * tuned to.
 */
const SCHEMA_LOCK_LEASE_SECONDS = 120;

/** How long a command-line run waits for a held lock before it stops, in milliseconds. */
const SCHEMA_LOCK_WAIT_MS = 60_000;

/** How often a waiting run asks again. */
const POLL_MS = 1_000;

/** How many renewals fit in one lease; every other timing is derived from it. */
const RENEW_DIVISOR = 8;

/**
 * How long an interrupted command waits for its releases before it lets the signal stop it.
 *
 * Bounded because a connection that has gone may never answer, and an interrupt that never stops
 * the process is worse than a lock left to lapse.
 */
const SHUTDOWN_WAIT_MS = 5_000;

/**
 * The MySQL named lock an earlier version's migrate takes, as SQL evaluated on the connection that
 * takes it: one name per database, hashed because MySQL caps a lock name at 64 characters.
 */
export const MYSQL_MIGRATE_LOCK_NAME: SQL = sql`CONCAT('nextly:migrate:', SHA1(COALESCE(DATABASE(), '')))`;

/**
 * The server-wide name every Nextly before the per-database name took. Still treated as held when
 * a process holds it, since such a process may be migrating this database.
 */
const MYSQL_LEGACY_LOCK_NAME = "nextly:migrate";

/** Who holds the lock, as far as a contender could learn. */
export type SchemaLockHolder =
  | {
      readonly kind: "schema";
      readonly owner: string;
      readonly command: string | null;
      /** Seconds since the claim was taken, on the database's clock. */
      readonly heldForSeconds: number | null;
      /** Seconds until the claim lapses if nothing renews it; negative once it has. */
      readonly lapsesInSeconds: number | null;
    }
  | {
      readonly kind: "earlier-migrate-lock";
      readonly owner: string | null;
      readonly lapsesInSeconds: number | null;
    }
  | {
      readonly kind: "earlier-mysql-lock";
      readonly name: string;
      readonly connectionId: string | null;
    }
  | { readonly kind: "earlier-field-group-lock"; readonly owner: string };

/** What the work is handed: the field-group session the lock holds beside its own row. */
export type SchemaLockSession = MigrationSession;

export interface SchemaLockOptions {
  adapter: DrizzleAdapter;
  /**
   * What holds the lock, in an operator's words (`nextly migrate`, `Schema Builder: single
   * update`). Stored with the claim, and named in the refusal another run prints.
   */
  command: string;
  /**
   * `wait`: a command-line run, which waits up to {@link SchemaLockOptions.waitMs} and then stops.
   * `refuse`: refused at once, as a Schema Builder save is.
   */
  whenHeld: "wait" | "refuse";
  /** How long `wait` waits, in milliseconds. Default {@link SCHEMA_LOCK_WAIT_MS}. */
  waitMs?: number;
  /** How often a waiting run asks again, in milliseconds. */
  pollMs?: number;
  /** The lease, in seconds. Default {@link SCHEMA_LOCK_LEASE_SECONDS}. */
  leaseSeconds?: number;
  /**
   * Whether the lock tables may be created when they are missing.
   *
   * False for a path that must issue no DDL (`--no-auto-sync`, a registry-only write by a role
   * without DDL rights). Such a path takes the locks whose tables exist and creates none.
   */
  mayCreateTables?: boolean;
  /**
   * Release every lock on SIGINT or SIGTERM, then let the signal stop the process.
   *
   * For a command, whose interrupt ends the process: it must not leave a lock behind for the next
   * run to wait out. Not for work inside a server, where a signal may begin a graceful shutdown
   * that lets the work run on; there the lock lapses within one lease instead.
   */
  releaseOnInterrupt?: boolean;
  /** `wait` only: stop waiting, without running the work, once this resolves true. */
  isSettled?: () => Promise<boolean>;
  /**
   * How a refusal is worded. `command` names the holder for an operator; `editor` tells a Builder
   * user that a migration is running and to save again once it ends, and keeps the holder's host
   * and process out of an API response.
   */
  refusal?: "command" | "editor";
  logger?: {
    warn?: (message: string, meta?: Record<string, unknown>) => void;
    info?: (message: string, meta?: Record<string, unknown>) => void;
  };
}

/**
 * Whether the work ran. `settled` is a waiting run that stopped because `isSettled` said the work
 * it waited to do had been done; it ran nothing and holds nothing.
 */
export type SchemaLockOutcome<T> =
  | { ran: true; value: T }
  | { ran: false; reason: "settled" };

/** A lock held in this async context, so work inside it that asks again is not refused by itself. */
interface HeldHere {
  readonly adapter: DrizzleAdapter;
  readonly claim: string;
  readonly session: MigrationSession;
  released: boolean;
}

/**
 * The locks this async context holds.
 *
 * A holder's work can reach a path that takes the lock itself: a plugin install boots the runtime,
 * whose boot syncs code-first field groups under the lock. Two separate locks never met there; one
 * lock would refuse its own holder. Work started inside a holder's context and asking for the same
 * database runs inside the holder's claim instead. Recognised by adapter, or by the database
 * itself naming a claim this context holds, so another adapter on the same database is recognised
 * and an adapter on another database is not. A context whose lock was released is not a holder,
 * however long work started inside it lives on.
 */
const heldHere = new AsyncLocalStorage<readonly HeldHere[]>();

/** The claim this process would write: who it is, unique per acquisition. */
function newClaim(): string {
  return `${hostname()}:${process.pid}#${randomUUID()}`;
}

/** DDL for the schema lock table, built from its declaration. */
export function getSchemaLockDdl(dialect: SupportedDialect): string[] {
  const types = schemaLockColumnTypes(dialect);
  return [
    `CREATE TABLE IF NOT EXISTS ${SCHEMA_LOCK_TABLE} (id ${types.id} PRIMARY KEY, owner ${types.owner}, command ${types.command}, acquired_at ${types.acquired_at}, expires_at ${types.expires_at})`,
  ];
}

/** DDL for the earlier migrate lock's table, as the earlier version creates it. PostgreSQL only. */
export function getEarlierMigrateLockDdl(dialect: SupportedDialect): string[] {
  if (dialect !== "postgresql") return [];
  return [
    `CREATE TABLE IF NOT EXISTS ${EARLIER_MIGRATE_LOCK_TABLE} (
        id integer PRIMARY KEY,
        owner text NOT NULL,
        acquired_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL
      )`,
  ];
}

const id = (name: string) => sql.identifier(name);

/** The row as the database reports it, with liveness decided there, in one statement. */
function stateQuery(dialect: SupportedDialect, marginSeconds: number): SQL {
  return sql`SELECT ${id("owner")}, ${id("command")},
      CASE WHEN ${id("owner")} IS NOT NULL AND ${id("expires_at")} > ${nowExpression(dialect)}
           THEN 1 ELSE 0 END AS ${id("live")},
      CASE WHEN ${id("owner")} IS NOT NULL
            AND ${id("expires_at")} > ${futureExpression(dialect, marginSeconds)}
           THEN 1 ELSE 0 END AS ${id("usable")},
      ${remainingSecondsExpression(dialect, "expires_at")} AS ${id("lapses_in")},
      ${remainingSecondsExpression(dialect, "acquired_at")} AS ${id("started_in")}
      FROM ${id(SCHEMA_LOCK_TABLE)}
      WHERE ${id("id")} = ${ROW_ID}`;
}

interface RowState {
  readonly owner: string | null;
  readonly command: string | null;
  /** Would this claim exclude a contender right now. */
  readonly live: boolean;
  /** Will this claim outlast the window in which its holder will not ask again. */
  readonly usable: boolean;
  readonly lapsesInSeconds: number | null;
  readonly heldForSeconds: number | null;
}

type RawState = {
  owner: string | null;
  command: string | null;
  live: unknown;
  usable: unknown;
  lapses_in: unknown;
  started_in: unknown;
};

/** A number the driver may hand back as a string (PostgreSQL's `numeric`), or null. */
function seconds(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toState(row: RawState | undefined): RowState | undefined {
  if (row === undefined) return undefined;
  const startedIn = seconds(row.started_in);
  return {
    owner: row.owner,
    command: row.command,
    live: Number(row.live) === 1,
    usable: Number(row.usable) === 1,
    lapsesInSeconds: seconds(row.lapses_in),
    heldForSeconds: startedIn === null ? null : -startedIn,
  };
}

async function readState(
  run: { queryStatement: TransactionContext["queryStatement"] },
  dialect: SupportedDialect,
  timings: LeaseTimings
): Promise<RowState | undefined> {
  const rows = await run.queryStatement<RawState>(
    stateQuery(dialect, timings.renewMarginSeconds)
  );
  return toState(rows[0]);
}

/** Free the row, but only while this claim holds it. */
function clearStatement(claim: string): SQL {
  return sql`UPDATE ${id(SCHEMA_LOCK_TABLE)}
      SET ${id("owner")} = NULL, ${id("command")} = NULL,
          ${id("acquired_at")} = NULL, ${id("expires_at")} = NULL
      WHERE ${id("id")} = ${ROW_ID} AND ${id("owner")} = ${claim}`;
}

/**
 * Make sure the row exists, creating its table first when that is allowed.
 *
 * Returns false only when the table is missing and may not be created: a path that issues no DDL
 * on a database no run of this version has touched. Such a path still takes the earlier locks.
 *
 * The row is looked for and seeded inside one transaction. Losing the seed to another process is
 * expected — the primary key decides — and the row that then exists is the one to contend for; a
 * row that is still missing is refused by the claim that reads it next.
 */
async function ensureRow(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  mayCreateTables: boolean
): Promise<boolean> {
  if (mayCreateTables) {
    for (const statement of getSchemaLockDdl(dialect)) {
      await adapter.executeQuery(statement);
    }
  }
  try {
    await adapter.transaction(async ctx => {
      // Taken first, as every transaction on this row takes it, so contenders seeding at once queue.
      await ctx.lockRow(SCHEMA_LOCK_TABLE, ROW_ID);
      const rows = await ctx.queryStatement(
        sql`SELECT ${id("id")} FROM ${id(SCHEMA_LOCK_TABLE)} WHERE ${id("id")} = ${ROW_ID}`
      );
      if (rows.length > 0) return;
      await ctx.runStatement(
        sql`INSERT INTO ${id(SCHEMA_LOCK_TABLE)} (${id("id")}) VALUES (${ROW_ID})`
      );
    });
  } catch (error) {
    if (!mayCreateTables && isMissingTable(error, dialect)) return false;
    // Any other failure, a lost seed race among them, leaves the claim below to decide: it reads
    // the row, and refuses when there is none.
  }
  return true;
}

type RowAttempt = { ok: true } | { ok: false; state: RowState | undefined };

/** Claim the row, or report who holds it. */
async function claimRow(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  claim: string,
  command: string,
  timings: LeaseTimings
): Promise<RowAttempt> {
  return adapter.transaction(async ctx => {
    // Serialises contenders: each waits here until the transaction before it ends, so the read
    // below cannot be overtaken between reading and writing. On SQLite the transaction itself is
    // `BEGIN IMMEDIATE`, which does the same across processes.
    await ctx.lockRow(SCHEMA_LOCK_TABLE, ROW_ID);
    const before = await readState(ctx, dialect, timings);
    if (before === undefined) return { ok: false, state: undefined };
    if (before.live) return { ok: false, state: before };

    await ctx.runStatement(
      sql`UPDATE ${id(SCHEMA_LOCK_TABLE)}
          SET ${id("owner")} = ${claim}, ${id("command")} = ${command},
              ${id("acquired_at")} = ${nowExpression(dialect)},
              ${id("expires_at")} = ${futureExpression(dialect, timings.ttlSeconds)}
          WHERE ${id("id")} = ${ROW_ID}`
    );
    // Read back rather than trusting an affected-row count, which the dialects report
    // differently. A claim that is ours but already near its end is not a claim to start work on.
    const after = await readState(ctx, dialect, timings);
    if (after?.owner === claim && after.usable) return { ok: true };
    if (after?.owner === claim) await ctx.runStatement(clearStatement(claim));
    return { ok: false, state: after };
  });
}

/** Where a renewal's statements run: a transaction on the adapter, or a connection of its own. */
interface StatementRunner {
  run(statement: SQL): Promise<void>;
  query<T>(statement: SQL): Promise<T[]>;
}

/** What a renewal extends: this lock's row, and each earlier lock held beside it. */
interface RenewalTargets {
  readonly row: boolean;
  readonly earlierRow: boolean;
  /** The field-group claim, when the table it lives in has an expiry to extend. */
  readonly fieldGroupClaim: string | undefined;
}

/**
 * Extend every lease this run holds, and report whether any of them was taken from it.
 *
 * The answer is ownership, not timeliness: a renewal held up — behind a long migration
 * transaction on a pool of two, or behind SQLite's one connection — and then run still finds the
 * row naming this run unless another run took it. The earlier locks are extended in the same
 * sequence, so an earlier process keeps finding them held for as long as this run holds the lock.
 */
async function renewAll(
  runner: StatementRunner,
  dialect: SupportedDialect,
  claim: string,
  timings: LeaseTimings,
  targets: RenewalTargets
): Promise<{ disproved: boolean }> {
  const expiry = futureExpression(dialect, timings.ttlSeconds);
  if (targets.row) {
    await runner.run(
      sql`UPDATE ${id(SCHEMA_LOCK_TABLE)}
          SET ${id("expires_at")} = ${expiry}
          WHERE ${id("id")} = ${ROW_ID} AND ${id("owner")} = ${claim}`
    );
  }
  if (targets.earlierRow) {
    await runner.run(
      sql`UPDATE ${id(EARLIER_MIGRATE_LOCK_TABLE)}
          SET ${id("expires_at")} = ${expiry}
          WHERE ${id("id")} = ${ROW_ID} AND ${id("owner")} = ${claim}`
    );
  }
  if (targets.fieldGroupClaim !== undefined) {
    await runner.run(
      sql`UPDATE ${id(FIELD_GROUP_LOCK_TABLE)}
          SET ${id("expires_at")} = ${expiry}
          WHERE ${id("id")} = ${ROW_ID} AND ${id("owner")} = ${targets.fieldGroupClaim}`
    );
  }
  return { disproved: !(await ownsAll(runner, claim, targets)) };
}

/** Whether this lock's row, and the earlier migrate lock's row it holds, still name this run. */
async function ownsAll(
  runner: Pick<StatementRunner, "query">,
  claim: string,
  targets: Pick<RenewalTargets, "row" | "earlierRow">
): Promise<boolean> {
  const ownerOf = async (table: string): Promise<string | null> => {
    const rows = await runner.query<{ owner: string | null }>(
      sql`SELECT ${id("owner")} FROM ${id(table)} WHERE ${id("id")} = ${ROW_ID}`
    );
    return rows[0]?.owner ?? null;
  };
  if (targets.row && (await ownerOf(SCHEMA_LOCK_TABLE)) !== claim) return false;
  if (
    targets.earlierRow &&
    (await ownerOf(EARLIER_MIGRATE_LOCK_TABLE)) !== claim
  ) {
    return false;
  }
  return true;
}

/** A runner over one adapter transaction. */
function transactionRunner(ctx: TransactionContext): StatementRunner {
  return {
    run: statement => ctx.runStatement(statement),
    query: <T>(statement: SQL) => ctx.queryStatement<T>(statement),
  };
}

/** A connection this run opened for its renewals alone, and how to close it. */
interface RenewalConnection {
  readonly runner: StatementRunner;
  close(): Promise<void>;
}

/**
 * A connection of its own for renewals, on a pool that cannot spare one.
 *
 * With a pool of one, the work's own transaction holds the only connection for as long as it
 * runs, so a renewal through the pool waits behind it and the lease lapses under a migration that
 * is still running, letting another run in. On PostgreSQL one connection opened beside the pool
 * keeps the renewal independent of the work; a pool of two or more can spare one. MySQL needs none:
 * a pool of two or more gives the named lock a connection of its own, which renewals use, and with
 * a pool of one the named lock is held on the only connection for the whole run, so every other
 * run is refused by it even while the row's renewal waits. SQLite has one connection whatever is
 * asked of it, and while its work holds a write transaction no other process can take the lock.
 */
async function openRenewalConnection(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect
): Promise<RenewalConnection | undefined> {
  const client = adapter.getDrizzle<{ $client?: unknown }>().$client;
  return dialect === "postgresql" ? openPostgresRenewal(client) : undefined;
}

/** node-postgres's pool, as far as a second connection beside it needs. */
interface PgPoolLike {
  options?: { max?: number };
  Client?: new (options: unknown) => {
    connect(): Promise<void>;
    query(text: string, params: unknown[]): Promise<{ rows: unknown[] }>;
    end(): Promise<void>;
  };
}

async function openPostgresRenewal(
  client: unknown
): Promise<RenewalConnection | undefined> {
  const pool = client as PgPoolLike | undefined;
  if (pool?.Client === undefined || (pool.options?.max ?? 10) >= 2) {
    return undefined;
  }
  // The pool's own client class and options, so the connection is made exactly as the pool's are.
  const connection = new pool.Client(pool.options);
  await connection.connect();
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const compiler = new PgDialect();
  const query = async <T>(statement: SQL): Promise<T[]> => {
    const compiled = compiler.sqlToQuery(statement);
    return (await connection.query(compiled.sql, compiled.params)).rows as T[];
  };
  return {
    runner: {
      run: async statement => {
        await query(statement);
      },
      query,
    },
    close: () => connection.end(),
  };
}

/** A runner over a MySQL connection this run holds for itself. */
function connectionRunner(executor: Executor): StatementRunner {
  return {
    run: async statement => {
      await executor.execute(statement);
    },
    query: async <T>(statement: SQL) =>
      toRows(await executor.execute(statement)) as T[],
  };
}

async function releaseRow(
  adapter: DrizzleAdapter,
  claim: string
): Promise<void> {
  await adapter.transaction(async ctx => {
    await ctx.lockRow(SCHEMA_LOCK_TABLE, ROW_ID);
    await ctx.runStatement(clearStatement(claim));
  });
}

// ---------------------------------------------------------------------------
// The earlier migrate lock
// ---------------------------------------------------------------------------

/** How the earlier migrate lock is held, so it can be given back. */
interface EarlierMigrateLock {
  /** PostgreSQL's row, renewed with this lock's own. */
  readonly row: boolean;
  /** Releases it: the row deleted, or MySQL's named lock given back. */
  readonly release: () => Promise<void>;
  /**
   * MySQL: the connection the named lock is held on, when it is one of its own. Renewals run on
   * it, so they never wait for a connection a migration's transaction holds.
   */
  readonly connection?: Executor;
}

type EarlierAttempt =
  | { ok: true; held: EarlierMigrateLock | undefined }
  | { ok: false; holder: SchemaLockHolder };

/**
 * Take the earlier migrate lock, as an earlier version's `nextly migrate` would find it.
 *
 * PostgreSQL: the `nextly_migrate_lock` row, taken by the same atomic upsert the earlier version
 * uses (it succeeds only when the row is absent or lapsed), owned by this claim and renewed with
 * this lock. MySQL: the per-database named lock, on a connection of its own for the whole run,
 * with the earlier server-wide name refused when another process holds it. SQLite: none, since no
 * earlier version took one there.
 */
async function takeEarlierMigrateLock(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  claim: string,
  timings: LeaseTimings,
  mayCreateTables: boolean
): Promise<EarlierAttempt> {
  if (dialect === "postgresql") {
    return takeEarlierMigrateRow(adapter, claim, timings, mayCreateTables);
  }
  if (dialect === "mysql") return takeEarlierMysqlLock(adapter);
  return { ok: true, held: undefined };
}

async function takeEarlierMigrateRow(
  adapter: DrizzleAdapter,
  claim: string,
  timings: LeaseTimings,
  mayCreateTables: boolean
): Promise<EarlierAttempt> {
  if (mayCreateTables) {
    for (const statement of getEarlierMigrateLockDdl("postgresql")) {
      await adapter.executeQuery(statement);
    }
  }
  const now = nowExpression("postgresql");
  const expires = futureExpression("postgresql", timings.ttlSeconds);
  let taken: unknown[];
  try {
    taken = await adapter.queryStatement(
      sql`INSERT INTO ${id(EARLIER_MIGRATE_LOCK_TABLE)}
            (${id("id")}, ${id("owner")}, ${id("acquired_at")}, ${id("expires_at")})
          VALUES (${ROW_ID}, ${claim}, ${now}, ${expires})
          ON CONFLICT (${id("id")}) DO UPDATE
            SET ${id("owner")} = EXCLUDED.${id("owner")},
                ${id("acquired_at")} = EXCLUDED.${id("acquired_at")},
                ${id("expires_at")} = EXCLUDED.${id("expires_at")}
            WHERE ${id(EARLIER_MIGRATE_LOCK_TABLE)}.${id("expires_at")} < ${now}
          RETURNING ${id("id")}`
    );
  } catch (error) {
    // No table and none may be made: no earlier `nextly migrate` has run here, and one that
    // starts now creates it and takes it, which is the residual a path without DDL rights has.
    if (!mayCreateTables && isMissingTable(error, "postgresql")) {
      return { ok: true, held: undefined };
    }
    throw error;
  }
  if (taken.length === 1) {
    return {
      ok: true,
      held: {
        row: true,
        release: async () => {
          await adapter.transaction(async ctx => {
            await ctx.runStatement(
              sql`DELETE FROM ${id(EARLIER_MIGRATE_LOCK_TABLE)}
                  WHERE ${id("id")} = ${ROW_ID} AND ${id("owner")} = ${claim}`
            );
          });
        },
      },
    };
  }
  const rows = await adapter.queryStatement<{
    owner: string | null;
    lapses_in: unknown;
  }>(
    sql`SELECT ${id("owner")},
          ${remainingSecondsExpression("postgresql", "expires_at")} AS ${id("lapses_in")}
        FROM ${id(EARLIER_MIGRATE_LOCK_TABLE)} WHERE ${id("id")} = ${ROW_ID}`
  );
  return {
    ok: false,
    holder: {
      kind: "earlier-migrate-lock",
      owner: rows[0]?.owner ?? null,
      lapsesInSeconds: seconds(rows[0]?.lapses_in),
    },
  };
}

/** Normalise a driver result to rows (`[rows, fields]` from mysql2). */
function toRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return (Array.isArray(result[0]) ? result[0] : result) as Array<
      Record<string, unknown>
    >;
  }
  return (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

type Executor = { execute: (query: SQL) => Promise<unknown> };

/** A MySQL connection a named lock is held on, and how it is given back. */
interface PinnedMysql {
  db: Executor;
  /** Whether `db` is a connection of its own, rather than the shared handle. */
  own: boolean;
  release: () => void;
  destroy: () => void;
}

/** mysql2's default `connectionLimit`, used when a pool does not state one. */
const MYSQL_DEFAULT_CONNECTION_LIMIT = 10;

/**
 * The connection a MySQL named lock is held on. `GET_LOCK` belongs to the connection that runs it
 * and the pool hands out any idle one, so the lock and its release share a connection of their
 * own. A pool of one is used as it is: holding its only connection would wedge the work, and with
 * one connection the lock and its release share it anyway.
 */
async function pinMysqlConnection(db: unknown): Promise<PinnedMysql> {
  const client = (db as { $client?: Partial<CallbackPool> }).$client;
  const limit =
    client?.config?.connectionLimit ?? MYSQL_DEFAULT_CONNECTION_LIMIT;
  if (
    typeof client?.getConnection !== "function" ||
    typeof client.promise !== "function" ||
    limit < 2
  ) {
    return {
      db: db as Executor,
      own: false,
      release: () => {},
      destroy: () => {},
    };
  }
  // Loaded here rather than at the top: the MySQL driver is a dependency of the MySQL adapter
  // only, so a PostgreSQL or SQLite install must not need it.
  const { drizzle } = await import("drizzle-orm/mysql2");
  const connection = await client.promise().getConnection();
  const callback = (connection as unknown as { connection: CallbackConnection })
    .connection;
  return {
    db: drizzle({ client: callback }) as unknown as Executor,
    own: true,
    release: () => connection.release(),
    destroy: () => connection.destroy(),
  };
}

async function takeEarlierMysqlLock(
  adapter: DrizzleAdapter
): Promise<EarlierAttempt> {
  const pinned = await pinMysqlConnection(adapter.getDrizzle());
  const giveBack = async (): Promise<void> => {
    try {
      await pinned.db.execute(
        sql`SELECT RELEASE_LOCK(${MYSQL_MIGRATE_LOCK_NAME})`
      );
      pinned.release();
    } catch {
      // A connection that cannot give the lock back is closed instead, which is what frees it.
      pinned.destroy();
    }
  };
  try {
    const [taken] = toRows(
      await pinned.db.execute(
        sql`SELECT GET_LOCK(${MYSQL_MIGRATE_LOCK_NAME}, 0) AS ${id("locked")}, IS_USED_LOCK(${MYSQL_MIGRATE_LOCK_NAME}) AS ${id("holder")}`
      )
    );
    if (!(Number(taken?.locked) === 1)) {
      pinned.release();
      return {
        ok: false,
        holder: {
          kind: "earlier-mysql-lock",
          name: "nextly:migrate:<this database>",
          connectionId: connectionIdOf(taken?.holder),
        },
      };
    }
    const [legacy] = toRows(
      await pinned.db.execute(
        sql`SELECT IS_USED_LOCK(${MYSQL_LEGACY_LOCK_NAME}) AS ${id("holder")}`
      )
    );
    if (legacy?.holder !== null && legacy?.holder !== undefined) {
      await giveBack();
      return {
        ok: false,
        holder: {
          kind: "earlier-mysql-lock",
          name: MYSQL_LEGACY_LOCK_NAME,
          connectionId: connectionIdOf(legacy.holder),
        },
      };
    }
    return {
      ok: true,
      held: {
        row: false,
        release: giveBack,
        ...(pinned.own ? { connection: pinned.db } : {}),
      },
    };
  } catch (error) {
    pinned.destroy();
    throw error;
  }
}

/** MySQL's connection id, a number on every driver setting this runs under. */
function connectionIdOf(value: unknown): string | null {
  if (typeof value === "number" || typeof value === "bigint")
    return String(value);
  return typeof value === "string" ? value : null;
}

// ---------------------------------------------------------------------------
// Holding the lock
// ---------------------------------------------------------------------------

/** One attempt at every lock: taken, already this context's own, or held by someone. */
type Attempt =
  | { kind: "acquired" }
  | { kind: "reentrant"; held: HeldHere }
  | { kind: "held"; holder: SchemaLockHolder };

/**
 * What one run holds, at every moment, and how each piece is given back.
 *
 * Kept as state rather than locals so every ending — success, refusal, error and an interrupt,
 * which arrives on its own schedule — releases exactly what is held at that moment, no more and
 * no less.
 */
class SchemaLockHold {
  readonly claim = newClaim();
  readonly timings: LeaseTimings;
  readonly dialect: SupportedDialect;
  /** False only for a path that may create no table, on a database whose lock table is missing. */
  rowReady = false;
  rowHeld = false;
  earlier: EarlierMigrateLock | undefined;
  fieldGroupClaim: string | undefined;
  /** The acquisition in flight, which an interrupt waits for before releasing. */
  pending: Promise<unknown> = Promise.resolve();
  interrupted = false;
  /** Another run took a lock this run held. */
  lost = false;
  /** Whether the field-group claim's table has an expiry for the renewal to extend. */
  fieldGroupRenewable = false;
  private renewal: ReturnType<typeof setInterval> | undefined;
  private outstandingRenewal: Promise<unknown> = Promise.resolve();
  /** A connection opened for renewals alone, on a pool that cannot spare one. */
  private renewalConnection: RenewalConnection | undefined;

  constructor(
    readonly options: SchemaLockOptions,
    readonly leaseSeconds: number
  ) {
    this.timings = deriveLeaseTimings(leaseSeconds, RENEW_DIVISOR);
    this.dialect = options.adapter.getCapabilities().dialect;
  }

  get adapter(): DrizzleAdapter {
    return this.options.adapter;
  }

  get mayCreateTables(): boolean {
    return this.options.mayCreateTables ?? true;
  }

  /** Every lock at once, all or nothing. */
  async acquireOnce(): Promise<Attempt> {
    // The earlier migrate lock first. On MySQL it is the named lock, held on a connection for the
    // whole run, so a contender refused by it leaves this lock's row alone: taking the row first
    // would let a contender overwrite a row whose renewal was waiting behind a long transaction
    // on a pool of one, and the holder would then find its row gone at the end.
    const taken = await takeEarlierMigrateLock(
      this.adapter,
      this.dialect,
      this.claim,
      this.timings,
      this.mayCreateTables
    );
    if (!taken.ok) return this.heldByEarlierLock(taken.holder);
    this.earlier = taken.held;
    if (this.rowReady) {
      const row = await claimRow(
        this.adapter,
        this.dialect,
        this.claim,
        this.options.command,
        this.timings
      );
      if (!row.ok) {
        await this.releaseAll();
        return this.heldByRow(row.state);
      }
      this.rowHeld = true;
    }
    // The earlier field-group lock is taken by the session the work runs in; asked first so a
    // held one is waited for like any other, rather than refused by the session outright.
    const fieldGroup = await observeMigrationLock(this.adapter, this.dialect);
    if (fieldGroup.kind === "held") {
      await this.releaseAll();
      return {
        kind: "held",
        holder: { kind: "earlier-field-group-lock", owner: fieldGroup.owner },
      };
    }
    return { kind: "acquired" };
  }

  /**
   * The earlier migrate lock was held: by a run of this version, which holds it beside this lock's
   * row — reported as that run, with its command and start — by this very context, whose own run
   * holds it on another adapter, or by a process of an earlier version. The row says which.
   */
  private async heldByEarlierLock(holder: SchemaLockHolder): Promise<Attempt> {
    if (!this.rowReady) return { kind: "held", holder };
    const state = await this.adapter.transaction(ctx =>
      readState(ctx, this.dialect, this.timings)
    );
    if (state?.live !== true) return { kind: "held", holder };
    return this.heldByRow(state);
  }

  /** The row was not ours to take: someone holds it, or this very context does. */
  private heldByRow(state: RowState | undefined): Attempt {
    if (state === undefined) {
      // Running on would be running unprotected: nothing here could exclude anyone.
      throw NextlyError.serviceUnavailable({
        logMessage:
          "the schema lock row could not be established; refusing to run unprotected",
        logContext: {
          reason: "schema lock row missing",
          table: SCHEMA_LOCK_TABLE,
        },
      });
    }
    const mine = (heldHere.getStore() ?? []).find(
      held => !held.released && state.live && held.claim === state.owner
    );
    if (mine !== undefined) return { kind: "reentrant", held: mine };
    return { kind: "held", holder: holderOf(state) };
  }

  /**
   * Renew for as long as the work runs, so a run lasting many leases keeps the lock. Only one
   * attempt is ever in flight, and a confirmation is dated from before its attempt, so the time
   * left is only ever understated.
   */
  /** Open a connection of renewals' own where the pool cannot spare one; see `openRenewalConnection`. */
  async prepareRenewal(): Promise<void> {
    if (
      this.renewalConnection !== undefined ||
      this.earlier?.connection !== undefined
    ) {
      return;
    }
    this.renewalConnection = await openRenewalConnection(
      this.adapter,
      this.dialect
    );
  }

  /** The runner a renewal uses when it does not open an adapter transaction. */
  private ownRunner(): StatementRunner | undefined {
    const connection = this.earlier?.connection;
    if (connection !== undefined) return connectionRunner(connection);
    return this.renewalConnection?.runner;
  }

  /** Close the renewal connection, once nothing will renew again. */
  async closeRenewal(): Promise<void> {
    const connection = this.renewalConnection;
    this.renewalConnection = undefined;
    await connection?.close().catch(() => undefined);
  }

  startRenewal(): void {
    let renewing = false;
    this.renewal = setInterval(() => {
      // Only one attempt in flight: a renewal held up behind a long transaction must not have a
      // second queued beneath it.
      if (renewing) return;
      renewing = true;
      this.outstandingRenewal = this.renewOnce().then(
        ({ disproved }) => {
          renewing = false;
          if (disproved) this.lost = true;
        },
        () => {
          // A failed attempt proves nothing either way; the next one asks again, and the end of
          // the run asks once more whether the lock is still this run's.
          renewing = false;
        }
      );
    }, this.timings.renewIntervalMs);
    this.renewal.unref?.();
  }

  /** What a renewal extends right now. */
  private targets(): RenewalTargets {
    return {
      row: this.rowHeld,
      earlierRow: this.earlier?.row === true,
      fieldGroupClaim: this.fieldGroupRenewable
        ? this.fieldGroupClaim
        : undefined,
    };
  }

  /**
   * One renewal, on MySQL's held connection where there is one, so it never waits for a
   * connection the work's own transaction holds; otherwise in an adapter transaction.
   */
  private renewOnce(): Promise<{ disproved: boolean }> {
    const targets = this.targets();
    const own = this.ownRunner();
    if (own !== undefined) {
      return renewAll(own, this.dialect, this.claim, this.timings, targets);
    }
    return this.adapter.transaction(ctx =>
      renewAll(
        transactionRunner(ctx),
        this.dialect,
        this.claim,
        this.timings,
        targets
      )
    );
  }

  /**
   * Whether this run still holds its lock now that its work has ended. The question that decides
   * whether it was excluded throughout: a row that still names this run was taken by no other.
   */
  async stillOwned(): Promise<boolean> {
    const targets = this.targets();
    const own = this.ownRunner();
    if (own !== undefined) return ownsAll(own, this.claim, targets);
    // Read as every other read of the lock rows is, inside a transaction.
    return this.adapter.transaction(ctx =>
      ownsAll(transactionRunner(ctx), this.claim, targets)
    );
  }

  /** Stop renewing, and let an attempt already in flight land before anything is released. */
  async stopRenewal(): Promise<void> {
    if (this.renewal !== undefined) clearInterval(this.renewal);
    await Promise.race([
      Promise.allSettled([this.outstandingRenewal]),
      new Promise(resolve => setTimeout(resolve, SHUTDOWN_WAIT_MS).unref?.()),
    ]);
  }

  /** Give back whatever is held, the field-group claim first and this lock's row last. */
  async releaseAll(): Promise<void> {
    const releases: Array<() => Promise<void>> = [];
    const fieldGroupClaim = this.fieldGroupClaim;
    if (fieldGroupClaim !== undefined) {
      releases.push(() => releaseMigrationClaim(this.adapter, fieldGroupClaim));
    }
    const earlier = this.earlier;
    if (earlier !== undefined) releases.push(() => earlier.release());
    if (this.rowHeld) releases.push(() => releaseRow(this.adapter, this.claim));
    this.fieldGroupClaim = undefined;
    this.earlier = undefined;
    this.rowHeld = false;

    let failed = false;
    for (const release of releases) {
      await release().catch(() => {
        failed = true;
      });
    }
    if (failed) {
      this.options.logger?.warn?.(
        `[Nextly] The schema lock could not be released; it lapses on its own within ${this.leaseSeconds} s.`
      );
    }
  }

  /**
   * Release every lock on SIGINT or SIGTERM, then let the signal stop the process. Returns how to
   * take the handlers off again.
   */
  installSignals(): () => void {
    if (this.options.releaseOnInterrupt !== true) return () => {};
    const onSignal = (signal: NodeJS.Signals): void => {
      this.interrupted = true;
      remove();
      void Promise.race([
        Promise.allSettled([this.pending]).then(() => this.releaseAll()),
        new Promise(resolve => setTimeout(resolve, SHUTDOWN_WAIT_MS).unref?.()),
      ])
        .catch(() => undefined)
        .finally(() => {
          process.kill(process.pid, signal);
        });
    };
    const onInterrupt = (): void => onSignal("SIGINT");
    const onTerminate = (): void => onSignal("SIGTERM");
    const remove = (): void => {
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onTerminate);
    };
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onTerminate);
    return remove;
  }
}

/**
 * The wait one run makes for a held lock, across however many attempts it takes: one deadline,
 * one notice, and the refusal once the deadline has passed.
 */
class LockWait {
  private readonly waitMs: number;
  private readonly deadline: number;
  private announced = false;

  constructor(private readonly options: SchemaLockOptions) {
    this.waitMs =
      options.whenHeld === "wait" ? (options.waitMs ?? SCHEMA_LOCK_WAIT_MS) : 0;
    this.deadline = Date.now() + this.waitMs;
  }

  /**
   * After an attempt found `holder` in the way: refuse once the wait is over, stop when
   * `isSettled` says the work is done, and otherwise pause before the next attempt.
   */
  async after(holder: SchemaLockHolder): Promise<"retry" | "settled"> {
    const { options } = this;
    if (Date.now() >= this.deadline) {
      throw refusalFor(options, holder, this.waitMs);
    }
    if (!this.announced) {
      this.announced = true;
      options.logger?.info?.(
        `[Nextly] Waiting up to ${Math.round(this.waitMs / 1000)} s for the schema lock: ${describeHolder(holder)}`
      );
    }
    if (options.isSettled && (await options.isSettled())) return "settled";
    await new Promise(resolve =>
      setTimeout(
        resolve,
        Math.max(
          0,
          Math.min(options.pollMs ?? POLL_MS, this.deadline - Date.now())
        )
      )
    );
    return "retry";
  }
}

/**
 * Take every lock, waiting as the run's `LockWait` says. Returns the context's own hold when this
 * is work inside a holder, or `settled` when `isSettled` ended the wait.
 */
async function acquire(
  hold: SchemaLockHold,
  wait: LockWait
): Promise<
  | { kind: "acquired" }
  | { kind: "reentrant"; held: HeldHere }
  | { kind: "settled" }
> {
  for (;;) {
    if (hold.interrupted) throw interruptedBeforeStart(hold.options.command);
    const attempt = hold.acquireOnce();
    hold.pending = attempt;
    const outcome = await attempt;
    if (outcome.kind !== "held") return outcome;
    if ((await wait.after(outcome.holder)) === "settled") {
      return { kind: "settled" };
    }
  }
}

/** The field-group session's refusal of a claim another process holds, as that holder. */
function heldFieldGroupOwner(error: unknown): string | undefined {
  if (!NextlyError.is(error)) return undefined;
  const context = error.logContext;
  if (context?.reason !== "migration lock is held elsewhere") return undefined;
  return typeof context.heldBy === "string"
    ? context.heldBy
    : "another process";
}

/**
 * Run `work` in the field-group session the lock holds beside its own row, inside this context's
 * record of what it holds.
 *
 * Returns `field-group-held` when the session could not take the field-group lock because another
 * process holds it — on a table that predates its expiry column the observation before it cannot
 * see that — so the run waits for it, or refuses, as for any held lock, rather than failing with
 * the session's own error. Once the work has started, the session's errors are the work's.
 */
async function runHeld<T>(
  hold: SchemaLockHold,
  work: (session: SchemaLockSession) => Promise<T>
): Promise<
  { kind: "ran"; value: T } | { kind: "field-group-held"; owner: string }
> {
  // The session decides its claim before the work starts; until then an interrupt waits for it,
  // so the claim it lands is one the release can see.
  let decided: () => void = () => {};
  hold.pending = new Promise<void>(resolve => {
    decided = resolve;
  });
  // The work itself, which can outlive the session: a session that cannot confirm its own lease
  // rejects at once while the work runs on, and nothing may be released while it does.
  let running: Promise<unknown> | undefined;
  // The work's own result, kept so an interrupted run that finished reports it: the interrupt
  // freed the field-group lock under the session, which the session would otherwise report as a
  // lock it did not hold to the end.
  let finished: { value: T } | undefined;
  try {
    const value = await withMigrationSession(
      {
        adapter: hold.adapter,
        dialect: hold.dialect,
        label: hold.options.command,
        requireExistingLock: !hold.mayCreateTables,
        // The interrupt is handled by the hold, for every lock at once.
        releaseOnInterrupt: false,
        leaseSeconds: hold.leaseSeconds,
        // Renewed with this lock's own row, on this lock's connection; see `renewAll`.
        renewal: "caller",
        // Where the session says it fell back to an owner-only claim on a table that predates
        // its expiry column, which an operator should hear about.
        logger: sessionLogger(hold.options.logger),
      },
      async session => {
        if (session.lock.kind === "held") {
          hold.fieldGroupClaim = session.lock.owner;
          // A table that predates the expiry column has nothing to extend: its claim is
          // owner-only, and holds until it is released.
          hold.fieldGroupRenewable = await lockTableUnderstandsExpiry(
            hold.adapter,
            hold.dialect
          );
        }
        decided();
        if (hold.interrupted) {
          throw interruptedBeforeStart(hold.options.command);
        }
        const held: HeldHere = {
          adapter: hold.adapter,
          claim: hold.claim,
          session,
          released: false,
        };
        const result = heldHere
          .run([...(heldHere.getStore() ?? []), held], () => work(session))
          .then(value => {
            finished = { value };
            return value;
          })
          .finally(() => {
            held.released = true;
          });
        running = result;
        return await result;
      }
    );
    return { kind: "ran", value };
  } catch (error) {
    if (running === undefined) {
      const owner = heldFieldGroupOwner(error);
      if (owner !== undefined) return { kind: "field-group-held", owner };
      throw error;
    }
    // Released only once the work has stopped, whatever the session reported first.
    await Promise.allSettled([running]);
    if (hold.interrupted && finished !== undefined) {
      return { kind: "ran", value: finished.value };
    }
    throw error;
  } finally {
    decided();
  }
}

/** The lease a caller asked for, refused when it could not bound anything. */
function leaseOf(options: SchemaLockOptions): number {
  const leaseSeconds = options.leaseSeconds ?? SCHEMA_LOCK_LEASE_SECONDS;
  if (!(Number.isFinite(leaseSeconds) && leaseSeconds >= 1)) {
    throw NextlyError.validation({
      errors: [
        {
          path: "db.migrateLockTtlSeconds",
          code: "INVALID",
          message: "The schema lock's lease must be at least one second.",
        },
      ],
    });
  }
  return leaseSeconds;
}

/**
 * Run `work` holding the schema lock, and every earlier lock beside it, for the whole of it.
 *
 * Throws `NEXTLY_MIGRATE_LOCK_BUSY` when a command-line run still finds the lock held after its
 * wait, and a 503 when a Builder save finds it held, in both cases before anything is written.
 */
export async function withSchemaLock<T>(
  options: SchemaLockOptions,
  work: (session: SchemaLockSession) => Promise<T>
): Promise<SchemaLockOutcome<T>> {
  const leaseSeconds = leaseOf(options);
  if (options.command.length === 0) {
    throw NextlyError.internal({
      logContext: { reason: "schema lock command must be a non-empty string" },
    });
  }

  // Work inside a holder's own context runs in its claim; see `heldHere`.
  const outer = (heldHere.getStore() ?? []).find(
    held => held.adapter === options.adapter && !held.released
  );
  if (outer !== undefined)
    return { ran: true, value: await work(outer.session) };

  const hold = new SchemaLockHold(options, leaseSeconds);
  const wait = new LockWait(options);
  const removeSignals = hold.installSignals();
  try {
    hold.rowReady = await ensureRow(
      hold.adapter,
      hold.dialect,
      hold.mayCreateTables
    );
    const outcome = await runWhenHeld(hold, wait, work);
    if (!outcome.ran) return outcome;
    await assertHeldToTheEnd(hold);
    return outcome;
  } finally {
    await hold.stopRenewal();
    await hold.closeRenewal();
    // An interrupt releases on its own path, and then stops the process.
    if (!hold.interrupted) {
      removeSignals();
      await hold.releaseAll();
    }
  }
}

/**
 * Take every lock and run `work` in them, as many attempts as the wait allows: an attempt whose
 * field-group session finds that lock held after all gives back what it took and waits again.
 */
async function runWhenHeld<T>(
  hold: SchemaLockHold,
  wait: LockWait,
  work: (session: SchemaLockSession) => Promise<T>
): Promise<SchemaLockOutcome<T>> {
  for (;;) {
    const acquired = await acquire(hold, wait);
    if (acquired.kind === "settled") return { ran: false, reason: "settled" };
    if (acquired.kind === "reentrant") {
      return { ran: true, value: await work(acquired.held.session) };
    }
    await hold.prepareRenewal();
    hold.startRenewal();
    const ran = await runHeld(hold, work);
    if (ran.kind === "ran") return { ran: true, value: ran.value };
    await hold.stopRenewal();
    await hold.releaseAll();
    const holder: SchemaLockHolder = {
      kind: "earlier-field-group-lock",
      owner: ran.owner,
    };
    if ((await wait.after(holder)) === "settled") {
      return { ran: false, reason: "settled" };
    }
  }
}

/**
 * Refuse a run that finished without holding its lock to the end: another run took it while the
 * work ran. Asked once the work has stopped and the last renewal has landed, because a row that
 * still names this run was taken by no other.
 */
async function assertHeldToTheEnd(hold: SchemaLockHold): Promise<void> {
  if (hold.interrupted) return;
  await hold.stopRenewal();
  if (!(await hold.stillOwned().catch(() => false))) hold.lost = true;
  if (!hold.lost) return;
  const { command } = hold.options;
  throw NextlyError.serviceUnavailable({
    publicMessage:
      `${command} finished, but could not keep the schema lock to the end: another run took ` +
      "it while the work ran. Check the database before running it again.",
    logContext: { reason: "schema lock lost while held", command },
  });
}

/** The caller's two-method logger, widened to the session's `Logger`. */
function sessionLogger(logger: SchemaLockOptions["logger"]): Logger {
  const noop = (): void => {};
  return {
    debug: noop,
    info: (message, meta) => logger?.info?.(message, meta),
    warn: (message, meta) => logger?.warn?.(message, meta),
    error: (message, meta) => logger?.warn?.(message, meta),
  };
}

// ---------------------------------------------------------------------------
// What a refusal says
// ---------------------------------------------------------------------------

/** An instant as UTC, to the second. */
function utc(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** A span an operator reads at a glance. */
function span(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 120) return `${s} s`;
  if (s < 7200) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3600)} h`;
}

/** `host:pid#uuid` as the process it names, or the owner as written when it is not that shape. */
function processOf(owner: string): string {
  const who = owner.split("#")[0] ?? owner;
  const at = who.lastIndexOf(":");
  if (at <= 0) return owner;
  return `process ${who.slice(at + 1)} on ${who.slice(0, at)}`;
}

/** When a lapsing claim lapses, said once for every kind that has a lease. */
function lapse(lapsesInSeconds: number | null, now: number): string {
  if (lapsesInSeconds === null) return "";
  if (lapsesInSeconds <= 0)
    return " Its lease has run out, so it is free to take now.";
  return (
    ` If that process has stopped, the lock lapses in ${span(lapsesInSeconds)}, at ` +
    `${utc(now + lapsesInSeconds * 1000)}, with nobody clearing it by hand.`
  );
}

/**
 * Who holds the lock, in an operator's words: the command and when it started for this lock, and
 * when it lapses if its holder has gone.
 */
export function describeHolder(
  holder: SchemaLockHolder,
  now: number = Date.now()
): string {
  switch (holder.kind) {
    case "schema": {
      const what =
        holder.command === null ? "another run" : `\`${holder.command}\``;
      const since =
        holder.heldForSeconds === null
          ? ""
          : `, started ${span(holder.heldForSeconds)} ago at ${utc(now - holder.heldForSeconds * 1000)}`;
      return `${what} holds it (${processOf(holder.owner)}${since}).${lapse(holder.lapsesInSeconds, now)}`;
    }
    case "earlier-migrate-lock":
      return (
        "a process of an earlier Nextly version holds the earlier migrate lock " +
        `(\`${EARLIER_MIGRATE_LOCK_TABLE}\`${holder.owner === null ? "" : `, ${processOf(holder.owner)}`}).` +
        lapse(holder.lapsesInSeconds, now)
      );
    case "earlier-mysql-lock":
      return (
        `another process — this version's or an earlier one's — holds the MySQL lock \`${holder.name}\`` +
        `${holder.connectionId === null ? "" : ` (connection ${holder.connectionId})`}. ` +
        "MySQL frees it when that connection ends."
      );
    case "earlier-field-group-lock":
      return (
        "another process, such as one of an earlier Nextly version, holds the field-group lock " +
        `(\`nextly_field_group_lock\`, ${processOf(holder.owner)}). If no such process is running, ` +
        "clear it with `nextly migrate --force-unlock`."
      );
  }
}

/** The holder as the row described it, or an unknown one when the row could not be read. */
function holderOf(state: RowState | undefined): SchemaLockHolder {
  return {
    kind: "schema",
    owner: state?.owner ?? "an unknown process",
    command: state?.command ?? null,
    heldForSeconds: state?.heldForSeconds ?? null,
    lapsesInSeconds: state?.lapsesInSeconds ?? null,
  };
}

/** The refusal of a run that could not take the lock, raised before anything was written. */
function refusalFor(
  options: SchemaLockOptions,
  holder: SchemaLockHolder,
  waitedMs: number
): NextlyError {
  const logContext = {
    reason: "schema lock held",
    command: options.command,
    holder,
    waitedMs,
  };
  if (options.refusal === "editor") {
    // The editor is told what to do; the holder's host and process stay in the log.
    return NextlyError.serviceUnavailable({
      publicMessage:
        "A migration is running on this database, so this change was not saved. " +
        "Save it again once the migration ends.",
      logMessage: `${options.command} refused: ${describeHolder(holder)}`,
      logContext,
    });
  }
  const waited = waitedMs > 0 ? ` after waiting ${span(waitedMs / 1000)}` : "";
  return new NextlyError({
    code: "NEXTLY_MIGRATE_LOCK_BUSY",
    publicMessage:
      `\`${options.command}\` did not start, and changed nothing: the schema lock is still ` +
      `held${waited}. ${capitalise(describeHolder(holder))} Run it again once that finishes.`,
    logContext,
  });
}

function capitalise(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

/** An interrupt that arrived before the work began: nothing ran, and nothing is held. */
function interruptedBeforeStart(command: string): NextlyError {
  return NextlyError.serviceUnavailable({
    publicMessage: `\`${command}\` was interrupted before it started; nothing was changed.`,
    logContext: { reason: "interrupted before the work started", command },
  });
}
