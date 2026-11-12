/**
 * Restore against a real database.
 *
 * The unit tests pin the decisions; this pins the thing they cannot — that a
 * snapshot resubmitted through the normal update path actually lands, and that
 * the restore is itself recorded as a version pointing back at its source.
 *
 * Each collection and Single here keeps working drafts (`status` with
 * versions), which a restore writes: one kept without them is refused, as
 * `restore-writes-drafts.integration.test.ts` shows. The documents are never
 * published, so their own row is their working draft.
 */
import { afterEach, describe, expect, it } from "vitest";

import { superAdminUser } from "../../../__tests__/fixtures/permission-holders";
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  relationship,
  text,
} from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { SingleEntryService } from "../../singles/services/single-entry-service";
import { restoreVersion } from "../restore-version";
import type { VersionsService } from "../versions-service";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const superAdmin = { id: "tester", roles: ["super-admin"] };

const stored = new WeakSet<TestNextly>();
/**
 * The super-admin a restore is made as, stored in `t` so the update gate the
 * restore asks finds its role: role names a caller hands in grant nothing.
 */
async function storedSuperAdmin(t: TestNextly): Promise<typeof superAdmin> {
  if (!stored.has(t)) {
    await superAdminUser(t, superAdmin.id);
    stored.add(t);
  }
  return superAdmin;
}

async function bootPosts(): Promise<TestNextly> {
  return createTestNextly({
    collections: [
      defineCollection({
        slug: "posts",
        status: true,
        versions: true,
        fields: [text({ name: "title" })],
      }),
    ],
  });
}

describe("restoreVersion (integration)", () => {
  it("puts the document back to an earlier version's content", async () => {
    current = await bootPosts();
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "First" }
    );
    const entryId = (created.data as { id: string }).id;

    await handler.updateEntry(
      { collectionName: "posts", entryId, overrideAccess: true },
      { title: "Second", _overwrite: true }
    );

    await restoreVersion({
      scopeKind: "collection",
      slug: "posts",
      entryId,
      versionNo: 1,
      user: await storedSuperAdmin(current!),
      version: { _overwrite: true },
    });

    const after = await handler.getEntry({
      collectionName: "posts",
      entryId,
      overrideAccess: true,
      status: "all",
    });

    expect((after.data as { title?: string }).title).toBe("First");
  });

  it("records the restore as a new version pointing at its source", async () => {
    current = await bootPosts();
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const versions = current.getService<VersionsService>("versionsService");

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "First" }
    );
    const entryId = (created.data as { id: string }).id;

    await handler.updateEntry(
      { collectionName: "posts", entryId, overrideAccess: true },
      { title: "Second", _overwrite: true }
    );

    await restoreVersion({
      scopeKind: "collection",
      slug: "posts",
      entryId,
      versionNo: 1,
      user: await storedSuperAdmin(current!),
      version: { _overwrite: true },
    });

    const history = await versions.list({
      scopeKind: "collection",
      scopeSlug: "posts",
      entryId,
    });

    // v1 First, v2 Second, v3 the "Before restore" snapshot of the content the
    // restore replaced, v4 the restore itself. History grows rather than being
    // rewritten, so a wrong restore is undone by restoring again.
    expect(history.length).toBe(4);

    const newest = history[0];
    expect(newest?.sourceVersionNo).toBe(1);
    // The version just below the restore snapshots what it replaced.
    expect(history[1]?.label).toBe("Before restore");
  });

  it("snapshots the live content as a 'Before restore' version so a restore never loses it", async () => {
    current = await bootPosts();
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const versions = current.getService<VersionsService>("versionsService");

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "First" }
    );
    const entryId = (created.data as { id: string }).id;
    await handler.updateEntry(
      { collectionName: "posts", entryId, overrideAccess: true },
      { title: "Second", _overwrite: true }
    );

    await restoreVersion({
      scopeKind: "collection",
      slug: "posts",
      entryId,
      versionNo: 1,
      user: await storedSuperAdmin(current!),
      version: { _overwrite: true },
    });

    const ref = {
      scopeKind: "collection" as const,
      scopeSlug: "posts",
      entryId,
    };
    const history = await versions.list(ref);
    // The pre-restore snapshot holds exactly the content that was live at the
    // moment of the restore ("Second") — the guarantee that a restore never
    // destroys content that is in no other version.
    const beforeRestore = history.find(v => v.label === "Before restore");
    expect(beforeRestore).toBeDefined();
    const full = await versions.get(ref, beforeRestore!.versionNo!);
    expect((full.snapshot as { title?: string }).title).toBe("Second");
  });

  it("keeps the replaced version even under a tight retention cap", async () => {
    // The confirm dialog tells the editor a restore can be undone. The
    // retention pass runs with the restore's own capture, and at a tight cap it
    // would otherwise remove exactly the version holding the replaced content —
    // taking the undo away the moment it was promised.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          status: true,
          versions: { enabled: true, maxPerDoc: 1 },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const versions = current.getService<VersionsService>("versionsService");

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "First" }
    );
    const entryId = (created.data as { id: string }).id;

    await handler.updateEntry(
      { collectionName: "posts", entryId, overrideAccess: true },
      { title: "Second", _overwrite: true }
    );

    const ref = {
      scopeKind: "collection" as const,
      scopeSlug: "posts",
      entryId,
    };
    // The cap has already trimmed history to the head, so that head is the only
    // version there is to restore.
    const head = (await versions.list(ref))[0];
    expect(head?.versionNo).toBeDefined();

    await restoreVersion({
      scopeKind: "collection",
      slug: "posts",
      entryId,
      versionNo: head!.versionNo!,
      user: await storedSuperAdmin(current!),
      version: { _overwrite: true },
    });

    const history = await versions.list(ref);

    // The replaced content survives its own restore's retention pass.
    expect(history.some(v => v.versionNo === head!.versionNo)).toBe(true);
  });

  it("leaves history intact when a restore is repeated", async () => {
    current = await bootPosts();
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const versions = current.getService<VersionsService>("versionsService");

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "First" }
    );
    const entryId = (created.data as { id: string }).id;

    await handler.updateEntry(
      { collectionName: "posts", entryId, overrideAccess: true },
      { title: "Second", _overwrite: true }
    );

    await restoreVersion({
      scopeKind: "collection",
      slug: "posts",
      entryId,
      versionNo: 1,
      user: await storedSuperAdmin(current!),
      version: { _overwrite: true },
    });
    // Undo the restore by restoring the version it replaced.
    await restoreVersion({
      scopeKind: "collection",
      slug: "posts",
      entryId,
      versionNo: 2,
      user: await storedSuperAdmin(current!),
      version: { _overwrite: true },
    });

    const after = await handler.getEntry({
      collectionName: "posts",
      entryId,
      overrideAccess: true,
      status: "all",
    });
    const history = await versions.list({
      scopeKind: "collection",
      scopeSlug: "posts",
      entryId,
    });

    expect((after.data as { title?: string }).title).toBe("Second");
    // v1, v2, then each restore adds two: a "Before restore" snapshot of what it
    // replaced and the restore itself. Two restores → six versions, history
    // grown rather than rewritten.
    expect(history.length).toBe(6);
  });

  it("snapshots a Single's live content as 'Before restore' before restoring it", async () => {
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "preferences",
          status: true,
          versions: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const singles =
      current.getService<SingleEntryService>("singleEntryService");

    await singles.update(
      "preferences",
      { title: "First", _overwrite: true },
      { overrideAccess: true }
    );
    await singles.update(
      "preferences",
      { title: "Second", _overwrite: true },
      { overrideAccess: true }
    );

    interface VRow {
      scopeSlug: string;
      entryId: string;
      label: string | null;
      snapshot: { title?: string };
    }
    const rowsForSlug = async () =>
      (await current!.adapter.select<VRow>("nextly_versions")).filter(
        r => r.scopeSlug === "preferences"
      );
    const entryId = (await rowsForSlug())[0].entryId;

    await restoreVersion({
      scopeKind: "single",
      slug: "preferences",
      entryId,
      versionNo: 1,
      user: await storedSuperAdmin(current!),
      version: { _overwrite: true },
    });

    // The pre-restore snapshot holds the content that was live at the restore
    // ("Second"), so a Single restore never destroys content in no other version.
    const beforeRestore = (await rowsForSlug()).find(
      r => r.label === "Before restore"
    );
    expect(beforeRestore).toBeDefined();
    expect(beforeRestore?.snapshot.title).toBe("Second");
  });

  it("records a localized Single's pre-restore snapshot at the restored locale's status, not the main row's", async () => {
    // A German translation left in draft under a published main row. When the
    // German version is restored, the pre-restore snapshot must record draft
    // (the locale's own status), not the main row's published — otherwise
    // undoing the restore would publish content that was never published.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "branding",
          localized: true,
          status: true,
          versions: true,
          fields: [text({ name: "heading" })],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const singles =
      current.getService<SingleEntryService>("singleEntryService");

    // Default locale published: main row and the `en` companion published.
    await singles.update(
      "branding",
      { heading: "EN", status: "published", _overwrite: true },
      { overrideAccess: true, locale: "en" }
    );
    // The German translation stays draft: its companion `_status` never leaves
    // draft even though the main row is published.
    await singles.update(
      "branding",
      { heading: "DE one", _overwrite: true },
      { overrideAccess: true, locale: "de" }
    );
    await singles.update(
      "branding",
      { heading: "DE two", _overwrite: true },
      { overrideAccess: true, locale: "de" }
    );

    interface VRow {
      scopeSlug: string;
      entryId: string;
      label: string | null;
      locale: string | null;
      versionNo: number | null;
      snapshot: { status?: string; heading?: string };
    }
    const rows = async () =>
      (await current!.adapter.select<VRow>("nextly_versions")).filter(
        r => r.scopeSlug === "branding"
      );
    const deVersion = (await rows()).find(r => r.locale === "de");
    expect(deVersion).toBeDefined();

    await restoreVersion({
      scopeKind: "single",
      slug: "branding",
      entryId: deVersion!.entryId,
      versionNo: deVersion!.versionNo!,
      user: await storedSuperAdmin(current!),
      version: { _overwrite: true },
    });

    const beforeRestore = (await rows()).find(
      r => r.label === "Before restore"
    );
    expect(beforeRestore).toBeDefined();
    // The German translation was draft, so its pre-restore snapshot says so.
    expect(beforeRestore?.snapshot.status).toBe("draft");
  });

  it("restores an untranslated Single stored per language into the language its version was saved in", async () => {
    // Under per-language storage a Single that is not translated still keeps its translatable
    // values per language, and a version saved in German holds German's. Restored without its
    // language, it would land on the default language's row and leave German as it was.
    current = await createTestNextly({
      perLanguageStorage: true,
      singles: [
        defineSingle({
          slug: "notice",
          status: true,
          versions: true,
          fields: [text({ name: "heading" })],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const singles =
      current.getService<SingleEntryService>("singleEntryService");
    await singles.update(
      "notice",
      { heading: "EN", _overwrite: true },
      { overrideAccess: true, locale: "en" }
    );
    await singles.update(
      "notice",
      { heading: "DE one", _overwrite: true },
      { overrideAccess: true, locale: "de" }
    );
    await singles.update(
      "notice",
      { heading: "DE two", _overwrite: true },
      { overrideAccess: true, locale: "de" }
    );

    interface VRow {
      scopeSlug: string;
      entryId: string;
      locale: string | null;
      versionNo: number | null;
      snapshot: { heading?: string };
    }
    const deOne = (await current.adapter.select<VRow>("nextly_versions")).find(
      r => r.scopeSlug === "notice" && r.snapshot.heading === "DE one"
    );
    expect(deOne?.locale).toBe("de");

    await restoreVersion({
      scopeKind: "single",
      slug: "notice",
      entryId: deOne!.entryId,
      versionNo: deOne!.versionNo!,
      user: await storedSuperAdmin(current),
      version: { _overwrite: true },
    });

    const headingIn = async (locale: string) =>
      (
        (await singles.get("notice", { locale, overrideAccess: true })) as {
          data?: { heading?: unknown };
        }
      ).data?.heading;
    expect(await headingIn("de")).toBe("DE one");
    expect(await headingIn("en")).toBe("EN");
  });

  it("keeps a component's relationship as a reference id in the pre-restore snapshot", async () => {
    // A component holding a relationship must snapshot the reference id, not the
    // expanded related row: an expanded object is not valid component write
    // input, so restoring the "Before restore" version to undo the operation
    // would fail persistence.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "authors",
          fields: [text({ name: "name" })],
        }),
      ],
      fieldGroups: [
        defineFieldGroup({
          slug: "byline",
          fields: [relationship({ name: "author", relationTo: "authors" })],
        }),
      ],
      singles: [
        defineSingle({
          slug: "prefs",
          status: true,
          versions: true,
          fields: [
            text({ name: "title" }),
            fieldGroup({ name: "byline", component: "byline" }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const singles =
      current.getService<SingleEntryService>("singleEntryService");

    const author = await handler.createEntry(
      { collectionName: "authors", overrideAccess: true },
      { name: "Ada" }
    );
    const authorId = (author.data as { id: string }).id;

    await singles.update(
      "prefs",
      { title: "one", byline: { author: authorId }, _overwrite: true },
      { overrideAccess: true }
    );
    await singles.update(
      "prefs",
      { title: "two", byline: { author: authorId }, _overwrite: true },
      { overrideAccess: true }
    );

    interface VRow {
      scopeSlug: string;
      entryId: string;
      label: string | null;
      versionNo: number | null;
      snapshot: { byline?: { author?: unknown } };
    }
    const rows = async () =>
      (await current!.adapter.select<VRow>("nextly_versions")).filter(
        r => r.scopeSlug === "prefs"
      );
    const first = (await rows()).find(r => r.versionNo === 1);
    expect(first).toBeDefined();

    await restoreVersion({
      scopeKind: "single",
      slug: "prefs",
      entryId: first!.entryId,
      versionNo: 1,
      user: await storedSuperAdmin(current!),
      version: { _overwrite: true },
    });

    const beforeRestore = (await rows()).find(
      r => r.label === "Before restore"
    );
    expect(beforeRestore).toBeDefined();
    // The reference is stored as the author's id, not an expanded { id, name }.
    expect(beforeRestore?.snapshot.byline?.author).toBe(authorId);
  });
});

describe("restoreVersion with field groups placed directly in one another", () => {
  it("puts back the earlier value at every level", async () => {
    current = await createTestNextly({
      fieldGroups: [
        defineFieldGroup({ slug: "rv3", fields: [text({ name: "title" })] }),
        defineFieldGroup({
          slug: "rv2",
          fields: [
            text({ name: "title" }),
            fieldGroup({ name: "child", component: "rv3" }),
          ],
        }),
        defineFieldGroup({
          slug: "rv1",
          fields: [
            text({ name: "title" }),
            fieldGroup({ name: "child", component: "rv2" }),
          ],
        }),
      ],
      collections: [
        defineCollection({
          slug: "rvposts",
          versions: true,
          fields: [
            text({ name: "title" }),
            fieldGroup({ name: "top", component: "rv1" }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const chain = (tag: string) => ({
      title: `${tag}-1`,
      child: { title: `${tag}-2`, child: { title: `${tag}-3` } },
    });

    const created = await handler.createEntry(
      { collectionName: "rvposts", overrideAccess: true },
      { title: "P", top: chain("first") }
    );
    const entryId = (created.data as { id: string }).id;
    await handler.updateEntry(
      { collectionName: "rvposts", entryId, overrideAccess: true },
      { top: chain("second"), _overwrite: true }
    );

    await restoreVersion({
      scopeKind: "collection",
      slug: "rvposts",
      entryId,
      versionNo: 1,
      user: await storedSuperAdmin(current),
      version: { _overwrite: true },
    });

    const after = await handler.getEntry({
      collectionName: "rvposts",
      entryId,
      overrideAccess: true,
      status: "all",
    });
    const top = (after.data as { top?: ReturnType<typeof chain> }).top;
    expect([top?.title, top?.child.title, top?.child.child.title]).toEqual([
      "first-1",
      "first-2",
      "first-3",
    ]);
  });
});
