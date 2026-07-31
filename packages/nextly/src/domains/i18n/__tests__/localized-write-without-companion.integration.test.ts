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

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { forgetCompanionReadiness } from "../runtime/companion-readiness";

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

/**
 * Drop a companion the way this file needs it gone.
 *
 * Dropping the table is a shortcut to the state these tests are about: a server that believes an
 * entity is localized while no companion exists. The route users actually take there is a
 * `db:sync` transition, which flips the registry flag from its own process and leaves the server
 * having never seen a companion at all — so nothing is remembered about it. Forgetting the
 * readiness verdict reproduces that, rather than the different situation of a table vanishing from
 * under a process that had already used it.
 */
async function dropCompanion(
  nextly: TestNextly,
  table: string,
  dialect: string
): Promise<void> {
  const quoted = dialect === "mysql" ? `\`${table}\`` : `"${table}"`;
  await nextly.adapter.executeQuery(`DROP TABLE IF EXISTS ${quoted}`);
  forgetCompanionReadiness(nextly.adapter, table);
}

/** Same collection, with localization off (columns on main) or on (companion). */
const posts = (localized: boolean) =>
  defineCollection({
    slug: "i18nwin_posts",
    localized,
    fields: [text({ name: "title", localized: true })],
  });

/**
 * Same shape plus a genuinely SHARED field. `localized: false` is load-bearing: in a
 * localized collection a text field localizes by default (`defaultLocalizedForType`), so
 * without the explicit flag `author` would live on the companion too and the main table
 * would have no column at all.
 *
 * That distinction is the whole point of this fixture. With a real shared column the
 * UPDATE still has something valid to write, which is the shape that can commit a partial
 * row rather than failing outright.
 */
const mixedPosts = (localized: boolean) =>
  defineCollection({
    slug: "i18nwin_mixed",
    localized,
    fields: [
      text({ name: "title", localized: true }),
      text({ name: "author", localized: false }),
    ],
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
  forgetCompanionReadiness(handle.adapter, "dc_i18nwin_posts_locales");
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

      await dropCompanion(current, "dc_i18nwin_posts_locales", dialect);

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

    it("refuses a default-locale update when the main table never had the column", async () => {
      // The other half of the same window. The default language keeps the pre-companion
      // fallback, so the split hands its values back to the main payload — but a
      // collection localized from creation never had those columns on the main table.
      // Without the guard the write reaches the driver and dies there: measured at 409
      // with it, 500 without, on every dialect. The content is not lost, but the caller
      // is told nothing it can act on.
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

      await dropCompanion(current, "dc_i18nwin_posts_locales", dialect);

      const updated = await current
        .getService<CollectionsHandler>("collectionsHandler")
        .updateEntry(
          {
            collectionName: "i18nwin_posts",
            entryId: id,
            overrideAccess: true,
            locale: "en",
          },
          { title: "Edited" }
        );

      expect(updated.success).toBe(false);
      expect(updated.statusCode).toBe(409);
      expect(updated.message).toMatch(/Translations are not ready/);
    });

    it("does not half-apply the write when a shared field accompanies the translation", async () => {
      // A real shared column alongside the translatable one is the shape most likely to
      // commit a partial write, because `author` on its own would make a perfectly valid
      // UPDATE. Measured: it still does not — the statement carries `title` too, the main
      // table has no such column, and the whole statement fails as a 500. So the guard's
      // contribution here is an actionable 409 in place of a driver error, not the
      // prevention of a silent half-write.
      //
      // The `author` assertion holds that line: were the write ever to become partial,
      // keeping the shared half and dropping the translation, this is what would catch it.
      current = await createTestNextly({
        dialect,
        collections: [mixedPosts(true)],
        localization,
      });

      const created = await current
        .getService<CollectionsHandler>("collectionsHandler")
        .createEntry(
          {
            collectionName: "i18nwin_mixed",
            overrideAccess: true,
            locale: "en",
          },
          { title: "Original", author: "Ada" }
        );
      expect(created.success).toBe(true);
      const id = (created.data as { id: string }).id;

      await dropCompanion(current, "dc_i18nwin_mixed_locales", dialect);

      const updated = await current
        .getService<CollectionsHandler>("collectionsHandler")
        .updateEntry(
          {
            collectionName: "i18nwin_mixed",
            entryId: id,
            overrideAccess: true,
            locale: "en",
          },
          { title: "Edited", author: "Grace" }
        );

      expect(updated.success).toBe(false);
      expect(updated.statusCode).toBe(409);

      // The refusal has to be total. A half-applied write that keeps the shared field and
      // drops the translation is exactly the loss this guard exists to prevent.
      const rows = await current.adapter.executeQuery<{ author: string }>(
        `SELECT author FROM ${dialect === "mysql" ? "`dc_i18nwin_mixed`" : '"dc_i18nwin_mixed"'}`
      );
      expect(rows[0]?.author).toBe("Ada");
    });
  }
);

/**
 * A dynamic zone permits several field-group types, but a write only touches the ones its
 * payload actually contains. The pre-transaction guard has to scope itself the same way.
 *
 * Scoping it to the PERMITTED list instead refuses a perfectly good save whenever any other
 * allowed type is missing its companion — a type this write was never going to touch. The
 * parent collection here is NOT localized, which is also the case that reaches this guard
 * without passing through the collection or single ones.
 */
/**
 * A dynamic zone defaults to `repeatable: false`, and then its payload is a single OBJECT rather
 * than an array. The pre-transaction check and the write must agree about that, or the check
 * silently covers nothing: reading the object as "no instances" leaves the slug out of the
 * presence map, and the write goes looking for the companion table from inside the transaction —
 * which is the failure the check exists to prevent, and on PostgreSQL aborts the transaction.
 *
 * The refusal must therefore still be the actionable 409, not a driver error.
 */
describe.each(getConfiguredTestDialects())(
  "non-repeatable dynamic zone with no companion on %s (integration)",
  dialect => {
    it("refuses with a 409 rather than a database failure", async () => {
      current = await createTestNextly({
        dialect,
        fieldGroups: [
          defineFieldGroup({
            slug: "znsingle",
            localized: true,
            fields: [text({ name: "heading", localized: true })],
          }),
        ],
        collections: [
          defineCollection({
            slug: "i18nwin_single",
            fields: [
              text({ name: "title" }),
              // No `repeatable`, so the payload below is one object, not an array.
              fieldGroup({ name: "hero", components: ["znsingle"] }),
            ],
          }),
        ],
        localization,
      });

      await dropCompanion(current, "comp_znsingle_locales", dialect);

      const created = await current
        .getService<CollectionsHandler>("collectionsHandler")
        .createEntry(
          {
            collectionName: "i18nwin_single",
            overrideAccess: true,
            locale: "es",
          },
          {
            title: "Page",
            hero: { _componentType: "znsingle", heading: "Hola" },
          }
        );

      expect(created.success).toBe(false);
      expect(created.statusCode).toBe(409);
      expect(created.message).toMatch(/Translations are not ready/);
    });
  }
);

describe("dynamic zone whose unused field group has no companion (integration)", () => {
  it("saves a block type whose companion exists while another permitted type's is missing", async () => {
    current = await createTestNextly({
      fieldGroups: [
        defineFieldGroup({
          slug: "znok",
          localized: true,
          fields: [text({ name: "heading", localized: true })],
        }),
        defineFieldGroup({
          slug: "znbroken",
          localized: true,
          fields: [text({ name: "caption", localized: true })],
        }),
      ],
      collections: [
        defineCollection({
          slug: "i18nwin_zone",
          fields: [
            text({ name: "title" }),
            fieldGroup({
              name: "layout",
              components: ["znok", "znbroken"],
              repeatable: true,
            }),
          ],
        }),
      ],
      localization,
    });

    // Only the type this write does NOT use loses its companion.
    await dropCompanion(current, "comp_znbroken_locales", "sqlite");

    const created = await current
      .getService<CollectionsHandler>("collectionsHandler")
      .createEntry(
        { collectionName: "i18nwin_zone", overrideAccess: true, locale: "en" },
        {
          title: "Page",
          layout: [{ _componentType: "znok", heading: "Hello" }],
        }
      );

    expect(created.success).toBe(true);
  });
});

describe.each(getConfiguredTestDialects())(
  "companion read failures on a collection read on %s (integration)",
  dialect => {
    it("does not put the driver's own words on the wire", async () => {
      // The companion reads no longer swallow a failure — deciding existence by catching one is
      // what aborted PostgreSQL transactions. Propagating is right, but it made a path that
      // previously could not throw start throwing, and `listEntries` puts a bare Error's message
      // into its result: the failed query, with companion table and column names in it.
      current = await createTestNextly({
        dialect,
        collections: [posts(true)],
        localization,
      });
      const handler =
        current.getService<CollectionsHandler>("collectionsHandler");

      // An entry, so the read actually reaches the companion: the join is skipped for an empty
      // page, which would make this pass without exercising anything.
      await handler.createEntry(
        { collectionName: "i18nwin_posts", overrideAccess: true, locale: "en" },
        { title: "Original" }
      );
      // A successful read first, so the companion is established as present and the failure below
      // is a genuine read fault rather than a missing table.
      await handler.listEntries({
        collectionName: "i18nwin_posts",
        overrideAccess: true,
        locale: "en",
      });

      // Break the companion while leaving the table in place — schema drift, from the read's
      // point of view.
      const quote = (id: string) =>
        dialect === "mysql" ? `\`${id}\`` : `"${id}"`;
      await current.adapter.executeQuery(
        `ALTER TABLE ${quote("dc_i18nwin_posts_locales")} DROP COLUMN ${quote("title")}`
      );

      const listed = await handler.listEntries({
        collectionName: "i18nwin_posts",
        overrideAccess: true,
        locale: "en",
      });

      expect(listed.success).toBe(false);
      expect(listed.message).not.toMatch(/title|_locales|column|relation/i);
    });
  }
);

/**
 * The read side, which is where this defect actually lived.
 *
 * A default-locale write with the companion missing is supposed to succeed: the value stays on the
 * main table, which still has the column. On PostgreSQL it failed anyway, with
 * `current transaction is aborted, commands ignored until end of transaction block` — a secondary
 * error naming a statement that had nothing to do with it.
 *
 * The cause was the post-write read-back that builds the response. It joins the companion, and it
 * used to decide the companion existed by running the join and catching the failure. That check is
 * free on SQLite and MySQL and fatal on PostgreSQL: the failed statement marks the whole
 * transaction aborted, so the tolerated error had already poisoned the connection by the time it
 * was tolerated, and the next statement — the events insert — died. It ran inside the caller's
 * write transaction, so the fallback write it was meant to support is exactly what it killed.
 *
 * The suite can see this failure now: the aborted-transaction guard records any transaction left
 * poisoned and fails the run, so a reintroduction trips on its own rather than waiting for a
 * reviewer to read the code.
 */
describe.each(getConfiguredTestDialects())(
  "default-locale field-group write with no companion on %s (integration)",
  dialect => {
    const q = (id: string) => (dialect === "mysql" ? `\`${id}\`` : `"${id}"`);

    it("completes the fallback write instead of aborting the transaction", async () => {
      current = await createTestNextly({
        dialect,
        fieldGroups: [
          defineFieldGroup({
            slug: "znfall",
            localized: true,
            fields: [text({ name: "heading", localized: true })],
          }),
        ],
        collections: [
          defineCollection({
            slug: "i18nwin_fallback",
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "hero", component: "znfall" }),
            ],
          }),
        ],
        localization,
      });

      // The pre-migration shape: the translatable column is still on the main table, so the
      // fallback is legitimate, and the companion is not there.
      await current.adapter.executeQuery(
        `ALTER TABLE ${q("comp_znfall")} ADD COLUMN ${q("heading")} text`
      );
      await dropCompanion(current, "comp_znfall_locales", dialect);

      const created = await current
        .getService<CollectionsHandler>("collectionsHandler")
        .createEntry(
          {
            collectionName: "i18nwin_fallback",
            overrideAccess: true,
            locale: "en",
          },
          { title: "Page", hero: { heading: "Hello" } }
        );

      // Report the driver's own words. A bare `success` assertion cannot tell an aborted
      // transaction from an ordinary refusal, and those want opposite fixes.
      expect(
        created.success
          ? "ok"
          : `failed ${created.statusCode}: ${created.message}`
      ).toBe("ok");
    });
  }
);
