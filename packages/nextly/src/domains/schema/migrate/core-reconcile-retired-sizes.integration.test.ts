/**
 * The retired `sizes` column of the media table, and every item's value in
 * it, survive a SQLite rebuild of that table by the core reconcile `nextly
 * migrate` runs on every invocation.
 *
 * Nextly's declaration no longer names the column, and on SQLite a rebuild
 * recreates a table from its target definition and copies only the columns
 * that definition has. The column is the only record of where an older
 * item's size files are, so a rebuild that left it out would leave every one
 * of those files stored, still served, with nothing naming it. The reconcile
 * carries the column into the state the push reaches while the database has
 * it (`withRetainedSizesColumn`).
 *
 * SQLite only, on a database file of its own, so it needs no server and runs
 * in every leg: PostgreSQL and MySQL alter a table in place, and no rebuild
 * copies its columns there.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { retiredSizesColumnDdl } from "../../../__tests__/helpers/retired-image-sizes";
import { createAdapter } from "../../../database/factory";
import { getSchemaEventsDdl } from "../events/schema-events-ddl";
import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";
import { sqliteTableRebuildStatements } from "../pipeline/sql-templates/sqlite-rebuild";

import { reconcileCore } from "./core-reconcile";

type Adapter = Awaited<ReturnType<typeof createAdapter>>;

/** A SQLite database file of its own, and how to take it down again. */
async function openDatabase(): Promise<{
  adapter: Adapter;
  close: () => Promise<void>;
}> {
  const prevUrl = process.env.DATABASE_URL;
  const prevDialect = process.env.DB_DIALECT;
  const dir = mkdtempSync(join(tmpdir(), "nx-retired-sizes-"));
  const url = `file:${join(dir, "core.db")}`;
  process.env.DATABASE_URL = url;
  process.env.DB_DIALECT = "sqlite";
  const adapter = await createAdapter({
    type: "sqlite",
    url,
  } as Parameters<typeof createAdapter>[0]);
  return {
    adapter,
    close: async () => {
      await adapter.disconnect?.();
      if (prevUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevUrl;
      if (prevDialect === undefined) delete process.env.DB_DIALECT;
      else process.env.DB_DIALECT = prevDialect;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const SIZES = JSON.stringify({
  small: {
    path: "2026/01/photo-small.webp",
    url: "/uploads/2026/01/photo-small.webp",
  },
});

describe("the retired sizes column through a rebuild of the media table (sqlite)", () => {
  const dialect = "sqlite";

  it("keeps the column and every item's value in it", async () => {
    const { adapter, close } = await openDatabase();
    try {
      const run = () =>
        reconcileCore({
          db: adapter.getDrizzle(),
          dialect,
          logger: { info: () => {}, warn: () => {} },
          ensureLedger: async () => {
            if (await adapter.tableExists("nextly_schema_events")) return;
            for (const stmt of getSchemaEventsDdl(dialect)) {
              await adapter.executeQuery(stmt);
            }
          },
        });
      const media = async () =>
        (await introspectLiveSnapshot(adapter.getDrizzle(), dialect, ["media"]))
          .tables[0];
      const sizesOf = async (id: string) =>
        (
          (await adapter.executeQuery(
            `SELECT sizes FROM media WHERE id = '${id}'`
          )) as Array<{ sizes: string | null }>
        )[0]?.sizes;

      await run();
      // As an earlier release left the table: the column, and an item
      // naming its size files in it.
      await adapter.executeQuery(retiredSizesColumnDdl(dialect));
      await adapter.executeQuery(
        `INSERT INTO media (id, filename, original_filename, mime_type, size, url, uploaded_at, updated_at) ` +
          `VALUES ('older', '2026/01/photo.png', 'photo.png', 'image/png', 1, '/uploads/2026/01/photo.png', 0, 0)`
      );
      await adapter.executeQuery(
        `UPDATE media SET sizes = '${SIZES}' WHERE id = 'older'`
      );

      // Drift SQLite can only repair by rebuilding `media`: `filename`
      // made nullable, through the production rebuild helper, keeping
      // every column the table has, `sizes` included.
      const live = await media();
      const drifted = {
        ...live!,
        columns: live!.columns.map(column =>
          column.name === "filename" ? { ...column, nullable: true } : column
        ),
      };
      await adapter.executeQuery("PRAGMA foreign_keys = OFF");
      for (const statement of sqliteTableRebuildStatements(drifted)) {
        await adapter.executeQuery(statement);
      }
      await adapter.executeQuery("PRAGMA foreign_keys = ON");
      // The control: the column and its value are there before the
      // reconcile, so finding them after means its rebuild kept them.
      expect(await sizesOf("older")).toBe(SIZES);

      expect((await run()).changed).toBe(true);

      const after = await media();
      // The reconcile rebuilt the table: `filename` is required again.
      expect(
        after?.columns.find(column => column.name === "filename")?.nullable
      ).toBe(false);
      const sizes = after?.columns.find(column => column.name === "sizes");
      expect(sizes?.type.toLowerCase()).toBe("text");
      expect(await sizesOf("older")).toBe(SIZES);
    } finally {
      await close();
    }
  }, 90_000);
});
