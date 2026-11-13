/**
 * Every statement a database driver is handed while a log is open, for the
 * suites that judge what one step costs in round trips.
 *
 * Installed on the driver itself, below the adapter and Drizzle, so no
 * statement reaches the database without passing it, and on the driver's
 * prototypes, which every connection shares: a boot's own adapter, opened
 * after the log, is logged too. `pg` takes statements at the client's
 * `query`, `mysql2` at the connection's `query` and `execute`, and
 * `better-sqlite3` at a prepared statement's `run`, `get`, `all` and
 * `iterate` and the database's `exec`.
 *
 * @module __tests__/statement-log
 */
import type { TestDialect } from "@nextlyhq/plugin-sdk/testing";
import type { createAdapter } from "nextly/database";

type Adapter = Awaited<ReturnType<typeof createAdapter>>;

/** The statements handed over so far, and how to stop logging them. */
export interface StatementLog {
  /** Each statement's text, in the order the driver was handed them. */
  readonly statements: string[];
  /**
   * Each statement the database refused, as `<error code> <statement>`:
   * the driver answers a refusal through the promise or the callback it was
   * handed, whoever caught it after.
   */
  readonly refused: string[];
  /**
   * Resolve once the driver has been handed no statement for `ms`, or after
   * `most` whatever it is handed: what was running before a step, or after
   * it, is over by then.
   */
  quiet(ms?: number, most?: number): Promise<void>;
  /** Put the driver's own methods back. */
  close(): void;
}

/** A driver call's statement text, whatever form it was passed in. */
function textOf(arg: unknown): string | undefined {
  if (typeof arg === "string") return arg;
  if (typeof arg !== "object" || arg === null) return undefined;
  const { text, sql } = arg as { text?: unknown; sql?: unknown };
  if (typeof text === "string") return text;
  return typeof sql === "string" ? sql : undefined;
}

/** The object in `start`'s prototype chain that defines `method`. */
function definerOf(start: object, method: string): Record<string, unknown> {
  for (
    let at: object | null = start;
    at !== null;
    at = Object.getPrototypeOf(at) as object | null
  ) {
    if (Object.prototype.hasOwnProperty.call(at, method)) {
      return at as Record<string, unknown>;
    }
  }
  throw new Error(`the driver has no ${method}`);
}

/** One connection the pool lends, given straight back. */
async function lentConnection(client: unknown): Promise<object> {
  type Lent = { release(): void } & object;
  const pool = client as {
    pool?: unknown;
    connect?: () => Promise<Lent>;
  };
  if (typeof pool.connect === "function") {
    const connection = await pool.connect();
    connection.release();
    return connection;
  }
  // mysql2's promise pool carries its callback pool as `pool`.
  const callbacks = (pool.pool ?? client) as {
    getConnection(done: (error: unknown, connection: Lent) => void): void;
  };
  const connection = await new Promise<Lent>((resolve, reject) =>
    callbacks.getConnection((error, lent) =>
      error ? reject(error) : resolve(lent)
    )
  );
  connection.release();
  return connection;
}

/** Where each dialect's driver is handed statements. */
async function entryPoints(
  adapter: Adapter,
  dialect: TestDialect
): Promise<{ on: object; methods: string[]; prepared?: true }[]> {
  const client = (adapter.getDrizzle() as { $client: unknown }).$client;
  if (dialect !== "sqlite") {
    return [
      {
        on: await lentConnection(client),
        methods: dialect === "postgresql" ? ["query"] : ["query", "execute"],
      },
    ];
  }
  const database = client as { prepare(sql: string): object } & object;
  return [
    { on: database, methods: ["exec"] },
    {
      on: database.prepare("SELECT 1"),
      methods: ["run", "get", "all", "iterate"],
      prepared: true,
    },
  ];
}

/**
 * Log every statement the driver under `adapter` is handed, by any adapter or
 * connection of that driver, until `close`.
 */
export async function openStatementLog(
  adapter: Adapter,
  dialect: TestDialect
): Promise<StatementLog> {
  const statements: string[] = [];
  const refused: string[] = [];
  const restores: (() => void)[] = [];
  let lastAt = Date.now();
  for (const { on, methods, prepared } of await entryPoints(adapter, dialect)) {
    for (const method of methods) {
      const definer = definerOf(on, method);
      const original = definer[method] as (...args: unknown[]) => unknown;
      definer[method] = function (this: unknown, ...args: unknown[]) {
        // A prepared SQLite statement carries its own text.
        const text = prepared
          ? (this as { source?: string }).source
          : textOf(args[0]);
        if (text === undefined) return original.apply(this, args);
        statements.push(text);
        lastAt = Date.now();
        const refuse = (error: unknown) => {
          if (error === null || error === undefined) return;
          const code = (error as { code?: unknown }).code;
          refused.push(`${String(code ?? "?")} ${text}`);
        };
        // A callback is handed the refusal; a promise rejects with it.
        const last = args.length - 1;
        if (last >= 0 && typeof args[last] === "function") {
          const done = args[last] as (...results: unknown[]) => unknown;
          args[last] = function (this: unknown, ...results: unknown[]) {
            refuse(results[0]);
            return done.apply(this, results);
          };
        }
        const result = original.apply(this, args);
        if (result instanceof Promise) {
          result.catch(refuse);
        }
        return result;
      };
      restores.push(() => {
        definer[method] = original;
      });
    }
  }
  const quiet = async (ms = 400, most = 15_000): Promise<void> => {
    const until = Date.now() + most;
    while (Date.now() - lastAt < ms && Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };
  return {
    statements,
    refused,
    quiet,
    close: () => restores.forEach(restore => restore()),
  };
}

/** The statements among `statements` naming `table`, quoted as any dialect quotes it. */
export function naming(statements: readonly string[], table: string): string[] {
  const quoted = new RegExp(`["\`]${table}["\`]`);
  return statements.filter(statement => quoted.test(statement));
}
