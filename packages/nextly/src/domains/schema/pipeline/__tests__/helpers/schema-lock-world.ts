/**
 * What the schema lock's integration suites share: a database per dialect that both this process
 * and a second one can reach, and that second process, holding the lock.
 *
 * SQLite is a file rather than memory, because the point of several of these tests is a second
 * process on the same file. Every lock table is dropped before and after each test, so each one
 * starts from a database no run has touched.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { createScratchDatabase } from "../../../../../__tests__/helpers/fresh-database";
import { loadDialectTables } from "../../../../../database/dialect-tables";

/** The dialects this run can reach: SQLite always, the servers when their URL is set. */
export const LOCK_DIALECTS: SupportedDialect[] = [
  "sqlite",
  ...(process.env.TEST_POSTGRES_URL ? (["postgresql"] as const) : []),
  ...(process.env.TEST_MYSQL_URL ? (["mysql"] as const) : []),
];

/** Every table a lock keeps its row in, the earlier ones included. */
const LOCK_TABLES = [
  "nextly_schema_lock",
  "nextly_field_group_lock",
  "nextly_migrate_lock",
];

const HOLDER = join(__dirname, "schema-lock-holder.ts");
/** `packages/nextly`, where `tsx` resolves. */
const PACKAGE_ROOT = join(__dirname, "..", "..", "..", "..", "..", "..");

export interface LockWorld {
  readonly dialect: SupportedDialect;
  /** What a second process connects with: the server URL, or the SQLite file. */
  readonly url: string;
  /** A new adapter on the same database, connected, its dialect's tables loaded. */
  connect(): Promise<DrizzleAdapter>;
  /** Drop every lock table and anything with this world's prefix. */
  reset(adapter: DrizzleAdapter, tables?: readonly string[]): Promise<void>;
  /** Remove what the world made: the SQLite file, or a database made for it. */
  dispose(): Promise<void>;
}

/**
 * A world on this run's database, or, with `fresh`, on a database of its own that no other suite
 * has touched — for a test that runs a whole command, whose core reconcile would otherwise meet
 * whatever the suites before it left.
 */
export async function lockWorld(
  dialect: SupportedDialect,
  options: { fresh?: boolean } = {}
): Promise<LockWorld> {
  const dir =
    dialect === "sqlite"
      ? mkdtempSync(join(tmpdir(), "nextly-schema-lock-"))
      : undefined;
  const scratch =
    options.fresh === true && dialect !== "sqlite"
      ? await createScratchDatabase(dialect, "schema_lock")
      : undefined;
  const url =
    scratch !== undefined
      ? scratch.url
      : dialect === "postgresql"
        ? (process.env.TEST_POSTGRES_URL as string)
        : dialect === "mysql"
          ? (process.env.TEST_MYSQL_URL as string)
          : join(dir as string, "site.db");
  return {
    dialect,
    url,
    async connect() {
      const adapter = (dialect === "postgresql"
        ? createPostgresAdapter({ url })
        : dialect === "mysql"
          ? createMySqlAdapter({ url })
          : createSqliteAdapter({
              url: `file:${url}`,
            })) as unknown as DrizzleAdapter;
      await adapter.connect();
      await loadDialectTables(dialect);
      return adapter;
    },
    async reset(adapter, tables = []) {
      for (const table of [...LOCK_TABLES, ...tables]) {
        await adapter.executeQuery(`DROP TABLE IF EXISTS ${table}`);
      }
    },
    async dispose() {
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
      await scratch?.drop();
    },
  };
}

/** A second process holding the schema lock, driven line by line. */
export interface Holder {
  /** Resolves once the process has printed `line`. */
  printed(line: string): Promise<void>;
  send(line: string): void;
  /** Resolves with the exit code (or signal) once the process has ended. */
  readonly exited: Promise<number | string>;
  kill(signal: NodeJS.Signals): void;
}

export function startHolder(
  world: LockWorld,
  args: { command: string; leaseSeconds: number; prefix: string }
): Holder {
  const child: ChildProcessWithoutNullStreams = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      HOLDER,
      world.dialect,
      world.url,
      args.command,
      String(args.leaseSeconds),
      args.prefix,
    ],
    { cwd: PACKAGE_ROOT, env: process.env }
  );
  const seen = new Set<string>();
  const waiting = new Map<string, Array<() => void>>();
  let stderr = "";
  child.stderr.on("data", chunk => {
    stderr += String(chunk);
  });
  createInterface({ input: child.stdout }).on("line", raw => {
    const line = raw.trim();
    seen.add(line);
    for (const resolve of waiting.get(line) ?? []) resolve();
    waiting.delete(line);
  });
  const exited = new Promise<number | string>(resolve => {
    child.on("exit", (code, signal) => resolve(code ?? signal ?? "unknown"));
  });
  return {
    printed(line) {
      if (seen.has(line)) return Promise.resolve();
      return new Promise((resolve, reject) => {
        waiting.set(line, [...(waiting.get(line) ?? []), resolve]);
        void exited.then(how => {
          if (!seen.has(line)) {
            reject(
              new Error(
                `holder exited (${String(how)}) before "${line}": ${stderr}`
              )
            );
          }
        });
      });
    },
    send(line) {
      child.stdin.write(`${line}\n`);
    },
    exited,
    kill(signal) {
      child.kill(signal);
    },
  };
}

/** The tables of this database whose name starts with `prefix`. */
export async function tablesWithPrefix(
  adapter: DrizzleAdapter,
  prefix: string
): Promise<string[]> {
  const all = await adapter.listTables();
  return all.filter(name => name.startsWith(prefix)).sort();
}

export const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));
