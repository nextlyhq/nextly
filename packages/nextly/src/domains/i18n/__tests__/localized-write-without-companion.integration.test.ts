/**
 * A localized write with no companion table must not destroy content.
 *
 * The dangerous state is a TRANSITION: a collection created WITHOUT localization
 * keeps its translatable columns on the main table, and enabling localization
 * later moves them to `dc_<slug>_locales`. `nextly db:sync` runs in its own
 * process — it flips the registry's `localized` flag but historically left
 * companion creation to the next boot — so a running server can believe the
 * collection is localized, render the full locale switcher, and still have no
 * companion table.
 *
 * Before this guard, a write in a NON-default locale fell through to the main
 * table in that window, overwriting the default language's values and
 * regenerating the slug from the translation, while reporting success.
 * Reproduced on published 0.0.2-alpha.43.
 *
 * The default locale legitimately writes to the main table until the companion
 * exists ("Option B"), so that path must keep working unchanged.
 *
 * File-backed SQLite: `createTestNextly` disconnects the adapter as it boots, so
 * an in-memory database would not survive the second boot that performs the
 * transition.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";

import type { CollectionsHandler } from "../../../services/collections-handler";

let dir: string;
let dbPath: string;
let current: TestNextly | undefined;
// The harness snapshots DB_DIALECT when IT creates an adapter. These tests build
// their own first, so the snapshot captures the already-overwritten "sqlite" and
// never puts the real dialect back — which, in a single-fork run, would make every
// later file resolve environment-backed schema behaviour as SQLite.
let previousDialect: string | undefined;

beforeEach(() => {
  previousDialect = process.env.DB_DIALECT;
  dir = mkdtempSync(join(tmpdir(), "nextly-i18n-window-"));
  dbPath = join(dir, "test.db");
});

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  rmSync(dir, { recursive: true, force: true });
});

const localization = { locales: ["en", "es"], defaultLocale: "en" };

/** Same collection, with localization off (columns on main) or on (companion). */
const posts = (localized: boolean) =>
  defineCollection({
    slug: "i18nwin_posts",
    localized,
    fields: [text({ name: "title", localized: true })],
  });

async function boot(localized: boolean): Promise<TestNextly> {
  process.env.DB_DIALECT = "sqlite";
  const adapter = await createAdapter({
    type: "sqlite",
    url: `file:${dbPath}`,
  } as Parameters<typeof createAdapter>[0]);
  return createTestNextly({
    adapter,
    collections: [posts(localized)],
    localization,
  });
}

/**
 * Read the PHYSICAL main-table title. Once the collection is localized the
 * registered runtime schema omits translatable columns, so `adapter.select`
 * would not return the column that the bug overwrites — the raw read is the
 * only thing that shows what actually landed on disk.
 */
async function physicalTitle(handle: TestNextly): Promise<string | undefined> {
  const rows = await handle.adapter.executeQuery<{ title: string }>(
    "SELECT title FROM dc_i18nwin_posts LIMIT 1"
  );
  return rows[0]?.title;
}

/** Re-open in the localized state, then remove the companion to recreate the window. */
async function enterWindow(): Promise<TestNextly> {
  await current?.destroy();
  current = undefined;
  const handle = await boot(true);
  await handle.adapter.executeQuery(
    "DROP TABLE IF EXISTS dc_i18nwin_posts_locales"
  );
  return handle;
}

describe("localized write without a companion table (integration)", () => {
  it("refuses a non-default-locale write instead of overwriting the default", async () => {
    // Boot 1: not localized, so `title` lives on the main table.
    current = await boot(false);
    const created = await current
      .getService<CollectionsHandler>("collectionsHandler")
      .createEntry(
        { collectionName: "i18nwin_posts", overrideAccess: true },
        { title: "How to Build a Blog" }
      );
    expect(created.success).toBe(true);
    const id = (created.data as { id: string }).id;

    current = await enterWindow();

    const translated = await current
      .getService<CollectionsHandler>("collectionsHandler")
      .updateEntry(
        {
          collectionName: "i18nwin_posts",
          entryId: id,
          overrideAccess: true,
          locale: "es",
        },
        { title: "Cómo crear un blog" }
      );

    // The write must not report success, and it must be OUR refusal rather than
    // a driver error escaping — a raw "no such table" would also be a failure
    // here while meaning the guard never ran.
    expect(translated.success).toBe(false);
    expect(translated.statusCode).toBe(409);
    expect(translated.message).toMatch(/Translations are not ready/);

    // ...and the default-language content must be untouched. This is the
    // assertion that fails without the guard: `es` landed on the main row.
    expect(await physicalTitle(current)).toBe("How to Build a Blog");
  });

  it("still writes the default locale to the main table when no companion exists", async () => {
    // "Option B" preserved: before the companion is created the default language
    // legitimately lives on the main table, so this path must be unchanged.
    current = await boot(false);
    const created = await current
      .getService<CollectionsHandler>("collectionsHandler")
      .createEntry(
        { collectionName: "i18nwin_posts", overrideAccess: true },
        { title: "First" }
      );
    const id = (created.data as { id: string }).id;

    current = await enterWindow();

    const updated = await current
      .getService<CollectionsHandler>("collectionsHandler")
      .updateEntry(
        {
          collectionName: "i18nwin_posts",
          entryId: id,
          overrideAccess: true,
          locale: "en",
        },
        { title: "First (edited)" }
      );

    expect(updated.success).toBe(true);
    expect(await physicalTitle(current)).toBe("First (edited)");
  });
});

/**
 * The guard has to hold on every dialect, and the SQLite cases above cannot show
 * that. What decides whether it fires is `companionTableExists`, which probes
 * with a dialect-quoted `SELECT 1` and swallows the failure — and on Postgres a
 * statement that errors inside an open transaction poisons the rest of it, so
 * "does a refusal come back at all, and is it ours" is a question only a real
 * server answers.
 *
 * One boot is enough here, so the harness can provision a throwaway database per
 * dialect: dropping the companion after the entry exists reproduces the same
 * missing-table state the db:sync transition creates. The collection is localized
 * from the start, so the translatable value never sat on the main table and there
 * is nothing to overwrite — without the guard these return an opaque 500 from the
 * driver rather than losing content. Proving the DEFAULT language's content
 * survives still needs the two-boot SQLite case above, which is the only one that
 * starts with the value on the main table.
 */
describe.each(getConfiguredTestDialects())(
  "localized write without a companion table on %s (integration)",
  dialect => {
    it("refuses a non-default-locale update once the companion is gone", async () => {
      current = await createTestNextly({
        dialect,
        collections: [posts(true)],
        localization,
      });

      const created = await current
        .getService<CollectionsHandler>("collectionsHandler")
        .createEntry(
          {
            collectionName: "i18nwin_posts",
            overrideAccess: true,
            locale: "en",
          },
          { title: "Original" }
        );
      expect(created.success).toBe(true);
      const id = (created.data as { id: string }).id;

      await current.adapter.executeQuery(
        `DROP TABLE IF EXISTS ${dialect === "mysql" ? "`dc_i18nwin_posts_locales`" : '"dc_i18nwin_posts_locales"'}`
      );

      const translated = await current
        .getService<CollectionsHandler>("collectionsHandler")
        .updateEntry(
          {
            collectionName: "i18nwin_posts",
            entryId: id,
            overrideAccess: true,
            locale: "es",
          },
          { title: "Traducción" }
        );

      expect(translated.success).toBe(false);
      expect(translated.statusCode).toBe(409);
      expect(translated.message).toMatch(/Translations are not ready/);
    });
  }
);
