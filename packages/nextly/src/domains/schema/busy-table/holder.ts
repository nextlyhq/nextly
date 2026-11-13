/**
 * What holds a busy table, as the database names it: each session holding a lock the waiting
 * session waits for, with its user, client address, application name and how long its
 * transaction has been open.
 *
 * Never a session's query text: a statement can carry a literal value (a password, a person's
 * data) that must not leave the database through a report or a log, so no query here selects it.
 *
 * Reading the holder never fails the run it reports on. What cannot be read (a user without the
 * right to see other users' sessions, MySQL's metadata-lock reporting turned off, any other read
 * error) becomes a line saying which detail and why, beside whatever could be read.
 *
 * @module domains/schema/busy-table/holder
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import type { SupportedDialect } from "../../../database/schema-registry";

import { causeChain, sessionNumberOf } from "./ended-waiting";
import type { HolderReport, HolderSession } from "./types";

const id = (name: string) => sql.identifier(name);

const SQLITE_REASON =
  "SQLite does not say which connection holds the database: another connection holds its write lock.";

const UNKNOWN_WAITER =
  "The sessions holding the table: the waiting session's id was not known, so the database could not be asked which sessions it waits for.";

const PG_HIDDEN_REASON =
  "the database user lacks the right to see other users' sessions, such as pg_read_all_stats";

/** MySQL's instrument for metadata locks, without which `metadata_locks` lists none. */
const MDL_INSTRUMENT = "wait/lock/metadata/sql/mdl";

/** MySQL's refusals for a missing privilege: table, column, database, and a named privilege. */
const MYSQL_PRIVILEGE_ERRNOS = new Set([1142, 1143, 1044, 1227]);
const MYSQL_PRIVILEGE_CODES = new Set([
  "ER_TABLEACCESS_DENIED_ERROR",
  "ER_COLUMNACCESS_DENIED_ERROR",
  "ER_DBACCESS_DENIED_ERROR",
  "ER_SPECIFIC_ACCESS_DENIED_ERROR",
]);

/** The driver's code and number for `error`: the first link of its `cause` chain that has one. */
function driverCode(error: unknown): {
  code: string | undefined;
  errno: number | undefined;
} {
  const link = causeChain(error).find(
    ({ code, errno }) => typeof code === "string" || typeof errno === "number"
  );
  return {
    code: typeof link?.code === "string" ? link.code : undefined,
    errno: typeof link?.errno === "number" ? link.errno : undefined,
  };
}

/**
 * Why a read failed, in an operator's words: the database's code where it gave one. Never the
 * error's message, which a driver may build from the statement it ran.
 */
function failureReason(error: unknown): string {
  const { code, errno } = driverCode(error);
  const named = code ?? (errno === undefined ? undefined : String(errno));
  return named === undefined
    ? "the database could not be asked"
    : `the database answered ${named}`;
}

function isMysqlPrivilegeRefusal(error: unknown): boolean {
  const { code, errno } = driverCode(error);
  return (
    (code !== undefined && MYSQL_PRIVILEGE_CODES.has(code)) ||
    (errno !== undefined && MYSQL_PRIVILEGE_ERRNOS.has(errno))
  );
}

/** A database value as text, or null where it is absent or empty. */
function text(value: unknown): string | null {
  if (typeof value === "string") return value === "" ? null : value;
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return null;
}

/** A whole, non-negative number of seconds, or null where the database gave none. */
function wholeSeconds(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

/** MySQL's host column without a trailing client port; an IPv6 address is left whole. */
function hostWithoutPort(host: string | null): string | null {
  if (host === null) return null;
  const match = /^([^:]+):\d+$/.exec(host);
  return match === null ? host : match[1];
}

async function postgresHolders(
  adapter: DrizzleAdapter,
  waiting: number
): Promise<HolderReport> {
  const rows = await adapter.queryStatement<{
    id: unknown;
    user: unknown;
    client_address: unknown;
    application_name: unknown;
    open_seconds: unknown;
    visible: unknown;
  }>(
    // `visible` is PostgreSQL's own rule for showing a session's details: the reading user is
    // the session's, a member of it, or has pg_read_all_stats. Where it is false, the address
    // and the transaction's start read null however the session stands.
    sql`SELECT ${id("pid")} AS ${id("id")}, ${id("usename")} AS ${id("user")},
          host(${id("client_addr")}) AS ${id("client_address")},
          ${id("application_name")} AS ${id("application_name")},
          floor(extract(epoch FROM (clock_timestamp() - ${id("xact_start")})))::integer
            AS ${id("open_seconds")},
          COALESCE(pg_has_role(${id("usesysid")}, 'USAGE'), false)
            OR pg_has_role('pg_read_all_stats', 'USAGE') AS ${id("visible")}
        FROM ${id("pg_stat_activity")}
        WHERE ${id("pid")} = ANY(pg_blocking_pids(${waiting}))
        ORDER BY ${id("pid")}`
  );
  const sessions: HolderSession[] = [];
  const unreadable: string[] = [];
  for (const row of rows) {
    const session: HolderSession = {
      id: String(row.id),
      user: text(row.user),
      clientAddress: text(row.client_address),
      applicationName: text(row.application_name),
      transactionOpenSeconds: wholeSeconds(row.open_seconds),
    };
    sessions.push(session);
    if (row.visible !== true) {
      unreadable.push(
        `Session ${session.id}'s client address and how long its transaction has been open: ${PG_HIDDEN_REASON}.`
      );
    }
  }
  return { kind: "named", sessions, unreadable };
}

/** Why MySQL cannot list metadata-lock holders here, or undefined where it can. */
async function mysqlLockReportingOff(
  adapter: DrizzleAdapter
): Promise<string | undefined> {
  const [schema] = await adapter.queryStatement<{ enabled: unknown }>(
    sql`SELECT @@performance_schema AS ${id("enabled")}`
  );
  if (Number(schema?.enabled) !== 1) {
    return "The sessions holding the table: MySQL's performance_schema is off (performance_schema = OFF), so it does not report who holds a table's metadata lock.";
  }
  const [instrument] = await adapter.queryStatement<{ enabled: unknown }>(
    sql`SELECT ${id("ENABLED")} AS ${id("enabled")}
        FROM ${id("performance_schema")}.${id("setup_instruments")}
        WHERE ${id("NAME")} = ${MDL_INSTRUMENT}`
  );
  if (instrument?.enabled !== "YES") {
    return `The sessions holding the table: MySQL's metadata-lock instrument (${MDL_INSTRUMENT}) is off, so performance_schema does not report who holds a table's metadata lock.`;
  }
  return undefined;
}

async function mysqlHolders(
  adapter: DrizzleAdapter,
  waiting: number
): Promise<HolderReport> {
  try {
    const off = await mysqlLockReportingOff(adapter);
    if (off !== undefined) {
      return { kind: "named", sessions: [], unreadable: [off] };
    }
    // The GRANTED owners of each object the waiting thread has PENDING, other than that thread
    // itself (which may hold a weaker lock on the same table while it waits to upgrade it).
    const metadataRows = await adapter.queryStatement<{
      id: unknown;
      user: unknown;
      host: unknown;
    }>(
      sql`SELECT DISTINCT ${id("holder")}.${id("PROCESSLIST_ID")} AS ${id("id")},
            ${id("holder")}.${id("PROCESSLIST_USER")} AS ${id("user")},
            ${id("holder")}.${id("PROCESSLIST_HOST")} AS ${id("host")}
          FROM ${id("performance_schema")}.${id("threads")} AS ${id("waiter")}
          JOIN ${id("performance_schema")}.${id("metadata_locks")} AS ${id("pending")}
            ON ${id("pending")}.${id("OWNER_THREAD_ID")} = ${id("waiter")}.${id("THREAD_ID")}
           AND ${id("pending")}.${id("LOCK_STATUS")} = 'PENDING'
          JOIN ${id("performance_schema")}.${id("metadata_locks")} AS ${id("granted")}
            ON ${id("granted")}.${id("OBJECT_TYPE")} = ${id("pending")}.${id("OBJECT_TYPE")}
           AND ${id("granted")}.${id("OBJECT_SCHEMA")} <=> ${id("pending")}.${id("OBJECT_SCHEMA")}
           AND ${id("granted")}.${id("OBJECT_NAME")} <=> ${id("pending")}.${id("OBJECT_NAME")}
           AND ${id("granted")}.${id("LOCK_STATUS")} = 'GRANTED'
           AND ${id("granted")}.${id("OWNER_THREAD_ID")} <> ${id("waiter")}.${id("THREAD_ID")}
          JOIN ${id("performance_schema")}.${id("threads")} AS ${id("holder")}
            ON ${id("holder")}.${id("THREAD_ID")} = ${id("granted")}.${id("OWNER_THREAD_ID")}
          WHERE ${id("waiter")}.${id("PROCESSLIST_ID")} = ${waiting}
            AND ${id("holder")}.${id("PROCESSLIST_ID")} IS NOT NULL
          ORDER BY ${id("id")}`
    );
    const unreadable: string[] = [];
    // A wait for an InnoDB row lock has no pending metadata lock: its holder is read from InnoDB's
    // own lock waits instead.
    const rows =
      metadataRows.length > 0
        ? metadataRows
        : await mysqlRowLockHolders(adapter, waiting).catch(
            (error: unknown) => {
              unreadable.push(
                `The sessions holding a row the change waits for: ${
                  isMysqlPrivilegeRefusal(error)
                    ? "the database user may not read performance_schema.data_lock_waits"
                    : failureReason(error)
                }.`
              );
              return [];
            }
          );
    const found = rows.map(row => ({
      id: String(row.id),
      user: text(row.user),
      clientAddress: hostWithoutPort(text(row.host)),
    }));
    const ages = await mysqlTransactionAges(adapter, found).catch(
      (error: unknown) => {
        unreadable.push(
          `How long each holding session's transaction has been open: ${
            isMysqlPrivilegeRefusal(error)
              ? "the database user may not read information_schema.INNODB_TRX (it needs the PROCESS privilege)"
              : failureReason(error)
          }.`
        );
        return new Map<string, number | null>();
      }
    );
    const sessions = found.map(session => ({
      ...session,
      // MySQL keeps no application name a client can set.
      applicationName: null,
      transactionOpenSeconds: ages.get(session.id) ?? null,
    }));
    return { kind: "named", sessions, unreadable };
  } catch (error) {
    const reason = isMysqlPrivilegeRefusal(error)
      ? "the database user may not read performance_schema (it lacks the SELECT privilege on performance_schema.metadata_locks and performance_schema.threads)"
      : failureReason(error);
    return {
      kind: "named",
      sessions: [],
      unreadable: [`The sessions holding the table: ${reason}.`],
    };
  }
}

/** The sessions whose InnoDB row locks the waiting session's transaction waits for. */
function mysqlRowLockHolders(
  adapter: DrizzleAdapter,
  waiting: number
): Promise<{ id: unknown; user: unknown; host: unknown }[]> {
  return adapter.queryStatement<{ id: unknown; user: unknown; host: unknown }>(
    sql`SELECT DISTINCT ${id("holder")}.${id("PROCESSLIST_ID")} AS ${id("id")},
          ${id("holder")}.${id("PROCESSLIST_USER")} AS ${id("user")},
          ${id("holder")}.${id("PROCESSLIST_HOST")} AS ${id("host")}
        FROM ${id("performance_schema")}.${id("threads")} AS ${id("waiter")}
        JOIN ${id("performance_schema")}.${id("data_lock_waits")} AS ${id("lock_wait")}
          ON ${id("lock_wait")}.${id("REQUESTING_THREAD_ID")} = ${id("waiter")}.${id("THREAD_ID")}
        JOIN ${id("performance_schema")}.${id("threads")} AS ${id("holder")}
          ON ${id("holder")}.${id("THREAD_ID")} = ${id("lock_wait")}.${id("BLOCKING_THREAD_ID")}
        WHERE ${id("waiter")}.${id("PROCESSLIST_ID")} = ${waiting}
          AND ${id("holder")}.${id("PROCESSLIST_ID")} IS NOT NULL
        ORDER BY ${id("id")}`
  );
}

/** How long each session's InnoDB transaction has been open, in whole seconds, by session id. */
async function mysqlTransactionAges(
  adapter: DrizzleAdapter,
  sessions: readonly { id: string }[]
): Promise<Map<string, number | null>> {
  const ids = sessions.flatMap(session => {
    const number = sessionNumberOf(session.id);
    return number === undefined ? [] : [number];
  });
  const ages = new Map<string, number | null>();
  if (ids.length === 0) return ages;
  const rows = await adapter.queryStatement<{
    id: unknown;
    open_seconds: unknown;
  }>(
    sql`SELECT ${id("trx_mysql_thread_id")} AS ${id("id")},
          TIMESTAMPDIFF(SECOND, ${id("trx_started")}, NOW()) AS ${id("open_seconds")}
        FROM ${id("information_schema")}.${id("INNODB_TRX")}
        WHERE ${id("trx_mysql_thread_id")} IN (${sql.join(
          ids.map(number => sql`${number}`),
          sql`, `
        )})`
  );
  for (const row of rows)
    ages.set(String(row.id), wholeSeconds(row.open_seconds));
  return ages;
}

/**
 * The sessions holding a lock `waitingSession` waits for, as the database names them, with each
 * detail it could not read and why. SQLite names none. Never throws: a failed read is a line of
 * the report.
 */
export async function readHolders(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  waitingSession: string | undefined
): Promise<HolderReport> {
  if (dialect === "sqlite") return { kind: "unnamed", reason: SQLITE_REASON };
  const waiting =
    waitingSession === undefined ? undefined : sessionNumberOf(waitingSession);
  if (waiting === undefined) {
    return { kind: "named", sessions: [], unreadable: [UNKNOWN_WAITER] };
  }
  if (dialect === "mysql") return mysqlHolders(adapter, waiting);
  try {
    return await postgresHolders(adapter, waiting);
  } catch (error) {
    return {
      kind: "named",
      sessions: [],
      unreadable: [`The sessions holding the table: ${failureReason(error)}.`],
    };
  }
}
