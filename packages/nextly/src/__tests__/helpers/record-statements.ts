/**
 * Records every statement the database driver under an adapter is handed, with
 * its parameters, for tests that judge what a step sends to the database.
 *
 * The recorder is installed on the driver itself, below the adapter, the
 * Drizzle handle and drizzle-kit, so a statement cannot reach the database
 * without passing it. It is patched on the driver's prototypes, which every
 * connection shares, so connections opened after it is installed (a start's
 * own adapter included) are recorded too, until `uninstall`:
 * - `pg`: the client's `query`;
 * - `mysql2`: the connection's `query` and `execute`;
 * - `better-sqlite3`: each prepared statement's `run`, `get`, `all` and
 *   `iterate`, and the database's `exec`, so a statement prepared once and run
 *   many times is recorded each time it runs, with the values it ran with.
 *
 * A statement is recorded as its caller wrote it (`asWritten`): the comments a
 * run holding the schema lock puts in front of it on PostgreSQL and MySQL are
 * left out, so a test that judges a statement by how it starts reads the same
 * text on every dialect.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { TestDialect } from "../../plugins/test-nextly";

import { asWritten } from "./statement-as-written";

/** One statement as the driver was handed it. */
export interface RecordedStatement {
  text: string;
  /** Its bound values, where the call carried any. */
  values: readonly unknown[];
  /**
   * The call stack the driver was handed it from, when recorded with
   * `stacks`. Node keeps the awaiting functions in it, so it names the code
   * that asked, not only the driver's own frames.
   */
  stack?: string;
  /** What `context` answered when the driver was handed it. */
  context?: unknown;
}

/** What a recorder has seen so far, and how to take it off. */
export interface StatementRecorder {
  /** Each statement's text, in the order the driver was handed them. */
  readonly statements: string[];
  /** Each statement with its values, in the same order. */
  readonly calls: RecordedStatement[];
  /** Restore the driver's own methods. */
  uninstall(): void;
}

/** The statement text a driver call carries, whatever form it was passed in. */
function statementText(arg: unknown): string | undefined {
  if (typeof arg === "string") return arg;
  if (arg && typeof arg === "object") {
    const shaped = arg as { text?: unknown; sql?: unknown };
    if (typeof shaped.text === "string") return shaped.text;
    if (typeof shaped.sql === "string") return shaped.sql;
  }
  return undefined;
}

/** The values a driver call carries, in the argument or on the query object. */
function statementValues(args: readonly unknown[]): unknown[] {
  const [first, second] = args;
  if (Array.isArray(second)) return second;
  if (first && typeof first === "object") {
    const shaped = first as { values?: unknown };
    if (Array.isArray(shaped.values)) return shaped.values;
  }
  return [];
}

/** The prototype in `start`'s chain that defines `method` itself. */
function ownerOf(start: object, method: string): Record<string, unknown> {
  let proto: object | null = start;
  while (proto && !Object.prototype.hasOwnProperty.call(proto, method)) {
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  if (!proto) throw new Error(`no ${method} on the driver`);
  return proto as Record<string, unknown>;
}

/** Where each dialect's driver takes statements: the object and its methods. */
async function driverEntryPoints(
  adapter: DrizzleAdapter,
  dialect: TestDialect
): Promise<Array<{ instance: object; methods: string[]; sqlite?: boolean }>> {
  const client = (adapter.getDrizzle() as { $client: unknown }).$client;
  if (dialect === "postgresql") {
    const pool = client as {
      connect(): Promise<{ release(): void } & object>;
    };
    const connection = await pool.connect();
    connection.release();
    return [{ instance: connection, methods: ["query"] }];
  }
  if (dialect === "mysql") {
    // The callback pool, which the promise wrapper carries as `pool`.
    type CorePool = {
      getConnection(
        callback: (error: unknown, connection: { release(): void }) => void
      ): void;
    };
    const wrapped = client as { pool?: CorePool };
    const pool = wrapped.pool ?? (client as CorePool);
    const connection = await new Promise<{ release(): void } & object>(
      (resolve, reject) =>
        pool.getConnection((error, conn) =>
          error ? reject(error) : resolve(conn)
        )
    );
    connection.release();
    return [{ instance: connection, methods: ["query", "execute"] }];
  }
  const database = client as {
    prepare(sql: string): object;
  } & object;
  return [
    { instance: database, methods: ["exec"] },
    {
      instance: database.prepare("SELECT 1"),
      methods: ["run", "get", "all", "iterate"],
      sqlite: true,
    },
  ];
}

/**
 * Record every statement the driver under `adapter` is handed, from now until
 * `uninstall`, whichever adapter or connection of that driver hands it.
 */
export async function recordStatements(
  adapter: DrizzleAdapter,
  dialect: TestDialect,
  options: {
    stacks?: boolean;
    /**
     * Read when each statement is handed over, such as an AsyncLocalStorage
     * store a test sets around the code it wants to tell apart.
     */
    context?: () => unknown;
  } = {}
): Promise<StatementRecorder> {
  const statements: string[] = [];
  const calls: RecordedStatement[] = [];
  const restores: Array<() => void> = [];
  for (const { instance, methods, sqlite } of await driverEntryPoints(
    adapter,
    dialect
  )) {
    for (const method of methods) {
      const owner = ownerOf(instance, method);
      const original = owner[method] as (...args: unknown[]) => unknown;
      owner[method] = function (this: unknown, ...args: unknown[]): unknown {
        // A SQLite statement carries its own text; its arguments are values.
        const sent = sqlite
          ? (this as { source?: string }).source
          : statementText(args[0]);
        if (sent !== undefined) {
          const text = asWritten(sent);
          statements.push(text);
          calls.push({
            text,
            values: sqlite ? args : statementValues(args),
            ...(options.stacks === true ? { stack: new Error().stack } : {}),
            ...(options.context ? { context: options.context() } : {}),
          });
        }
        return original.apply(this, args);
      };
      restores.push(() => {
        owner[method] = original;
      });
    }
  }
  return {
    statements,
    calls,
    uninstall: () => restores.forEach(restore => restore()),
  };
}
