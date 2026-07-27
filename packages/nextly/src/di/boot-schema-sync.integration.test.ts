/**
 * Boot-time auto-sync creates a code-first collection's table, on every
 * dialect.
 *
 * `registerServices` provisions the core schema and then applies any
 * code-first collection whose physical table does not exist yet, through the
 * DI-bound `applyDesiredSchema`. On MySQL that apply failed: drizzle-kit's
 * MySQL `pushSchema` takes the database name as a separate argument, and the
 * DI-bound entry point — which is handed a connection, not a URL — passed
 * nothing. Boot logged a warning and continued, so the first query against the
 * collection failed with "table doesn't exist" far from the cause.
 *
 * Each dialect gets its own throwaway database. The property under test is
 * "boot created this table", which says nothing on a database where a previous
 * suite already created it.
 */
import { createPool } from "mysql2";
import { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../config";
import { createAdapter } from "../database/factory";
import { createTestNextly, type TestNextly } from "../plugins/test-nextly";

const DB_NAME = "nextly_boot_sync";
const SLUG = "boot_sync_probes";
const TABLE = `dc_${SLUG}`;

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/**
 * Boot against `url` with one code-first collection, and report whether the
 * collection is usable end to end.
 *
 * The adapter is built here rather than left to the harness default so the
 * boot runs on the dialect under test. Creating it reads pool settings through
 * the lazy env proxy, whose validation requires `DATABASE_URL`, so both env
 * vars are set for the call and restored afterwards — removed rather than
 * reassigned when they were absent, since the integration files share one
 * sequential process.
 */
async function bootAndRoundTrip(
  url: string,
  dialect: "postgresql" | "mysql"
): Promise<{ tableExists: boolean; title: unknown }> {
  const prevUrl = process.env.DATABASE_URL;
  const prevDialect = process.env.DB_DIALECT;
  const restoreEnv = (): void => {
    if (prevUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevUrl;
    if (prevDialect === undefined) delete process.env.DB_DIALECT;
    else process.env.DB_DIALECT = prevDialect;
  };

  try {
    process.env.DATABASE_URL = url;
    process.env.DB_DIALECT = dialect;

    const adapter = await createAdapter({
      type: dialect,
      url,
    } as Parameters<typeof createAdapter>[0]);

    current = await createTestNextly({
      adapter,
      collections: [
        defineCollection({ slug: SLUG, fields: [text({ name: "title" })] }),
      ],
    });

    const created = await current.nextly.create({
      collection: SLUG,
      data: { title: "created at boot" },
    });

    return {
      tableExists: await adapter.tableExists(TABLE),
      title: (created.item as { title?: unknown }).title,
    };
  } finally {
    restoreEnv();
  }
}

describe.skipIf(!process.env.TEST_POSTGRES_URL)(
  "boot auto-sync (postgresql)",
  () => {
    it("creates the table and the collection is usable", async () => {
      const admin = new Pool({
        connectionString: process.env.TEST_POSTGRES_URL,
      });
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
        await admin.query(`CREATE DATABASE ${DB_NAME}`);
        const url = new URL(process.env.TEST_POSTGRES_URL as string);
        url.pathname = `/${DB_NAME}`;

        const result = await bootAndRoundTrip(url.toString(), "postgresql");
        expect(result.tableExists).toBe(true);
        expect(result.title).toBe("created at boot");
      } finally {
        // The harness destroy() in afterEach still holds the connection when
        // this runs, so the drop waits for it.
        await current?.destroy();
        current = undefined;
        await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`).catch(() => {});
        await admin.end();
      }
    }, 60_000);
  }
);

describe.skipIf(!process.env.TEST_MYSQL_URL)("boot auto-sync (mysql)", () => {
  it("creates the table and the collection is usable", async () => {
    const admin = createPool({ uri: process.env.TEST_MYSQL_URL });
    try {
      await admin.promise().query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
      await admin.promise().query(`CREATE DATABASE ${DB_NAME}`);
      const url = new URL(process.env.TEST_MYSQL_URL as string);
      url.pathname = `/${DB_NAME}`;

      const result = await bootAndRoundTrip(url.toString(), "mysql");
      expect(result.tableExists).toBe(true);
      expect(result.title).toBe("created at boot");
    } finally {
      await current?.destroy();
      current = undefined;
      await admin
        .promise()
        .query(`DROP DATABASE IF EXISTS ${DB_NAME}`)
        .catch(() => {});
      await new Promise<void>(res => admin.end(() => res()));
    }
  }, 60_000);
});
