/**
 * Playground reset.
 *
 * Wipes the local DB, uploaded media, Next.js / Turbo caches, generated
 * types and Drizzle migrations, then re-runs the seed. Branches on
 * DB_DIALECT: SQLite deletes the file, Postgres drops/recreates the
 * `public` schema, MySQL drops/recreates the database.
 *
 * Does NOT spawn `next dev`. Contributor runs `pnpm dev:app` after.
 *
 * Does NOT touch node_modules, .env, or pnpm-lock.yaml. Those belong
 * to other tools and survive a reset.
 *
 * Usage:
 *   pnpm dev:reset                # SQLite by default
 *   DB_DIALECT=postgresql pnpm dev:reset
 *   DB_DIALECT=mysql pnpm dev:reset
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAYGROUND_DIR = path.resolve(HERE, "..");

// Paths reset under the playground root. Each is `rm -rf`'d.
// Order doesn't matter; force:true makes missing entries a no-op.
const FILE_TARGETS = [
  "public/uploads",
  ".next",
  ".turbo",
  ".nextly",
  "src/types/nextly-types.ts",
  "src/db/migrations",
  "src/db/schemas/collections",
];

export async function wipeFileState(rootDir: string): Promise<void> {
  for (const rel of FILE_TARGETS) {
    await fs.rm(path.join(rootDir, rel), { recursive: true, force: true });
  }
}

/**
 * Deletes a SQLite db file plus the WAL/SHM/journal sidecars that
 * better-sqlite3 may have left around. `force: true` so a missing file
 * is a no-op.
 */
export async function wipeDbSqlite(dbPath: string): Promise<void> {
  for (const ext of ["", "-journal", "-wal", "-shm"]) {
    await fs.rm(dbPath + ext, { force: true });
  }
}

export async function wipeDbPostgres(databaseUrl: string): Promise<void> {
  // Drop and recreate the public schema. Avoids needing superuser on
  // the database itself.
  const { Client } = await import("pg");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  } finally {
    await client.end();
  }
}

export async function wipeDbMysql(databaseUrl: string): Promise<void> {
  const mysql = await import("mysql2/promise");
  const url = new URL(databaseUrl);
  const dbName = url.pathname.replace(/^\//, "");
  if (!dbName) {
    throw new Error(
      "DATABASE_URL for MySQL reset must include the database name in its path"
    );
  }
  const conn = await mysql.createConnection({
    host: url.hostname,
    port: Number(url.port) || 3306,
    user: url.username,
    password: url.password,
    multipleStatements: true,
  });
  try {
    await conn.query(
      `DROP DATABASE IF EXISTS \`${dbName}\`; CREATE DATABASE \`${dbName}\`;`
    );
  } finally {
    await conn.end();
  }
}

/**
 * Resolve the SQLite filesystem path from `DATABASE_URL=file:...`.
 * Relative paths are anchored at PLAYGROUND_DIR (matches the adapter's
 * own resolution at boot).
 */
function resolveSqlitePath(databaseUrl: string | undefined): string {
  const fallback = "file:./data/playground.db";
  const raw = (databaseUrl ?? fallback).replace(/^file:/, "");
  return path.isAbsolute(raw) ? raw : path.resolve(PLAYGROUND_DIR, raw);
}

export async function runReset(): Promise<void> {
  const dialect = process.env.DB_DIALECT ?? "sqlite";
  const databaseUrl = process.env.DATABASE_URL;

  console.log("[nextly] Wiping file state...");
  await wipeFileState(PLAYGROUND_DIR);

  console.log(`[nextly] Wiping ${dialect} database...`);
  if (dialect === "sqlite") {
    await wipeDbSqlite(resolveSqlitePath(databaseUrl));
  } else if (dialect === "postgresql" || dialect === "postgres") {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for postgres reset");
    }
    await wipeDbPostgres(databaseUrl);
  } else if (dialect === "mysql") {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for mysql reset");
    }
    await wipeDbMysql(databaseUrl);
  } else {
    throw new Error(`Unsupported DB_DIALECT: ${dialect}`);
  }

  // No explicit schema re-creation step. Loading the framework via
  // `seedForce()` below triggers Nextly's `ensureFirstRunSetup`, which
  // probes for the system tables and, on a fresh DB (which we just
  // created above), pushes the static schema for us. Running an
  // additional `drizzle-kit push` here would also fail on SQLite
  // because drizzle-kit's connectToSQLite does not mkdir the parent
  // directory we just deleted; the framework's adapter does.
  console.log("[nextly] Re-seeding...");
  // Lazy import so the env-validating side effects in nextly
  // run AFTER tsx has applied --env-file. Same reason seed.ts uses
  // static imports gated by the script's own --env-file invocation.
  const { seedForce } = await import("./seed");
  const result = await seedForce();
  console.log(
    `[nextly] Reset complete: ${result.usersCreated} user, ` +
      `${result.postsCreated} posts, ${result.categoriesCreated} categories, ` +
      `${result.tagsCreated} tags, ${result.mediaUploaded} media`
  );
}

// CLI entry. Wrapped in async IIFE because tsx compiles this file to
// CJS where top-level await is not allowed.
const isCliEntry =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] != null &&
  import.meta.url === `file://${process.argv[1]}`;

if (isCliEntry) {
  void (async () => {
    try {
      await runReset();
      process.exit(0);
    } catch (err) {
      console.error(
        "[nextly] reset crashed:",
        err instanceof Error ? err.message : String(err)
      );
      if (err instanceof Error && err.stack) console.error(err.stack);
      process.exit(1);
    }
  })();
}
