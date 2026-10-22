/**
 * Counts the statements that reach the database while a piece of work runs,
 * whatever layer sent them.
 *
 * Each dialect's driver is wrapped where its adapter loads it, so the count is
 * what the database received: better-sqlite3's statement methods, pg's
 * `Client#query` (pooled or not), and mysql2's core connection's `query` and
 * `execute`. The wrappers are installed once and record only while a count is
 * under way.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { TestDialect } from "../../../../plugins/test-nextly";

type Method = (this: unknown, ...args: unknown[]) => unknown;

const recording = { on: false, statements: [] as string[] };
const wrapped = new Set<TestDialect>();

/** The driver module `adapter` loads, resolved from that adapter. */
function driverOf(adapter: string, driver: string): unknown {
  const main = createRequire(import.meta.url).resolve(
    `@nextlyhq/adapter-${adapter}`
  );
  return createRequire(main)(driver);
}

/** Wraps `proto[name]` so each call records the statement `sqlOf` names. */
function wrap(
  proto: Record<string, Method>,
  name: string,
  sqlOf: (self: unknown, args: unknown[]) => unknown
): void {
  const original = proto[name];
  if (typeof original !== "function") {
    throw new Error(`the driver has no ${name} to count statements through`);
  }
  proto[name] = function (this: unknown, ...args: unknown[]) {
    if (recording.on) recording.statements.push(String(sqlOf(this, args)));
    return original.apply(this, args);
  };
}

function wrapSqlite(): void {
  const Database = driverOf("sqlite", "better-sqlite3") as new (
    path: string
  ) => { prepare(sql: string): object; close(): void };
  const probe = new Database(":memory:");
  const proto = Object.getPrototypeOf(probe.prepare("select 1")) as Record<
    string,
    Method
  >;
  probe.close();
  for (const name of ["all", "get", "run", "iterate"]) {
    wrap(proto, name, self => (self as { source: string }).source);
  }
}

function wrapPostgres(): void {
  const pg = driverOf("postgres", "pg") as {
    Client: { prototype: Record<string, Method> };
  };
  wrap(pg.Client.prototype, "query", (_self, args) =>
    typeof args[0] === "string" ? args[0] : (args[0] as { text?: string })?.text
  );
}

function wrapMysql(): void {
  // mysql2 exports no path to its core connection, so it is required by its
  // own file, the module instance mysql2 itself loaded.
  const main = createRequire(
    createRequire(import.meta.url).resolve("@nextlyhq/adapter-mysql")
  ).resolve("mysql2");
  const Connection = createRequire(main)(
    join(dirname(main), "lib", "base", "connection.js")
  ) as { prototype: Record<string, Method> };
  for (const name of ["query", "execute"]) {
    wrap(Connection.prototype, name, (_self, args) =>
      typeof args[0] === "string" ? args[0] : (args[0] as { sql?: string })?.sql
    );
  }
}

const WRAP: Record<TestDialect, () => void> = {
  sqlite: wrapSqlite,
  postgresql: wrapPostgres,
  mysql: wrapMysql,
};

/**
 * The statements `work` sent to the database on `dialect`, in order.
 * Counts are not nested.
 */
export async function statementsOf(
  dialect: TestDialect,
  work: () => Promise<unknown>
): Promise<string[]> {
  if (!wrapped.has(dialect)) {
    WRAP[dialect]();
    wrapped.add(dialect);
  }
  recording.statements = [];
  recording.on = true;
  try {
    await work();
  } finally {
    recording.on = false;
  }
  return recording.statements;
}
