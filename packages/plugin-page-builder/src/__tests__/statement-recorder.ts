/**
 * Every statement the database driver under an adapter is handed, with the
 * call stack that handed it, for the suites that judge what the page
 * builder sends to the database: how many round trips a pass makes, and
 * whether it writes.
 *
 * Installed on the driver's prototypes, below the adapter and Drizzle, so no
 * statement reaches the database without passing it, from any connection of
 * that driver opened before or after: `pg`'s client `query`, `mysql2`'s
 * connection `query` and `execute`, and `better-sqlite3`'s prepared
 * statement `run`, `get`, `all` and `iterate` and database `exec`.
 *
 * @module __tests__/statement-recorder
 */
import type { TestDialect } from "@nextlyhq/plugin-sdk/testing";

import type { Adapter } from "./site-database-harness";

/** One statement the driver was handed. */
export interface Recorded {
  readonly text: string;
  /** Where it was handed from: Node keeps the awaiting functions in it. */
  readonly stack: string;
}

/** What a recorder has seen so far, and how to take it off. */
export interface StatementRecorder {
  readonly calls: Recorded[];
  uninstall(): void;
}

/** The statement text a driver call carries, in whichever form it came. */
function textOf(arg: unknown): string | undefined {
  if (typeof arg === "string") return arg;
  if (arg !== null && typeof arg === "object") {
    const shaped = arg as { text?: unknown; sql?: unknown };
    if (typeof shaped.text === "string") return shaped.text;
    if (typeof shaped.sql === "string") return shaped.sql;
  }
  return undefined;
}

/** The prototype in `start`'s chain that defines `method` itself. */
function ownerOf(start: object, method: string): Record<string, unknown> {
  let proto: object | null = start;
  while (proto !== null && !Object.hasOwn(proto, method)) {
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  if (proto === null) throw new Error(`no ${method} on the driver`);
  return proto as Record<string, unknown>;
}

/** Where each dialect's driver takes statements: an object and its methods. */
async function entryPoints(
  adapter: Adapter,
  dialect: TestDialect
): Promise<{ instance: object; methods: string[]; sqlite?: boolean }[]> {
  const client = (adapter.getDrizzle() as { $client: unknown }).$client;
  if (dialect === "postgresql") {
    const pool = client as { connect(): Promise<{ release(): void }> };
    const connection = await pool.connect();
    connection.release();
    return [{ instance: connection, methods: ["query"] }];
  }
  if (dialect === "mysql") {
    type CorePool = {
      getConnection(
        callback: (error: unknown, connection: { release(): void }) => void
      ): void;
    };
    const pool = (client as { pool?: CorePool }).pool ?? (client as CorePool);
    const connection = await new Promise<{ release(): void }>(
      (resolve, reject) =>
        pool.getConnection((error, conn) =>
          error ? reject(error) : resolve(conn)
        )
    );
    connection.release();
    return [{ instance: connection, methods: ["query", "execute"] }];
  }
  const database = client as { prepare(sql: string): object };
  return [
    { instance: database, methods: ["exec"] },
    {
      instance: database.prepare("SELECT 1"),
      methods: ["run", "get", "all", "iterate"],
      sqlite: true,
    },
  ];
}

/** Record every statement the driver under `adapter` is handed, until `uninstall`. */
export async function recordStatements(
  adapter: Adapter,
  dialect: TestDialect
): Promise<StatementRecorder> {
  const calls: Recorded[] = [];
  // A statement is several dozen frames below the code that asked for it;
  // the default ten would cut the stack off inside core.
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 200;
  const restores: (() => void)[] = [() => (Error.stackTraceLimit = limit)];
  for (const { instance, methods, sqlite } of await entryPoints(
    adapter,
    dialect
  )) {
    for (const method of methods) {
      const owner = ownerOf(instance, method);
      const original = owner[method] as (...args: unknown[]) => unknown;
      owner[method] = function (this: unknown, ...args: unknown[]): unknown {
        // A SQLite statement carries its own text; its arguments are values.
        const text =
          sqlite === true
            ? (this as { source?: string }).source
            : textOf(args[0]);
        if (text !== undefined) {
          calls.push({ text, stack: new Error().stack ?? "" });
        }
        return original.apply(this, args);
      };
      restores.push(() => {
        owner[method] = original;
      });
    }
  }
  return { calls, uninstall: () => restores.forEach(restore => restore()) };
}

/** Whether `text` writes a row: an insert, an update or a delete. */
export function isWrite(text: string): boolean {
  return /^\s*(insert|update|delete|replace)\b/i.test(text);
}

/** The table a write names, without quoting. */
export function writtenTable(text: string): string | null {
  const match =
    /^\s*(?:insert\s+(?:ignore\s+)?into|update|delete\s+from|replace\s+into)\s+[`"]?([\w$]+)/i.exec(
      text
    );
  return match?.[1] ?? null;
}
