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
  fieldGroup,
  defineCollection,
  defineFieldGroup,
  defineSingle,
  group,
  json,
  text,
} from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { HookContext } from "../../../hooks/types";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { deriveCompanionSpec } from "../../i18n/migration/derive-companion-spec";
import { buildCompanionCreateOnlySql } from "../../i18n/migration/generate-up";
// `SingleEntryService` belongs to the singles domain; versions only consumes
// it. `services/singles` re-exports the same class for legacy import paths,
// so this names the definition rather than the alias.
import type { SingleEntryService } from "../../singles/services/single-entry-service";

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
        // "settings" is a reserved slug (system-resource permission-collision
        // guard), so this suite uses "preferences".
        defineSingle({
          slug: "preferences",
          versions: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const singles =
      current.getService<SingleEntryService>("singleEntryService");

    await singles.update(
      "preferences",
      { title: "hello" },
      { overrideAccess: true }
    );

    const rows = await versions(current, "preferences");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const latest = rows[rows.length - 1];
    expect(latest.scopeKind).toBe("single");
    expect((latest.snapshot as { title?: string }).title).toBe("hello");
  });

  it("keeps a seeded localized default in v1 when the first update omits it (single auto-create)", async () => {
    // First-write auto-create of a localized, versioned Single seeds the
    // default-locale companion with the localized field defaults. When that
    // first update touches only another field, the seeded default is still
    // committed to the companion, so v1 must carry it — otherwise restoring v1
    // silently drops content that was actually persisted.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "preferences",
          versions: true,
          localized: true,
          fields: [
            text({
              name: "siteName",
              localized: true,
              defaultValue: "My Site",
            }),
            text({ name: "tagline", localized: true }),
          ],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const singles =
      current.getService<SingleEntryService>("singleEntryService");

    // The first update auto-creates the Single and touches ONLY `tagline`; the
    // defaulted `siteName` is never in the patch, only in the auto-create seed.
    await singles.update(
      "preferences",
      { tagline: "hi" },
      { overrideAccess: true, locale: "en" }
    );

    const rows = await versions(current, "preferences");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const v1 = rows[0];
    const snapshot = v1.snapshot as { siteName?: string; tagline?: string };
    // The seeded default survives into v1 alongside the written field.
    expect(snapshot.siteName).toBe("My Site");
    expect(snapshot.tagline).toBe("hi");
    // v1 belongs to the default locale it carries content for.
    expect(v1.locale).toBe("en");
  });

  it("preserves an untouched translation of the write locale in a partial single update snapshot", async () => {
    // A partial update to a non-default locale that touches only one
    // translatable field must still snapshot the locale's OTHER, untouched
    // translation — otherwise the version drops content that is still persisted
    // and restoring it would blank the field.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "preferences",
          versions: true,
          localized: true,
          fields: [
            text({ name: "siteName", localized: true }),
            text({ name: "tagline", localized: true }),
          ],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const singles =
      current.getService<SingleEntryService>("singleEntryService");

    // Establish both German translations.
    await singles.update(
      "preferences",
      { siteName: "Meine Seite", tagline: "hallo" },
      { overrideAccess: true, locale: "de" }
    );
    // Partial German edit: touch only `siteName`, leaving `tagline` untouched.
    await singles.update(
      "preferences",
      { siteName: "Meine Seite 2" },
      { overrideAccess: true, locale: "de" }
    );

    const rows = await versions(current, "preferences");
    const latest = rows[rows.length - 1];
    const snapshot = latest.snapshot as {
      siteName?: string;
      tagline?: string;
    };
    expect(latest.locale).toBe("de");
    expect(snapshot.siteName).toBe("Meine Seite 2");
    // The untouched German translation survives into the latest snapshot.
    expect(snapshot.tagline).toBe("hallo");
  });

  it("tags the snapshot with its locale when a shared-field write carries prior translations", async () => {
    // A shared-field-only write after a translation exists now folds that prior
    // translation into the snapshot. The snapshot is therefore locale-specific
    // and must be tagged so — otherwise `restoreVersion` treats a null-locale
    // snapshot as shared-only and drops exactly the translation it preserved.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "preferences",
          versions: true,
          localized: true,
          fields: [
            text({ name: "siteName", localized: false }),
            text({ name: "tagline", localized: true }),
          ],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const singles =
      current.getService<SingleEntryService>("singleEntryService");

    // Establish a German translation.
    await singles.update(
      "preferences",
      { tagline: "hallo" },
      { overrideAccess: true, locale: "de" }
    );
    // Shared-field-only write at the same locale: touches no translatable field.
    await singles.update(
      "preferences",
      { siteName: "Acme" },
      { overrideAccess: true, locale: "de" }
    );

    const rows = await versions(current, "preferences");
    const latest = rows[rows.length - 1];
    const snapshot = latest.snapshot as { siteName?: string; tagline?: string };
    // The snapshot folds in the German translation...
    expect(snapshot.tagline).toBe("hallo");
    // ...and is tagged German so a restore recovers it rather than dropping it.
    expect(latest.locale).toBe("de");
  });

  it("records the write locale's own status on a shared-field snapshot that carries a translation", async () => {
    // A published main row with a draft German translation. A shared-field write
    // at German folds in that translation and tags the snapshot German — its
    // status must be the German draft, not the published main-row status, or
    // restoring this snapshot would publish the translation.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "preferences",
          versions: true,
          localized: true,
          status: true,
          fields: [
            text({ name: "siteName", localized: false }),
            text({ name: "tagline", localized: true }),
          ],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const singles =
      current.getService<SingleEntryService>("singleEntryService");

    // Default locale published; then a draft German translation.
    await singles.update(
      "preferences",
      { siteName: "Acme", status: "published" },
      { overrideAccess: true, locale: "en" }
    );
    await singles.update(
      "preferences",
      { tagline: "hallo" },
      { overrideAccess: true, locale: "de" }
    );
    // Shared-field write at German: no status, but folds in the translation.
    await singles.update(
      "preferences",
      { siteName: "Acme 2" },
      { overrideAccess: true, locale: "de" }
    );

    const rows = await versions(current, "preferences");
    const latest = rows[rows.length - 1];
    const snapshot = latest.snapshot as { status?: string; tagline?: string };
    expect(latest.locale).toBe("de");
    // Both the version's recorded status and the snapshot's own status field are
    // the German draft, not the published main row's.
    expect(latest.status).toBe("draft");
    expect(snapshot.status).toBe("draft");
    expect(snapshot.tagline).toBe("hallo");
  });

  it("tags v1 with the default locale when a shared-only first update seeds localized defaults", async () => {
    // The first update touches only a SHARED field, so no localized field is
    // written and `companionData` is empty. Without forcing the tag, the capture
    // locale would be null, and a restore treats a null-locale snapshot of a
    // localized document as shared-only and drops the seeded translations — the
    // very defaults the overlay preserved. The snapshot must be tagged the
    // default locale.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "preferences",
          versions: true,
          localized: true,
          fields: [
            text({
              name: "siteName",
              localized: true,
              defaultValue: "My Site",
            }),
            text({ name: "region", localized: false }),
          ],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const singles =
      current.getService<SingleEntryService>("singleEntryService");

    await singles.update(
      "preferences",
      { region: "us" },
      { overrideAccess: true, locale: "en" }
    );

    const rows = await versions(current, "preferences");
    const v1 = rows[0];
    const snapshot = v1.snapshot as { siteName?: string; region?: string };
    expect(snapshot.siteName).toBe("My Site");
    expect(v1.locale).toBe("en");
  });

  it("does not copy default-locale seeds into a non-default-locale first update snapshot", async () => {
    // The seed persists localized defaults to the DEFAULT-locale companion only.
    // A first write at a NON-default locale must not overlay them, or restoring
    // that snapshot would materialize the defaults as real translations in the
    // wrong locale.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "preferences",
          versions: true,
          localized: true,
          fields: [
            text({
              name: "siteName",
              localized: true,
              defaultValue: "My Site",
            }),
            text({ name: "tagline", localized: true }),
          ],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const singles =
      current.getService<SingleEntryService>("singleEntryService");

    // First update auto-creates at "de" and touches only `tagline`.
    await singles.update(
      "preferences",
      { tagline: "hallo" },
      { overrideAccess: true, locale: "de" }
    );

    const rows = await versions(current, "preferences");
    const v1 = rows[0];
    const snapshot = v1.snapshot as {
      siteName?: string | null;
      tagline?: string;
    };
    // The written non-default translation is captured...
    expect(snapshot.tagline).toBe("hallo");
    // ...and the untranslated `siteName` is recorded as the empty state it is at
    // "de" (null), NOT the default-locale seed "My Site": the snapshot holds the
    // locale's real state so a restore resets the field, without leaking the
    // default-locale value into the wrong language.
    expect(snapshot.siteName ?? null).toBeNull();
    expect(v1.locale).toBe("de");
  });

  it("does not overlay defaults when a first update adopts a concurrently-inserted row", async () => {
    // Race: this update enters with autoCreated=true (nothing existed at the
    // pre-transaction read), but a concurrent first write inserts the row WITH a
    // real translation before the transaction opens. The transaction then adopts
    // that row instead of inserting, so it never seeds the defaults — overlaying
    // them would let a restore overwrite the real translation with a schema
    // default. A beforeUpdate hook stands in for the concurrent writer: it runs
    // after autoCreated is resolved but before the transaction.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "preferences",
          versions: true,
          localized: true,
          fields: [
            text({
              name: "siteName",
              localized: true,
              defaultValue: "My Site",
            }),
            text({ name: "region", localized: false }),
          ],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const singles =
      current.getService<SingleEntryService>("singleEntryService");

    let raced = false;
    current.hooks.register(
      "beforeUpdate",
      "*",
      async (context: HookContext<Record<string, unknown>>) => {
        if (!raced) {
          raced = true;
          // The concurrent writer persists the row with a REAL siteName.
          await singles.update(
            "preferences",
            { siteName: "Real Name" },
            { overrideAccess: true, locale: "en" }
          );
        }
        return context.data;
      }
    );

    // This outer first write touches only the shared `region`; it adopts the row
    // the concurrent writer just inserted.
    const outer = await singles.update(
      "preferences",
      { region: "us" },
      { overrideAccess: true, locale: "en" }
    );
    // The adopting write itself must succeed and be captured, otherwise the
    // assertions below would pass against the inner hook's write alone and never
    // exercise the adopter branch this test targets.
    expect(outer.success).toBe(true);

    const rows = await versions(current, "preferences");
    const last = rows[rows.length - 1];
    const snapshot = last.snapshot as { siteName?: string; region?: string };
    // The latest snapshot is the outer (adopting) write, proving we captured it.
    expect(snapshot.region).toBe("us");
    // ...and it did NOT overlay the schema default over the concurrently-written
    // real translation.
    expect(snapshot.siteName).not.toBe("My Site");
  });

  it("preserves an omitted component subtree in a scalar-only update snapshot", async () => {
    // A partial update carries only the fields in the request. Without reading
    // the current component state the snapshot would drop the untouched
    // component, silently losing it on a later restore.
    current = await createTestNextly({
      fieldGroups: [
        defineFieldGroup({
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
            fieldGroup({ name: "hero", component: "hero" }),
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
      // Defined in config, so the pipeline built this table.
      builtBy: "codeFirst",
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
      fieldGroups: [
        defineFieldGroup({
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
            fieldGroup({ name: "hero", component: "hero" }),
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
      fieldGroups: [
        defineFieldGroup({
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
            fieldGroup({ name: "hero", component: "hero" }),
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
      fieldGroups: [
        defineFieldGroup({
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
            fieldGroup({ name: "hero", component: "hero" }),
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

  it("records the component type for a Single's nested component", async () => {
    // The value rides in the group's JSON on the row rather than in the
    // components map, so the collection path's fix had to be applied here too
    // — the two capture paths are separate code.
    current = await createTestNextly({
      fieldGroups: [
        defineFieldGroup({ slug: "hero", fields: [text({ name: "heading" })] }),
      ],
      singles: [
        defineSingle({
          slug: "preferences",
          versions: true,
          fields: [
            group({
              name: "meta",
              fields: [fieldGroup({ name: "hero", component: "hero" })],
            }),
          ],
        }),
      ],
    });
    const singles =
      current.getService<SingleEntryService>("singleEntryService");

    await singles.update(
      "preferences",
      { meta: { hero: { heading: "Welcome" } } },
      { overrideAccess: true }
    );

    const rows = await versions(current, "preferences");
    const snapshot = rows.at(-1)?.snapshot as {
      meta?: { hero?: { _componentType?: string; heading?: string } };
    };

    expect(snapshot.meta?.hero?.heading).toBe("Welcome");
    expect(snapshot.meta?.hero?._componentType).toBe("hero");
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
