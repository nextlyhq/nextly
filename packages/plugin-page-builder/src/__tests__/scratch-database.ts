/**
 * A database a suite boots, migrates and starts against more than once:
 * created beside the integration database on PostgreSQL and MySQL and dropped
 * after, and a file in the suite's own folder on SQLite, since every boot of
 * the harness otherwise gets a new one.
 *
 * @module __tests__/scratch-database
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import type { TestDialect } from "@nextlyhq/plugin-sdk/testing";
import { createAdapter } from "nextly/database";

/** A database of the suite's own, its URL, and how to remove it. */
export interface ScratchDatabase {
  readonly dialect: TestDialect;
  readonly url: string;
  drop(): Promise<void>;
}

/** A name this module generated, the only kind it builds DDL from. */
function scratchName(): string {
  const name = `pb_scratch_${randomBytes(6).toString("hex")}`;
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error(name);
  return name;
}

/** A database created beside the integration one, or a file in `folder`. */
export async function scratchDatabase(
  dialect: TestDialect,
  folder: string
): Promise<ScratchDatabase> {
  if (dialect === "sqlite") {
    return {
      dialect,
      url: `file:${join(folder, "site.sqlite")}`,
      drop: async () => {},
    };
  }
  const adminUrl =
    dialect === "postgresql"
      ? process.env.TEST_POSTGRES_URL
      : process.env.TEST_MYSQL_URL;
  if (adminUrl === undefined) throw new Error(`no URL for ${dialect}`);
  const name = scratchName();
  const admin = await withDatabaseEnvironment(adminUrl, dialect, () =>
    createAdapter({ type: dialect, url: adminUrl })
  );
  try {
    await admin.executeQuery(`CREATE DATABASE ${name}`);
  } catch (error) {
    await admin.disconnect().catch(() => {});
    throw error;
  }
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return {
    dialect,
    url: url.toString(),
    drop: async () => {
      try {
        await admin.executeQuery(`DROP DATABASE IF EXISTS ${name}`);
      } finally {
        await admin.disconnect();
      }
    },
  };
}

/**
 * Name `url` in core's environment, which it reads when an adapter is made,
 * and answer how to put back what it named before.
 */
function nameDatabase(url: string, dialect: TestDialect): () => void {
  const own = {
    DATABASE_URL: process.env.DATABASE_URL,
    DB_DIALECT: process.env.DB_DIALECT,
  };
  process.env.DATABASE_URL = url;
  process.env.DB_DIALECT = dialect;
  return () => {
    for (const [key, value] of Object.entries(own)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

/** `work`, run while core's environment names `url`. */
async function withDatabaseEnvironment<T>(
  url: string,
  dialect: TestDialect,
  work: () => Promise<T>
): Promise<T> {
  const restore = nameDatabase(url, dialect);
  try {
    return await work();
  } finally {
    restore();
  }
}

/**
 * An adapter on `database`. Core's environment is read when an adapter is
 * made, so it names this database while the adapter is open, and is put back
 * by `close`.
 */
export async function openAdapter(database: ScratchDatabase): Promise<{
  adapter: Awaited<ReturnType<typeof createAdapter>>;
  close: () => Promise<void>;
}> {
  const restore = nameDatabase(database.url, database.dialect);
  try {
    const adapter = await createAdapter({
      type: database.dialect,
      url: database.url,
    });
    return {
      adapter,
      close: async () => {
        try {
          await adapter.disconnect();
        } finally {
          restore();
        }
      },
    };
  } catch (error) {
    restore();
    throw error;
  }
}
