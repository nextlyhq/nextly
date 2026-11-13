/**
 * A database a test's site starts on more than once, as a deploy starts a
 * site again on the database the last one left: one of the test's own on
 * PostgreSQL and MySQL (created beside the integration database and dropped
 * after), and a scratch file on SQLite, since every boot of the harness
 * otherwise gets a new one.
 *
 * @module __tests__/site-database-harness
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TestDialect } from "@nextlyhq/plugin-sdk/testing";
import { createAdapter } from "nextly/database";
import { vi } from "vitest";

export type Adapter = Awaited<ReturnType<typeof createAdapter>>;

/** A database every boot of a case starts on, and how to remove it. */
export interface SiteDatabase {
  readonly dialect: TestDialect;
  readonly url: string;
  drop(): Promise<void>;
}

/** A name this harness generated, the only kind it builds DDL from. */
function scratchName(prefix: string): string {
  const name = `${prefix}_${randomBytes(6).toString("hex")}`;
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error(name);
  return name;
}

/**
 * A database of the case's own: created beside the integration database on
 * PostgreSQL and MySQL, a file in a scratch folder on SQLite. `prefix` names
 * the suite, in lower case, so a database left behind says whose it is.
 */
export async function siteDatabase(
  dialect: TestDialect,
  prefix: string
): Promise<SiteDatabase> {
  if (dialect === "sqlite") {
    const folder = mkdtempSync(join(tmpdir(), `${prefix}-`));
    return {
      dialect,
      url: `file:${join(folder, "site.sqlite")}`,
      drop: async () => rmSync(folder, { recursive: true, force: true }),
    };
  }
  const serverUrl =
    dialect === "postgresql"
      ? process.env.TEST_POSTGRES_URL
      : process.env.TEST_MYSQL_URL;
  if (serverUrl === undefined) throw new Error(`no URL for ${dialect}`);
  vi.stubEnv("DATABASE_URL", serverUrl);
  vi.stubEnv("DB_DIALECT", dialect);
  const name = scratchName(prefix);
  const server = await createAdapter({ type: dialect, url: serverUrl });
  // Until it is handed back, nothing else can drop the database or close the
  // server connection: a setup that fails part way does both itself, the
  // drop only once the database exists, and then rethrows its own failure.
  let created = false;
  try {
    await server.executeQuery(`CREATE DATABASE ${name}`);
    created = true;
    const url = new URL(serverUrl);
    url.pathname = `/${name}`;
    return {
      dialect,
      url: url.toString(),
      drop: async () => {
        try {
          await server.executeQuery(`DROP DATABASE IF EXISTS ${name}`);
        } finally {
          await server.disconnect();
        }
      },
    };
  } catch (error) {
    if (created) {
      await server
        .executeQuery(`DROP DATABASE IF EXISTS ${name}`)
        .catch(() => {});
    }
    await server.disconnect().catch(() => {});
    throw error;
  }
}

/**
 * An adapter on `database`, for one boot. Core reads its environment when an
 * adapter is made and when a site boots, so it names this database for the
 * whole case, and the boot is given no secret: the harness then makes one,
 * and reads the environment afresh at the boot and again once it is
 * destroyed, so no boot reads what an earlier one, on another dialect, left.
 */
export async function adapterOn(database: SiteDatabase): Promise<Adapter> {
  vi.stubEnv("DATABASE_URL", database.url);
  vi.stubEnv("DB_DIALECT", database.dialect);
  vi.stubEnv("NEXTLY_SECRET", undefined);
  return createAdapter({ type: database.dialect, url: database.url });
}
