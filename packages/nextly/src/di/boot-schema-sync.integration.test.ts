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
 * Each non-SQLite boot gets its own database, created and dropped by the
 * harness. The property under test is "boot created this table", which says
 * nothing on a database where a previous suite already created it.
 */
import { afterEach, expect, it } from "vitest";

import { defineCollection, text } from "../config";
import { createTestNextly, type TestNextly } from "../plugins/test-nextly";
import { describeEachDialect } from "../plugins/__tests__/helpers/dialect-matrix";

const SLUG = "boot_sync_probes";
const TABLE = `dc_${SLUG}`;

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describeEachDialect("boot auto-sync", dialect => {
  it("creates the table and the collection is usable", async () => {
    current = await createTestNextly({
      dialect,
      collections: [
        defineCollection({ slug: SLUG, fields: [text({ name: "title" })] }),
      ],
    });

    // The table has to exist because BOOT made it, not because a migration or
    // an earlier suite did.
    expect(await current.adapter.tableExists(TABLE)).toBe(true);

    const created = await current.nextly.create({
      collection: SLUG,
      data: { title: "created at boot" },
    });
    expect((created.item as { title?: unknown }).title).toBe("created at boot");
  }, 60_000);
});
