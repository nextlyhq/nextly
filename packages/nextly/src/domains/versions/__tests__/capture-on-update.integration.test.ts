/**
 * Wiring test for automatic version capture on update.
 *
 * Proves that `updateEntry` (collections) and the single `update` path each
 * record a new `nextly_versions` snapshot inside the write transaction when the
 * schema opts into versioning, that the version number increments per document,
 * and that the snapshot reflects the updated values.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  component,
  defineCollection,
  defineComponent,
  defineSingle,
  json,
  text,
} from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { deriveCompanionSpec } from "../../i18n/migration/derive-companion-spec";
import { buildCompanionCreateOnlySql } from "../../i18n/migration/generate-up";
import type { SingleEntryService } from "../services/single-entry-service";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

type VersionRow = {
  scopeKind: string;
  scopeSlug: string;
  entryId: string;
  versionNo: number;
  status: string;
  locale: string | null;
  snapshot: unknown;
};

async function versions(handle: TestNextly, slug: string) {
  const rows = await handle.adapter.select<VersionRow>("nextly_versions");
  return rows
    .filter(r => r.scopeSlug === slug)
    .sort((a, b) => a.versionNo - b.versionNo);
}

describe("version capture on update (integration)", () => {
  it("captures a new version on each collection update (versionNo increments)", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          versions: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "v1" }
    );
    const id = (created.data as { id: string }).id;

    await handler.updateEntry(
      { collectionName: "posts", entryId: id, overrideAccess: true },
      { title: "v2" }
    );

    const rows = await versions(current, "posts");
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.versionNo)).toEqual([1, 2]);
    // The second version snapshots the updated document.
    expect((rows[1].snapshot as { title?: string }).title).toBe("v2");
    expect(rows.every(r => r.entryId === id)).toBe(true);
  });

  it("captures a version on a single update when versioning is enabled", async () => {
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "settings",
          versions: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const singles =
      current.getService<SingleEntryService>("singleEntryService");

    await singles.update(
      "settings",
      { title: "hello" },
      { overrideAccess: true }
    );

    const rows = await versions(current, "settings");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const latest = rows[rows.length - 1];
    expect(latest.scopeKind).toBe("single");
    expect((latest.snapshot as { title?: string }).title).toBe("hello");
  });

  it("preserves an omitted component subtree in a scalar-only update snapshot", async () => {
    // A partial update carries only the fields in the request. Without reading
    // the current component state the snapshot would drop the untouched
    // component, silently losing it on a later restore.
    current = await createTestNextly({
      components: [
        defineComponent({
          slug: "hero",
          fields: [text({ name: "heading" })],
        }),
      ],
      collections: [
        defineCollection({
          slug: "pages",
          versions: true,
          fields: [
            text({ name: "title" }),
            component({ name: "hero", component: "hero" }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "v1", hero: { heading: "Welcome" } }
    );
    const id = (created.data as { id: string }).id;

    // Scalar-only update — the component field is NOT in the payload.
    await handler.updateEntry(
      { collectionName: "pages", entryId: id, overrideAccess: true },
      { title: "v2" }
    );

    const rows = await versions(current, "pages");
    expect(rows).toHaveLength(2);
    const latest = rows[1].snapshot as {
      title?: string;
      hero?: { heading?: string };
    };
    expect(latest.title).toBe("v2");
    // The untouched component survives into the new version.
    expect(latest.hero?.heading).toBe("Welcome");
  });

  it("captures JSON-backed fields parsed to the read shape, not as strings", async () => {
    // On SQLite a json/richtext/group field is stored as a string; the snapshot
    // must parse it so a restored version equals a normal read.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "docs",
          versions: true,
          fields: [text({ name: "title" }), json({ name: "meta" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "docs", overrideAccess: true },
      { title: "d1", meta: { views: 3, tags: ["a", "b"] } }
    );
    const id = (created.data as { id: string }).id;
    await handler.updateEntry(
      { collectionName: "docs", entryId: id, overrideAccess: true },
      { title: "d2", meta: { views: 4, tags: ["c"] } }
    );

    const rows = await versions(current, "docs");
    const latest = rows[rows.length - 1].snapshot as {
      meta?: unknown;
    };
    // Parsed object, not a JSON string.
    expect(latest.meta).toEqual({ views: 4, tags: ["c"] });
  });

  it("preserves an untouched localized field for the write locale in a partial translatable update snapshot", async () => {
    // A partial translatable update carries only the changed localized value in
    // the patch. The write locale's other companion fields (set on an earlier
    // write, untouched here) must still appear in the snapshot — otherwise a
    // later restore silently drops this locale's other translations. The main
    // row never holds the translatable values, so they are read back from the
    // companion inside the write transaction.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "pages",
          versions: true,
          localized: true,
          fields: [
            text({ name: "title", localized: true }),
            text({ name: "body", localized: true }),
          ],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const adapter = current.adapter as unknown as {
      executeQuery: (sql: string) => Promise<unknown>;
    };
    // Companion tables are migration-owned; create it through the SAME
    // production DDL path a migration uses (derive the spec from the collection,
    // then the create-only companion statement) so the fixture can never drift
    // from the real localized schema.
    const spec = deriveCompanionSpec({
      slug: "pages",
      fields: [
        { name: "title", type: "text", localized: true },
        { name: "body", type: "text", localized: true },
      ],
      dialect: current.adapter.dialect,
      defaultLocale: "en",
      collectionLocalized: true,
    });
    if (!spec)
      throw new Error("expected a companion spec for a localized collection");
    // The code-first boot sync now provisions the companion for a localized collection, so only
    // create it here if it isn't already present (older setups relied on this manual create).
    if (!(await current.adapter.tableExists(spec.companionTable))) {
      await adapter.executeQuery(buildCompanionCreateOnlySql(spec));
    }
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "pages", locale: "de", overrideAccess: true },
      { title: "t1", body: "b1" }
    );
    const id = (created.data as { id: string }).id;

    // Partial translatable update for the same locale — `body` is NOT in the patch.
    await handler.updateEntry(
      {
        collectionName: "pages",
        entryId: id,
        locale: "de",
        overrideAccess: true,
      },
      { title: "t2" }
    );

    const rows = await versions(current, "pages");
    const latest = rows[rows.length - 1].snapshot as {
      title?: string;
      body?: string;
    };
    expect(latest.title).toBe("t2");
    // The untouched localized field survives into the new version.
    expect(latest.body).toBe("b1");
  });

  it("labels an update with the locale its embedded component was written at", async () => {
    // A collection that is not localized itself can embed one that is. The
    // component rows are per-locale, so a version that does not say which
    // language it holds cannot be restored to the right one. The create path
    // records this; the update path has to agree or a translation edit made
    // after creation becomes unrestorable.
    current = await createTestNextly({
      localization: {
        defaultLocale: "en",
        locales: [{ code: "en" }, { code: "de" }],
      },
      components: [
        defineComponent({
          slug: "hero",
          localized: true,
          fields: [text({ name: "heading" })],
        }),
      ],
      collections: [
        defineCollection({
          slug: "pages",
          versions: true,
          fields: [
            text({ name: "title" }),
            component({ name: "hero", component: "hero" }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "Page", hero: { heading: "Welcome" } }
    );
    const id = (created.data as { id: string }).id;

    await handler.updateEntry(
      {
        collectionName: "pages",
        entryId: id,
        overrideAccess: true,
        locale: "de",
      },
      { hero: { heading: "Willkommen" } }
    );

    const rows = await versions(current, "pages");
    expect(rows.at(-1)?.locale).toBe("de");
  });

  it("records the default locale when a component write names none", async () => {
    // The component write and read both resolve an absent locale to the
    // configured default, so the snapshot holds default-language content.
    // Recording null would leave restore unable to place it, and an ordinary
    // create followed by an ordinary edit would produce unrestorable versions.
    current = await createTestNextly({
      localization: {
        defaultLocale: "en",
        locales: [{ code: "en" }, { code: "de" }],
      },
      components: [
        defineComponent({
          slug: "hero",
          localized: true,
          fields: [text({ name: "heading" })],
        }),
      ],
      collections: [
        defineCollection({
          slug: "pages",
          versions: true,
          fields: [
            text({ name: "title" }),
            component({ name: "hero", component: "hero" }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "Page", hero: { heading: "Welcome" } }
    );
    const id = (created.data as { id: string }).id;

    await handler.updateEntry(
      { collectionName: "pages", entryId: id, overrideAccess: true },
      { hero: { heading: "Welcome back" } }
    );

    const rows = await versions(current, "pages");
    // Both the create and the update snapshot say which language they hold.
    expect(rows[0].locale).toBe("en");
    expect(rows.at(-1)?.locale).toBe("en");
  });

  it("records which component a single-component field held", async () => {
    // An ordinary read omits the type for a field naming one component,
    // because the schema implies it. A snapshot cannot rely on that: the field
    // may name a different component by the time it is restored, and the type
    // is the only thing that would reveal the mismatch.
    current = await createTestNextly({
      components: [
        defineComponent({
          slug: "hero",
          fields: [text({ name: "heading" })],
        }),
      ],
      collections: [
        defineCollection({
          slug: "pages",
          versions: true,
          fields: [
            text({ name: "title" }),
            component({ name: "hero", component: "hero" }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "Page", hero: { heading: "Welcome" } }
    );
    const id = (created.data as { id: string }).id;

    await handler.updateEntry(
      { collectionName: "pages", entryId: id, overrideAccess: true },
      { title: "Page v2" }
    );

    const rows = await versions(current, "pages");
    for (const row of rows) {
      const snapshot = row.snapshot as {
        hero?: { _componentType?: string; heading?: string };
      };
      expect(snapshot.hero?.heading).toBe("Welcome");
      expect(snapshot.hero?._componentType).toBe("hero");
    }
  });

  it("records no version when the schema does not opt in", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "notes",
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "notes", overrideAccess: true },
      { title: "a" }
    );
    const id = (created.data as { id: string }).id;
    await handler.updateEntry(
      { collectionName: "notes", entryId: id, overrideAccess: true },
      { title: "b" }
    );

    expect(await versions(current, "notes")).toHaveLength(0);
  });
});
