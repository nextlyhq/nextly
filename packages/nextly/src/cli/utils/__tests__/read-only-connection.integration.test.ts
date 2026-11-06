/**
 * The connection a dry run opens changes nothing, on any dialect: a SQLite
 * file that is not there is named and neither it nor its folder is made, a
 * PostgreSQL schema that is not there is not created (the config refuses any
 * but `public` before connecting, and the adapter's read-only connect checks
 * for it instead of creating it), and a database that is there opens as
 * before. MySQL creates nothing on connect,
 * so it only has to open.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it } from "vitest";

import { _resetEnvCache } from "../../../shared/lib/env";
import { createCliAdapter, openDryRunAdapter } from "../adapter";

const dirs: string[] = [];
afterEach(() => {
  _resetEnvCache();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "nextly-read-only-"));
  dirs.push(dir);
  return dir;
}

describe("openDryRunAdapter on SQLite", () => {
  it("names a missing file and makes neither it nor its folder", async () => {
    const dir = tempDir();
    const folder = join(dir, "no/such/folder");
    const opened = await openDryRunAdapter({
      dialect: "sqlite",
      databaseUrl: `file:${join(folder, "app.db")}`,
    });

    expect(opened).toEqual({
      missing: expect.stringContaining("The database does not exist"),
    });
    expect(existsSync(folder)).toBe(false);
  });

  it("opens a file that is there and leaves it as it was", async () => {
    const dir = tempDir();
    const file = join(dir, "app.db");
    const url = `file:${file}`;
    const made = await createCliAdapter({
      dialect: "sqlite",
      databaseUrl: url,
    });
    await made.disconnect();
    const before = readFileSync(file);

    const opened = await openDryRunAdapter({
      dialect: "sqlite",
      databaseUrl: url,
    });
    expect("missing" in opened).toBe(false);
    if (!("missing" in opened)) {
      await (opened as unknown as DrizzleAdapter).listTables();
      await opened.disconnect();
    }
    expect(readFileSync(file).equals(before)).toBe(true);
  });
});

const POSTGRES_URL = process.env.TEST_POSTGRES_URL;
const MYSQL_URL = process.env.TEST_MYSQL_URL;

describe.skipIf(!POSTGRES_URL)("openDryRunAdapter on PostgreSQL", () => {
  /** Whether the database has a schema of this name. */
  async function schemaExists(name: string): Promise<boolean> {
    const admin = await createCliAdapter({
      dialect: "postgresql",
      databaseUrl: POSTGRES_URL,
      schema: "public",
    });
    try {
      const rows = await (admin as unknown as DrizzleAdapter).executeQuery<{
        nspname: string;
      }>(`SELECT nspname FROM pg_namespace WHERE nspname = '${name}'`);
      return rows.length > 0;
    } finally {
      await admin.disconnect();
    }
  }

  it("refuses a schema other than public before connecting, and creates nothing", async () => {
    const schema = `nx_dry_${randomBytes(4).toString("hex")}`;
    await expect(
      openDryRunAdapter({
        dialect: "postgresql",
        databaseUrl: POSTGRES_URL,
        schema,
      })
    ).rejects.toMatchObject({ code: "NEXTLY_POSTGRES_SCHEMA_UNSUPPORTED" });
    expect(await schemaExists(schema)).toBe(false);
  });

  it("connects read-only without creating a missing schema, where a plain connect creates it", async () => {
    // The adapter's own guard, reached directly: Nextly's config refuses any
    // schema but `public` before an adapter exists.
    const { createPostgresAdapter } = await import(
      "@nextlyhq/adapter-postgres"
    );
    const schema = `nx_dry_${randomBytes(4).toString("hex")}`;

    const readOnly = createPostgresAdapter({
      url: POSTGRES_URL,
      schema,
      readOnly: true,
    });
    await expect(readOnly.connect()).rejects.toMatchObject({ code: "3F000" });
    expect(await schemaExists(schema)).toBe(false);

    const plain = createPostgresAdapter({ url: POSTGRES_URL, schema });
    await plain.connect();
    try {
      expect(await schemaExists(schema)).toBe(true);
    } finally {
      await plain.executeQuery(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await plain.disconnect();
    }
  });

  it("opens a schema that is there", async () => {
    const opened = await openDryRunAdapter({
      dialect: "postgresql",
      databaseUrl: POSTGRES_URL,
      schema: "public",
    });
    expect("missing" in opened).toBe(false);
    if (!("missing" in opened)) await opened.disconnect();
  });
});

describe.skipIf(!MYSQL_URL)("openDryRunAdapter on MySQL", () => {
  it("opens the database as before", async () => {
    const opened = await openDryRunAdapter({
      dialect: "mysql",
      databaseUrl: MYSQL_URL,
    });
    expect("missing" in opened).toBe(false);
    if (!("missing" in opened)) await opened.disconnect();
  });
});
