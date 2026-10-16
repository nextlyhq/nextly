/**
 * Retention enforcement through the real write path: the cap is applied in the
 * same transaction as the version insert, so a document never accumulates more
 * durable versions than configured.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import { restoreVersion } from "../restore-version";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { SingleEntryService } from "../../singles/services/single-entry-service";
import { NextlyError } from "../../../errors";
import { VersionCaptureService } from "../version-capture-service";
import { VersionsRepository } from "../versions-repository";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

type VersionRow = {
  id: string;
  scopeSlug: string;
  entryId: string;
  versionNo: number;
  status: string;
  sourceVersionNo: number | null;
  locale: string | null;
  label: string | null;
  isAutosave: boolean | number;
};

/** Durable versions of one collection or Single, oldest first. */
async function versionsFor(handle: TestNextly, slug: string) {
  const rows = await handle.adapter.select<VersionRow>("nextly_versions");
  return rows
    .filter(r => r.scopeSlug === slug && typeof r.versionNo === "number")
    .sort((a, b) => a.versionNo - b.versionNo);
}

/** Autosave rows of one collection or Single. */
async function autosavesFor(handle: TestNextly, slug: string) {
  const rows = await handle.adapter.select<VersionRow>("nextly_versions");
  // SQLite and MySQL return booleans as 0/1.
  return rows.filter(r => r.scopeSlug === slug && Boolean(r.isAutosave));
}

function repositoryFor(handle: TestNextly) {
  return new VersionsRepository(
    handle.adapter as unknown as ConstructorParameters<
      typeof VersionsRepository
    >[0]
  );
}

const localization = { locales: ["en", "de"], defaultLocale: "en" };

describe("version retention (integration)", () => {
  it("keeps only maxPerDoc durable versions, pruning oldest first", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          versions: { maxPerDoc: 3 },
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

    for (const title of ["v2", "v3", "v4", "v5"]) {
      await handler.updateEntry(
        { collectionName: "posts", entryId: id, overrideAccess: true },
        { title }
      );
    }

    const rows = await versionsFor(current, "posts");
    expect(rows).toHaveLength(3);
    // The three newest survive; 1 and 2 were pruned.
    expect(rows.map(r => r.versionNo)).toEqual([3, 4, 5]);
  });

  it("keeps every version when maxPerDoc is false", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          versions: { maxPerDoc: false },
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
    for (const title of ["v2", "v3", "v4"]) {
      await handler.updateEntry(
        { collectionName: "posts", entryId: id, overrideAccess: true },
        { title }
      );
    }

    expect(await versionsFor(current, "posts")).toHaveLength(4);
  });

  it("trims a large pre-existing backlog in one save", async () => {
    // A site that ran before the cap was enforced presents a big backlog on its
    // first save afterwards, spanning several delete statements. This covers
    // that end to end; the chunk boundary itself is pinned in
    // versions-repository-delete.test.ts.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          versions: { maxPerDoc: 2 },
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

    // Seed a backlog directly, bypassing capture, so the next save has to trim
    // more ids in one go than a single statement may bind.
    const repo = new VersionsRepository(
      current.adapter as unknown as ConstructorParameters<
        typeof VersionsRepository
      >[0]
    );
    const ref = {
      scopeKind: "collection" as const,
      scopeSlug: "posts",
      entryId: id,
    };
    for (let n = 2; n <= 620; n++) {
      await repo.insertVersion({
        ref,
        versionNo: n,
        status: "draft",
        isAutosave: false,
        snapshot: { title: `seed-${n}` },
      });
    }

    // One ordinary save triggers the trim across the whole backlog.
    await handler.updateEntry(
      { collectionName: "posts", entryId: id, overrideAccess: true },
      { title: "final" }
    );

    expect(await versionsFor(current, "posts")).toHaveLength(2);
  });

  it("keeps the version a restore was made from", async () => {
    // The restore's own row records that version as its source. Pruning it in
    // the same transaction leaves the lineage pointing at nothing, and the
    // editor is told the change can be undone from a version that is gone.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          versions: { maxPerDoc: 2 },
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

    // The cap is 2, so restoring the oldest surviving version puts the pass in
    // a position where it would otherwise remove the very source it just named.
    const surviving = await versionsFor(current, "posts");
    const source = surviving[0].versionNo;

    await restoreVersion({
      scopeKind: "collection",
      slug: "posts",
      entryId: id,
      versionNo: source,
      user: { id: "u1", roles: ["admin"] },
    });

    const rows = await versionsFor(current, "posts");
    expect(rows.map(r => r.versionNo)).toContain(source);
    // The new row's lineage resolves to a version that still exists.
    const restored = rows.find(r => r.sourceVersionNo === source);
    expect(restored).toBeDefined();
  });

  it("prunes per document, not across the collection", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          versions: { maxPerDoc: 2 },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const a = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "a1" }
    );
    const b = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "b1" }
    );
    const aId = (a.data as { id: string }).id;
    const bId = (b.data as { id: string }).id;

    await handler.updateEntry(
      { collectionName: "posts", entryId: aId, overrideAccess: true },
      { title: "a2" }
    );
    await handler.updateEntry(
      { collectionName: "posts", entryId: aId, overrideAccess: true },
      { title: "a3" }
    );

    const rows = await versionsFor(current, "posts");
    // Pruning is scoped per document: b is untouched by a's churn.
    expect(rows.filter(r => r.entryId === aId)).toHaveLength(2);
    expect(rows.filter(r => r.entryId === bId)).toHaveLength(1);
  });
});

// Every dialect the environment can reach: the rule reads the language, name
// and restore source back from the table, and each dialect stores them its own
// way.
describe.each(getConfiguredTestDialects())(
  "version retention keeps what must not be lost (integration, %s)",
  dialect => {
    it("keeps another language's latest published version through many saves in one language", async () => {
      // German is published once, then English is saved over and over. The cap
      // is 3, so a rule that keeps one published version per document keeps an
      // English one and removes German's only published snapshot.
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "posts",
            localized: true,
            status: true,
            versions: { drafts: false, maxPerDoc: 3 },
            fields: [text({ name: "title" })],
          }),
        ],
        localization,
      });
      const handler =
        current.getService<CollectionsHandler>("collectionsHandler");

      const created = await handler.createEntry(
        { collectionName: "posts", overrideAccess: true, locale: "en" },
        { title: "Hello", status: "published" }
      );
      const id = (created.data as { id: string }).id;
      await handler.updateEntry(
        {
          collectionName: "posts",
          entryId: id,
          overrideAccess: true,
          locale: "de",
        },
        { title: "Hallo", status: "published" }
      );
      const german = (await versionsFor(current, "posts")).find(
        r => r.locale === "de" && r.status === "published"
      );
      expect(german).toBeDefined();

      for (const n of [2, 3, 4, 5, 6]) {
        await handler.updateEntry(
          {
            collectionName: "posts",
            entryId: id,
            overrideAccess: true,
            locale: "en",
          },
          { title: `Hello ${n}` }
        );
      }

      const rows = await versionsFor(current, "posts");
      expect(rows.map(r => r.versionNo)).toContain(german!.versionNo);
      // The cap still holds for everything that is not protected: the three
      // newest English saves, plus German's published version.
      expect(rows).toHaveLength(4);
    });

    it("keeps another language's latest published version of a Single", async () => {
      // Singles record their versions through their own write path, so the rule
      // is held there too.
      current = await createTestNextly({
        dialect,
        singles: [
          defineSingle({
            slug: "branding",
            localized: true,
            status: true,
            versions: { drafts: false, maxPerDoc: 3 },
            fields: [text({ name: "heading" })],
          }),
        ],
        localization,
      });
      const singles =
        current.getService<SingleEntryService>("singleEntryService");

      await singles.update(
        "branding",
        { heading: "EN", status: "published" },
        { overrideAccess: true, locale: "en" }
      );
      await singles.update(
        "branding",
        { heading: "DE", status: "published" },
        { overrideAccess: true, locale: "de" }
      );
      const german = (await versionsFor(current, "branding")).find(
        r => r.locale === "de" && r.status === "published"
      );
      expect(german).toBeDefined();

      for (const n of [2, 3, 4, 5, 6]) {
        await singles.update(
          "branding",
          { heading: `EN ${n}` },
          { overrideAccess: true, locale: "en" }
        );
      }

      const rows = await versionsFor(current, "branding");
      expect(rows.map(r => r.versionNo)).toContain(german!.versionNo);
    });

    it("keeps published versions with no language, named versions and earlier restores", async () => {
      // The history is seeded so each protected kind sits beyond the cap, then
      // one ordinary save runs retention over it. The restore happened long
      // before this pass, so nothing but the stored rows says what to keep.
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "posts",
            localized: true,
            status: true,
            versions: { drafts: false, maxPerDoc: 3 },
            fields: [text({ name: "title" })],
          }),
        ],
        localization,
      });
      const handler =
        current.getService<CollectionsHandler>("collectionsHandler");

      const created = await handler.createEntry(
        { collectionName: "posts", overrideAccess: true, locale: "en" },
        { title: "Draft", status: "draft" }
      );
      const id = (created.data as { id: string }).id;
      expect(
        (await versionsFor(current, "posts")).map(r => r.versionNo)
      ).toEqual([1]);

      const repo = repositoryFor(current);
      const ref = {
        scopeKind: "collection" as const,
        scopeSlug: "posts",
        entryId: id,
      };
      const seed = (
        versionNo: number,
        fields: {
          status?: "draft" | "published";
          locale?: string | null;
          label?: string | null;
          sourceVersionNo?: number | null;
        } = {}
      ) =>
        repo.insertVersion({
          ref,
          versionNo,
          status: fields.status ?? "draft",
          isAutosave: false,
          snapshot: { title: `v${versionNo}` },
          locale: fields.locale === undefined ? "en" : fields.locale,
          label: fields.label ?? null,
          sourceVersionNo: fields.sourceVersionNo ?? null,
        });

      // v2: a publish of every language at once, which carries no language.
      await seed(2, { status: "published", locale: null });
      // v3: German's only published version.
      await seed(3, { status: "published", locale: "de" });
      // v4: a version someone named.
      await seed(4, { label: "Launch copy" });
      // v5 is restored from by v6, and v7 is the undo point a restore names.
      await seed(5);
      await seed(6, { sourceVersionNo: 5 });
      await seed(7, { label: "Before restore" });
      for (const n of [8, 9, 10, 11, 12]) await seed(n);

      await handler.updateEntry(
        {
          collectionName: "posts",
          entryId: id,
          overrideAccess: true,
          locale: "en",
        },
        { title: "Final" }
      );

      const kept = (await versionsFor(current, "posts")).map(r => r.versionNo);
      // The three newest (11, 12 and the save's own 13) and every protected
      // version stay; only the plain drafts beyond the cap go.
      expect(kept).toEqual([2, 3, 4, 5, 6, 7, 11, 12, 13]);
    });

    it("never removes a version that was named after the pass chose it", async () => {
      // Naming takes no document lock, so a name can land between a retention
      // pass reading the rows and deleting the ones it chose.
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "posts",
            versions: { drafts: false, maxPerDoc: 3 },
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
      const [v1, v2] = await versionsFor(current, "posts");
      const repo = repositoryFor(current);
      const ref = {
        scopeKind: "collection" as const,
        scopeSlug: "posts",
        entryId: id,
      };

      // The pass chose v1 and v2; v1 is named before its delete runs.
      await repo.updateLabel(ref, v1.versionNo, "Keep this");
      await repo.deletePrunedVersions([v1.id, v2.id]);

      const kept = (await versionsFor(current, "posts")).map(r => r.versionNo);
      expect(kept).toContain(v1.versionNo);
      expect(kept).not.toContain(v2.versionNo);
    });

    it("refuses a restore whose source was pruned before its capture, keeping nothing", async () => {
      // A restore reads its source before its own transaction; a save
      // committed in between can prune that source. Recording the restore
      // then would point its lineage at a version that no longer exists.
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "posts",
            versions: { drafts: false, maxPerDoc: 3 },
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
      const before = await versionsFor(current, "posts");
      const ref = {
        scopeKind: "collection" as const,
        scopeSlug: "posts",
        entryId: id,
      };

      const restoring = current.adapter.transaction(async tx =>
        new VersionCaptureService().capture(
          tx as unknown as Parameters<VersionCaptureService["capture"]>[0],
          {
            ref,
            status: "draft",
            snapshot: { title: "restored" },
            // No version 42 exists: it was pruned between read and capture.
            sourceVersionNo: 42,
            maxPerDoc: 3,
          }
        )
      );

      const error = await restoring.then(
        () => undefined,
        (err: unknown) => err
      );
      expect(error).toBeDefined();
      expect(NextlyError.is(error) && error.code).toBe("CONFLICT");
      expect(await versionsFor(current, "posts")).toEqual(before);
    });

    it("does not count autosaves toward the limit", async () => {
      // Three people each hold an autosave of the document. If they counted,
      // the cap would be met by recovery points and durable versions would go
      // early, or the recovery points themselves would be removed.
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "posts",
            versions: { drafts: false, maxPerDoc: 2 },
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

      const repo = repositoryFor(current);
      const ref = {
        scopeKind: "collection" as const,
        scopeSlug: "posts",
        entryId: id,
      };
      for (const author of ["ana", "ben", "cai"]) {
        await repo.upsertAutosave({
          ref,
          status: "draft",
          snapshot: { title: `autosave by ${author}` },
          createdBy: author,
        });
      }
      expect(await autosavesFor(current, "posts")).toHaveLength(3);

      for (const title of ["v2", "v3", "v4"]) {
        await handler.updateEntry(
          { collectionName: "posts", entryId: id, overrideAccess: true },
          { title }
        );
      }

      expect(
        (await versionsFor(current, "posts")).map(r => r.versionNo)
      ).toEqual([3, 4]);
      expect(await autosavesFor(current, "posts")).toHaveLength(3);
    });
  }
);
