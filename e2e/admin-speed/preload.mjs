/**
 * Loaded into a production playground server with `node --import`, before
 * Nextly or Next.js, by `measure.mjs`. It wraps each database driver the
 * adapters use, the way the integration helper `count-statements.ts` does in
 * process, so every statement the server sends is:
 *
 * - appended to `NEXTLY_SPEED_STATEMENT_LOG` as one JSON line, `{ t, sql }`,
 *   where `t` is the time it was sent, in milliseconds since the epoch;
 * - held for `NEXTLY_SPEED_DB_DELAY_MS` before it is sent, standing in for a
 *   database that far away. Each driver call is one round trip, so a delay per
 *   call is a delay per round trip.
 *
 * Only the driver that the server's dialect loads matters; the others are
 * wrapped if they can be resolved and are simply never called.
 *
 * @module admin-speed/preload
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const LOG = process.env.NEXTLY_SPEED_STATEMENT_LOG;
const DELAY = Number(process.env.NEXTLY_SPEED_DB_DELAY_MS || 0);
const fromApp = createRequire(path.join(process.cwd(), "package.json"));
const fd = LOG ? fs.openSync(LOG, "a") : undefined;

function record(sql) {
  if (fd === undefined) return;
  fs.writeSync(
    fd,
    `${JSON.stringify({ t: Date.now(), sql: String(sql).slice(0, 300) })}\n`
  );
}

/** Resolves `driver` as the named adapter package itself would load it. */
function driverOf(adapter, driver) {
  const main = fromApp.resolve(`@nextlyhq/adapter-${adapter}`);
  return createRequire(main)(driver);
}

/** A callback-style or promise-style call, held for the delay first. */
function wrapAsync(proto, name, sqlOf) {
  const original = proto[name];
  if (typeof original !== "function") return;
  proto[name] = function (...args) {
    record(sqlOf(args));
    if (DELAY <= 0) return original.apply(this, args);
    const hasCallback = typeof args[args.length - 1] === "function";
    if (hasCallback) {
      setTimeout(() => original.apply(this, args), DELAY);
      return undefined;
    }
    // mysql2's pool hands the connection a query command it built and reads
    // the return value at once (to release the connection when the command
    // ends), so the command itself is returned now and sent after the delay.
    // A promise in its place made every delayed MySQL statement throw.
    const [command] = args;
    if (
      command &&
      typeof command === "object" &&
      typeof command.once === "function"
    ) {
      setTimeout(() => original.apply(this, args), DELAY);
      return command;
    }
    return new Promise(resolve => setTimeout(resolve, DELAY)).then(() =>
      original.apply(this, args)
    );
  };
}

/**
 * How deep in a wrapped synchronous call the thread is. better-sqlite3's
 * `pragma()` runs its statement through the statement methods also wrapped
 * here: that inner call is the same statement, logged and held once.
 */
let syncDepth = 0;

/** A synchronous call (better-sqlite3), held by a blocking sleep. */
function wrapSync(proto, name, sqlOf) {
  const original = proto[name];
  if (typeof original !== "function") return;
  const cell = new Int32Array(new SharedArrayBuffer(4));
  proto[name] = function (...args) {
    if (syncDepth > 0) return original.apply(this, args);
    record(sqlOf(this, args));
    if (DELAY > 0) Atomics.wait(cell, 0, 0, DELAY);
    syncDepth += 1;
    try {
      return original.apply(this, args);
    } finally {
      syncDepth -= 1;
    }
  };
}

function tryWrap(label, wrap) {
  try {
    wrap();
  } catch (error) {
    if (process.env.NEXTLY_SPEED_DEBUG) {
      console.warn(`[admin-speed] ${label} not wrapped: ${error?.message}`);
    }
  }
}

tryWrap("pg", () => {
  const pg = driverOf("postgres", "pg");
  wrapAsync(pg.Client.prototype, "query", args =>
    typeof args[0] === "string" ? args[0] : args[0]?.text
  );
});

tryWrap("mysql2", () => {
  const main = createRequire(
    fromApp.resolve("@nextlyhq/adapter-mysql")
  ).resolve("mysql2");
  const Connection = createRequire(main)(
    path.join(path.dirname(main), "lib", "base", "connection.js")
  );
  for (const name of ["query", "execute"]) {
    wrapAsync(Connection.prototype, name, args =>
      typeof args[0] === "string" ? args[0] : args[0]?.sql
    );
  }
});

tryWrap("better-sqlite3", () => {
  const Database = driverOf("sqlite", "better-sqlite3");
  const probe = new Database(":memory:");
  const proto = Object.getPrototypeOf(probe.prepare("select 1"));
  probe.close();
  for (const name of ["all", "get", "run", "iterate"]) {
    wrapSync(proto, name, self => self.source);
  }
  // The adapter also sends statements straight through the database: its
  // transaction boundaries and savepoints through `exec`, its settings
  // through `pragma`.
  wrapSync(Database.prototype, "exec", (_self, args) => args[0]);
  wrapSync(Database.prototype, "pragma", (_self, args) => `PRAGMA ${args[0]}`);
});
