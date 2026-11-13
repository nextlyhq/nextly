/**
 * Counts the statements that reach the database while a piece of work runs,
 * whatever layer sent them, for the SEO plugin's cost tests.
 *
 * Each dialect's driver is wrapped where Nextly's adapter loads it: the
 * plugin depends on no adapter itself, so each driver is resolved from the
 * adapter package `nextly` depends on. The count is what the database
 * received: better-sqlite3's statement methods, pg's `Client#query`, and
 * mysql2's core connection's `query` and `execute`. The wrappers are
 * installed once and record only while a count is under way.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { TestDialect } from "@nextlyhq/plugin-sdk/testing";

type Method = (this: unknown, ...args: unknown[]) => unknown;

const recording = { on: false, statements: [] as string[] };
const wrapped = new Set<TestDialect>();

/** A `require` that resolves from `@nextlyhq/adapter-<adapter>`'s own files. */
function fromAdapter(adapter: string): NodeRequire {
  // From `nextly`'s own folder: its exports name no `require` entry to
  // resolve it by, and its folder is where its dependencies are found.
  const nextly = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../node_modules/nextly/package.json"
  );
  return createRequire(
    createRequire(nextly).resolve(`@nextlyhq/adapter-${adapter}`)
  );
}

/**
 * The statement to hold back, where one is armed: the first whose text
 * `match` accepts is not sent until `released` settles. One-shot, so the
 * statements sent while it waits go through.
 */
let holding:
  | { match: RegExp; reached: (sql: string) => void; released: Promise<void> }
  | undefined;

/**
 * Wraps `proto[name]` so each call records the statement `sqlOf` names, and
 * an armed hold keeps back the statement it matches. Only an asynchronous
 * driver's call can be held (`deferrable`): a synchronous one returns its
 * answer at once.
 */
function wrap(
  proto: Record<string, Method>,
  name: string,
  sqlOf: (self: unknown, args: unknown[]) => unknown,
  deferrable = false
): void {
  const original = proto[name];
  if (typeof original !== "function") {
    throw new Error(`the driver has no ${name} to count statements through`);
  }
  proto[name] = function (this: unknown, ...args: unknown[]) {
    const sql = String(sqlOf(this, args));
    if (recording.on) recording.statements.push(sql);
    const hold = holding;
    if (deferrable && hold !== undefined && hold.match.test(sql)) {
      holding = undefined;
      hold.reached(sql);
      const send = () => original.apply(this, args);
      // A callback call's caller reads nothing it returns; a promise call's
      // caller awaits the statement, which now waits for the release.
      if (typeof args[args.length - 1] === "function") {
        void hold.released.then(send);
        return undefined;
      }
      return hold.released.then(send);
    }
    return original.apply(this, args);
  };
}

const WRAP: Record<TestDialect, () => void> = {
  sqlite() {
    const Database = fromAdapter("sqlite")("better-sqlite3") as new (
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
  },
  postgresql() {
    const pg = fromAdapter("postgres")("pg") as {
      Client: { prototype: Record<string, Method> };
    };
    wrap(
      pg.Client.prototype,
      "query",
      (_self, args) =>
        typeof args[0] === "string"
          ? args[0]
          : (args[0] as { text?: string })?.text,
      true
    );
  },
  mysql() {
    // mysql2 exports no path to its core connection, so it is required by its
    // own file, the module instance mysql2 itself loaded.
    const main = fromAdapter("mysql").resolve("mysql2");
    const Connection = createRequire(main)(
      join(dirname(main), "lib", "base", "connection.js")
    ) as { prototype: Record<string, Method> };
    for (const name of ["query", "execute"]) {
      wrap(
        Connection.prototype,
        name,
        (_self, args) =>
          typeof args[0] === "string"
            ? args[0]
            : (args[0] as { sql?: string })?.sql,
        true
      );
    }
  },
};

/** Install `dialect`'s driver wrappers, once. */
function installWrappers(dialect: TestDialect): void {
  if (!wrapped.has(dialect)) {
    WRAP[dialect]();
    wrapped.add(dialect);
  }
}

/**
 * Hold back the next statement sent on `dialect` whose text `match` accepts,
 * before the database sees it, until `release` is called. `reached` settles
 * once it is being held. PostgreSQL and MySQL only: SQLite's driver answers
 * at once and cannot be held.
 */
export function holdNextStatement(
  dialect: TestDialect,
  match: RegExp
): { reached: Promise<string>; release: () => void } {
  if (dialect === "sqlite") {
    throw new Error(
      "a SQLite statement cannot be held: its driver is synchronous"
    );
  }
  installWrappers(dialect);
  let reach!: (sql: string) => void;
  const reached = new Promise<string>(resolve => {
    reach = resolve;
  });
  let release!: () => void;
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  holding = { match, reached: reach, released };
  return { reached, release };
}

/** The statements `work` sent to the database on `dialect`, in order. */
export async function statementsOf(
  dialect: TestDialect,
  work: () => Promise<unknown>
): Promise<string[]> {
  installWrappers(dialect);
  recording.statements = [];
  recording.on = true;
  try {
    await work();
  } finally {
    recording.on = false;
  }
  return recording.statements;
}

/** The statements among `statements` that change a row. */
export function writesAmong(statements: readonly string[]): string[] {
  return statements.filter(sql =>
    /^\s*(insert|update|delete|replace)\b/i.test(sql)
  );
}
