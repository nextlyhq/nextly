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

async function boot(
  localized: boolean,
  defaultLocale = localization.defaultLocale
): Promise<TestNextly> {
  process.env.DB_DIALECT = "sqlite";
  const adapter = await createAdapter({
    type: "sqlite",
    url: `file:${dbPath}`,
  } as Parameters<typeof createAdapter>[0]);
  return createTestNextly({
    adapter,
    collections: [posts(localized)],
    localization: { ...localization, defaultLocale },
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

describe("enabling localization on existing content (integration)", () => {
  it("keeps the default language readable once the companion appears", async () => {
    // Creating the companion is not enough. Once it exists, a read resolves each
    // localized field through it; with no default-locale row it overlays null, so
    // the entity's existing content disappears from every read, list and filter
    // while the values still sit on the main table. The companion has to be
    // SEEDED from main, which is what the boot/db:sync path skipped.
    current = await boot(false);
    const created = await current
      .getService<CollectionsHandler>("collectionsHandler")
      .createEntry(
        { collectionName: "i18nwin_posts", overrideAccess: true },
        { title: "Original" }
      );
    const id = (created.data as { id: string }).id;

    // Two re-boots, because the boot that flips `localized` in the registry is
    // not the boot that creates the companion: the registry is read before the
    // code-first sync writes the flag. That lag is exactly the window this branch
    // closes for `db:sync`; here it just means the companion appears on the boot
    // after, and the seed has to run then.
    await current.destroy();
    current = await boot(true);
    await current.destroy();
    current = await boot(true);

    const read = await current
      .getService<CollectionsHandler>("collectionsHandler")
      .getEntry({
        collectionName: "i18nwin_posts",
        entryId: id,
        overrideAccess: true,
      });

    // Without the seed this is `null`: the companion exists and is empty.
    expect((read.data as { title?: unknown }).title).toBe("Original");
    // The values must also still be on main — seeding copies, it does not move.
    // Dropping those columns is the destructive half of the transition and stays
    // behind the schema pipeline's confirmation.
    expect(await physicalTitle(current)).toBe("Original");
  });

  it("leaves a partly populated companion alone, keeping the main values intact", async () => {
    // Once ANY per-locale row exists, the main columns can no longer be declared to
    // be the default language: nothing records which language they hold, and the
    // rows present may be in another one. Backfilling the remaining entries would
    // therefore risk labelling their content as a language it is not.
    //
    // The cost is that those entries keep reading null until an operator acts, and
    // that is the right side to err on — unreadable content is still intact on the
    // main table and recoverable, whereas a mislabelled translation is silently
    // wrong. This test pins both halves: no backfill, and no data loss.
    current = await boot(false);
    const handler = () =>
      current!.getService<CollectionsHandler>("collectionsHandler");
    const ids: string[] = [];
    for (const title of ["First", "Second", "Third"]) {
      const created = await handler().createEntry(
        { collectionName: "i18nwin_posts", overrideAccess: true },
        { title }
      );
      ids.push((created.data as { id: string }).id);
    }

    await current.destroy();
    current = await boot(true);
    await current.destroy();
    current = await boot(true);

    // Put the companion into the partial state: keep one row, drop the others, so
    // the table is non-empty but two entries have no default-locale row.
    await current.adapter.executeQuery(
      `DELETE FROM dc_i18nwin_posts_locales WHERE _parent <> '${ids[0]}'`
    );

    await current.destroy();
    current = await boot(true);

    // The entry whose row survived still reads; the other two do not get one.
    const kept = await handler().getEntry({
      collectionName: "i18nwin_posts",
      entryId: ids[0],
      overrideAccess: true,
    });
    expect((kept.data as { title?: unknown }).title).toBe("First");

    const rows = await current.adapter.executeQuery<{ n: number }>(
      "SELECT COUNT(*) AS n FROM dc_i18nwin_posts_locales"
    );
    expect(Number(rows[0]?.n)).toBe(1);

    // Nothing was lost: the values the other two entries had are still on main,
    // so an operator can complete the transition without recovering from backups.
    const physical = await current.adapter.executeQuery<{ title: string }>(
      "SELECT title FROM dc_i18nwin_posts ORDER BY title"
    );
    expect(physical.map(r => r.title)).toEqual(["First", "Second", "Third"]);
  });

  it("does not fabricate rows from stale columns after the default language changes", async () => {
    // The main columns are only the default language DURING the transition. Once
    // real translations exist, writes go to the companion and those columns stop
    // being updated — so re-pointing `defaultLocale` at another language must not
    // seed it from them, or the new default serves stale text from the old one and
    // suppresses the fallback that would have shown the real value.
    current = await boot(false);
    const handler = () =>
      current!.getService<CollectionsHandler>("collectionsHandler");
    const ids: string[] = [];
    for (const title of ["Translated later", "Never translated"]) {
      const created = await handler().createEntry(
        { collectionName: "i18nwin_posts", overrideAccess: true },
        { title }
      );
      ids.push((created.data as { id: string }).id);
    }

    await current.destroy();
    current = await boot(true);
    await current.destroy();
    current = await boot(true);

    // One real translation, which is what marks the transition as finished. The
    // OTHER entry is the exposed one: it has no Spanish row, so a seed keyed on
    // the new default would invent one from its stale English column.
    const translated = await handler().updateEntry(
      {
        collectionName: "i18nwin_posts",
        entryId: ids[0],
        overrideAccess: true,
        locale: "es",
      },
      { title: "Texto en español" }
    );
    expect(translated.success).toBe(true);

    // Now Spanish becomes the default. Main still holds the English text.
    await current.destroy();
    current = await boot(true, "es");

    const untranslated = await handler().getEntry({
      collectionName: "i18nwin_posts",
      entryId: ids[1],
      overrideAccess: true,
      locale: "es",
    });
    // Without the guard this reads "Never translated" — English served as Spanish.
    expect((untranslated.data as { title?: unknown }).title).not.toBe(
      "Never translated"
    );

    // Only the two English rows and the one real Spanish translation exist; no
    // Spanish row was fabricated for the untranslated entry.
    const rows = await current.adapter.executeQuery<{ n: number }>(
      "SELECT COUNT(*) AS n FROM dc_i18nwin_posts_locales WHERE _locale = 'es'"
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it("seeds once and does not duplicate rows on later boots", async () => {
    // The seed runs on every boot and sync, so it must be gated on the companion
    // being empty. Without that gate each boot would insert another default-locale
    // row and the composite primary key would start rejecting writes.
    current = await boot(false);
    const created = await current
      .getService<CollectionsHandler>("collectionsHandler")
      .createEntry(
        { collectionName: "i18nwin_posts", overrideAccess: true },
        { title: "Original" }
      );
    const id = (created.data as { id: string }).id;

    await current.destroy();
    current = await boot(true);

    // Translate, so the companion is no longer empty, then re-boot.
    await current
      .getService<CollectionsHandler>("collectionsHandler")
      .updateEntry(
        {
          collectionName: "i18nwin_posts",
          entryId: id,
          overrideAccess: true,
          locale: "en",
        },
        { title: "Edited in the companion" }
      );
    await current.destroy();
    current = await boot(true);

    const read = await current
      .getService<CollectionsHandler>("collectionsHandler")
      .getEntry({
        collectionName: "i18nwin_posts",
        entryId: id,
        overrideAccess: true,
      });
    expect((read.data as { title?: unknown }).title).toBe(
      "Edited in the companion"
    );

    const rows = await current.adapter.executeQuery<{ n: number }>(
      "SELECT COUNT(*) AS n FROM dc_i18nwin_posts_locales"
    );
    expect(Number(rows[0]?.n)).toBe(1);
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
