/**
 * The save that follows a restore in the editor.
 *
 * Restoring in the editor stores nothing: the person's save is the write, and
 * it is an ordinary save that names its restored fields in `_restoredFrom`.
 * So restoring never publishes or unpublishes: a draft version's values saved
 * over a published document are held as its draft, and a published version's
 * values saved over an unpublished one leave it unpublished. A restored field
 * the save does not store, because a field write rule drops it, records no
 * source.
 */
import { afterEach, describe, expect, it } from "vitest";

import { superAdminUser } from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

const POSTS = "rtsposts";
const EDITOR = "rts-editor";

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

async function boot(dialect: TestDialect): Promise<CollectionsHandler> {
  handle = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: POSTS,
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "title" }),
          // No one may change it: a write rule drops it from every save.
          text({ name: "locked", access: { update: () => false } }),
        ],
      }),
    ],
  });
  await superAdminUser(handle, EDITOR);
  return handle.getService("collectionsHandler") as CollectionsHandler;
}

const editor = { id: EDITOR, roles: ["super-admin"] };

const versions = () => handle!.getService("versionsService");
const ref = (entryId: string) => ({
  scopeKind: "collection" as const,
  scopeSlug: POSTS,
  entryId,
});

async function newestVersion(entryId: string): Promise<number> {
  const parts = await versions().listPartVersions(ref(entryId));
  return Math.max(...parts.map(part => part.versionNo));
}

/** A person's save, as the editor sends it after a restore. */
async function save(
  handler: CollectionsHandler,
  id: string,
  data: Record<string, unknown>
): Promise<void> {
  const saved = await handler.updateEntry(
    { collectionName: POSTS, entryId: id, overrideAccess: false, user: editor },
    { ...data, _overwrite: true }
  );
  expect(saved.success, JSON.stringify(saved)).toBe(true);
}

/** What the published document holds, as a public read serves it. */
async function live(
  handler: CollectionsHandler,
  id: string
): Promise<Record<string, unknown>> {
  const read = await handler.getEntry({
    collectionName: POSTS,
    entryId: id,
    overrideAccess: true,
  });
  return (read.data ?? {}) as Record<string, unknown>;
}

describe.each(getConfiguredTestDialects())(
  "the save that follows a restore (%s)",
  dialect => {
    it("holds a draft version's values as the draft of a published document, and publishes nothing", async () => {
      const handler = await boot(dialect);
      const created = await handler.createEntry(
        { collectionName: POSTS, overrideAccess: true },
        { title: "live", status: "published" }
      );
      const id = (created.data as { id: string }).id;
      // A held draft: a draft version of a published document.
      await save(handler, id, { title: "draft text" });
      const draftVersion = await newestVersion(id);
      await save(handler, id, { title: "later draft" });

      // The draft version's title, restored in the editor, then saved.
      await save(handler, id, {
        title: "draft text",
        _restoredFrom: { title: draftVersion },
      });

      expect(await live(handler, id)).toMatchObject({
        title: "live",
        status: "published",
      });
      const recorded = await versions().get(ref(id), await newestVersion(id));
      expect(recorded.fieldSources).toEqual({ title: draftVersion });
    }, 120_000);

    it("leaves an unpublished document unpublished when a published version's values are saved over it", async () => {
      const handler = await boot(dialect);
      const created = await handler.createEntry(
        { collectionName: POSTS, overrideAccess: true },
        { title: "was live", status: "published" }
      );
      const id = (created.data as { id: string }).id;
      const publishedVersion = await newestVersion(id);
      await handler.updateEntry(
        { collectionName: POSTS, entryId: id, overrideAccess: true },
        { title: "taken down", status: "draft", _overwrite: true }
      );

      await save(handler, id, {
        title: "was live",
        _restoredFrom: { title: publishedVersion },
      });

      expect(await live(handler, id)).toMatchObject({ status: "draft" });
      const recorded = await versions().get(ref(id), await newestVersion(id));
      expect(recorded.fieldSources).toEqual({ title: publishedVersion });
    }, 120_000);

    it("records no source for a restored field the save does not store", async () => {
      const handler = await boot(dialect);
      const created = await handler.createEntry(
        { collectionName: POSTS, overrideAccess: true },
        { title: "one", locked: "first" }
      );
      const id = (created.data as { id: string }).id;
      const first = await newestVersion(id);
      await handler.updateEntry(
        { collectionName: POSTS, entryId: id, overrideAccess: true },
        { title: "two", locked: "second", _overwrite: true }
      );

      // Both restored from the first version; the rule drops `locked`.
      await save(handler, id, {
        title: "one",
        locked: "first",
        _restoredFrom: { title: first, locked: first },
      });

      const recorded = await versions().get(ref(id), await newestVersion(id));
      expect(recorded.fieldSources).toEqual({ title: first });
    }, 120_000);
  }
);
