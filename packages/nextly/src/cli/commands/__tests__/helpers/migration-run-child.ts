/**
 * A second process running `nextly migrate`'s core, or `migrate:down`'s, that stops at one
 * statement of a migration file, so a suite can kill it there, or drop its connection, and see
 * what the run leaves behind.
 *
 * Run through `tsx` by `migrate-attempt-stopped.integration.test.ts`, so the code under test is
 * this source, not a build. Arguments: the dialect, the database URL (a file path for SQLite),
 * the migrations folder, `up` or `down`, `before` or `after`, the text the watched statement
 * starts with, and the schema lock's lease in seconds.
 *
 * It runs the command as the CLI does, through an adapter that watches the statements a
 * migration unit sends: in its transaction, on the pool, or on a session. When the watched
 * statement is about to run (`before`) or has run (`after`), it prints `paused` and reads stdin:
 *
 * - `drop` closes its own SQLite connection, as a dropped connection would (a server
 *   connection is dropped by the suite, from outside), and prints `dropped`;
 * - `continue` goes on from where it stopped.
 *
 * When the command ends it prints `ended ok`, or `ended error <code>` and exits with 1.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";

import { loadDialectTables } from "../../../../database/dialect-tables";
import { ensureSchemaEventsTable } from "../../../../domains/schema/events/schema-events-ddl";
import { marksNoTransaction } from "../../../../domains/schema/migrate/split-sql";
import { withMigrateLock } from "../../../../domains/schema/pipeline/locks";
import { NextlyError } from "../../../../errors/nextly-error";
import { createLogger } from "../../../utils/logger";
import { migrateCore, parseSqlSections } from "../../migrate";
import { downDatabaseDeps, migrateDownCore } from "../../migrate-down";

const [dialect, url, migrationsDir, command, when, watched, lease] =
  process.argv.slice(2);
if (
  (dialect !== "postgresql" && dialect !== "mysql" && dialect !== "sqlite") ||
  !url ||
  !migrationsDir ||
  (command !== "up" && command !== "down") ||
  (when !== "before" && when !== "after") ||
  !watched ||
  !lease
) {
  throw new Error(
    "usage: <dialect> <url> <migrationsDir> <up|down> <before|after> <statement start> <leaseSeconds>"
  );
}

const raw = (dialect === "postgresql"
  ? createPostgresAdapter({ url })
  : dialect === "mysql"
    ? createMySqlAdapter({ url })
    : createSqliteAdapter({ url: `file:${url}` })) as unknown as DrizzleAdapter;
await raw.connect();
// What `registerServices` does for an adapter handed to it, which this process skips.
await loadDialectTables(dialect);

const lines = createInterface({ input: process.stdin });
const nextLine = (): Promise<string> =>
  new Promise(resolve => lines.once("line", line => resolve(line.trim())));

let paused = false;

/** Stops at the watched statement once, until the suite says to go on. */
async function pause(): Promise<void> {
  paused = true;
  process.stdout.write("paused\n");
  for (;;) {
    const line = await nextLine();
    if (line === "drop") {
      await raw.disconnect();
      process.stdout.write("dropped\n");
    }
    if (line === "continue") return;
  }
}

/** Runs `statement` through `run`, stopping before or after it when it is the watched one. */
async function watch<T>(statement: unknown, run: () => Promise<T>): Promise<T> {
  const isWatched =
    !paused &&
    typeof statement === "string" &&
    statement.trimStart().startsWith(watched as string);
  if (isWatched && when === "before") await pause();
  const result = await run();
  if (isWatched && when === "after") await pause();
  return result;
}

/** `target` with `method` sent through `watch`; every other member as it is. */
function watching<T extends object>(target: T, method: string): T {
  return new Proxy(target, {
    get(object, property) {
      const value: unknown = Reflect.get(object, property, object);
      if (typeof value !== "function") return value;
      const bound = (value as (...args: unknown[]) => unknown).bind(object);
      if (property !== method) return bound;
      return (statement: unknown, ...rest: unknown[]) =>
        watch(statement, () => Promise.resolve(bound(statement, ...rest)));
    },
  });
}

/**
 * The adapter the command runs on: each way a migration unit sends a statement is watched —
 * its transaction's `execute`, the pool's `executeQuery`, and a session's `execute`.
 */
const adapter = new Proxy(watching(raw, "executeQuery"), {
  get(object, property) {
    if (property === "transaction") {
      return (
        work: (ctx: object) => Promise<unknown>,
        options?: unknown
      ): Promise<unknown> =>
        raw.transaction(
          ctx => work(watching(ctx, "execute")),
          options as Parameters<DrizzleAdapter["transaction"]>[1]
        );
    }
    if (property === "withSession") {
      return (
        work: (session: object) => Promise<unknown>,
        options?: unknown
      ): Promise<unknown> =>
        raw.withSession(
          session => work(watching(session, "execute")),
          options as Parameters<DrizzleAdapter["withSession"]>[1]
        );
    }
    return Reflect.get(object, property, object) as unknown;
  },
}) as DrizzleAdapter;

const logger = createLogger({ quiet: true });
const leaseSeconds = Number(lease);

try {
  if (command === "up") {
    await migrateCore({
      extensionSchema: undefined,
      dialect,
      db: raw.getDrizzle(),
      adapter: adapter as never,
      migrationsDir,
      logger,
      lockMode: "wait",
      lockWaitMs: 30_000,
      ttlSeconds: leaseSeconds,
      lockReleaseOnInterrupt: true,
      ensureLedger: () => ensureSchemaEventsTable(raw),
    });
  } else {
    await migrateDownCore({
      ...(await downDatabaseDeps({ adapter, dialect })),
      nodeEnv: "test",
      logger,
      options: { step: 1, allowDataLoss: true, yes: true },
      fileExists: () => Promise.resolve(true),
      readDownSql: filename => {
        const content = readFileSync(join(migrationsDir, filename), "utf8");
        return Promise.resolve({
          sql: parseSqlSections(content).downSql,
          transaction: !marksNoTransaction(content),
        });
      },
      withLock: (lockAdapter, d, fn, opts) =>
        withMigrateLock(lockAdapter, d, fn, {
          ...opts,
          ttlSeconds: leaseSeconds,
        }),
    });
  }
  process.stdout.write("ended ok\n");
} catch (error) {
  process.stdout.write(
    `ended error ${NextlyError.is(error) ? error.code : String(error)}\n`
  );
  // As the CLI ends a command that failed.
  process.exitCode = 1;
}
lines.close();
await raw.disconnect().catch(() => undefined);
