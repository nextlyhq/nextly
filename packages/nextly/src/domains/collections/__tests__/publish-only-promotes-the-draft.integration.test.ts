/**
 * A caller who may publish and not update publishes an editor's finished
 * draft: their write names only the status, and the held working draft's
 * values go live with it.
 *
 * @module domains/collections/__tests__/publish-only-promotes-the-draft.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../../config";
import { Nextly } from "../../../direct-api/nextly";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

const SLUG = "draftedpost";
/** The same, with a publish rule that refuses every caller. */
const GUARDED = "guardedpost";
/** May update and publish: writes the draft. */
const EDITOR = { id: "editor-1", email: "editor@x.test", roles: [] };
/** May publish, and holds no update. */
const PUBLISHER = { id: "publisher-1", email: "publisher@x.test", roles: [] };
/** May read, and neither update nor publish. */
const READER = { id: "reader-1", email: "reader@x.test", roles: [] };

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/**
 * A collection with drafts kept apart from the published row, whose code
 * rules say nothing of update, so update is the caller's own grant.
 */
async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: SLUG,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "body" })],
      }),
      defineCollection({
        slug: GUARDED,
        status: true,
        versions: { drafts: true },
        access: { publish: () => false },
        fields: [text({ name: "body" })],
      }),
    ],
  });
  const both = [SLUG, GUARDED];
  await userWhoMay(current, EDITOR.id, "update", both);
  for (const action of ["read", "publish"]) {
    await grantTo(current, EDITOR.id, action, both);
  }
  await userWhoMay(current, PUBLISHER.id, "publish", both);
  await grantTo(current, PUBLISHER.id, "read", both);
  await userWhoMay(current, READER.id, "read", both);
  return current;
}

function handlerOf(t: TestNextly): CollectionsHandler {
  return t.getService("collectionsHandler") as CollectionsHandler;
}

/** The Direct API as `id`, judged by that user's own grants. */
const as = (id: string) =>
  new Nextly({ overrideAccess: false, user: { id } as never });

async function liveDoc(
  t: TestNextly,
  id: string
): Promise<Record<string, unknown>> {
  const doc = (await t.nextly.findByID({
    collection: SLUG as never,
    id,
    overrideAccess: true,
  } as never)) as Record<string, unknown> | null;
  return doc ?? {};
}

describe.each(getConfiguredTestDialects())(
  "a publish-only caller publishes the held draft (%s)",
  dialect => {
    it("puts the draft's values live with a write naming only the status", async () => {
      const t = await boot(dialect);
      const h = handlerOf(t);
      const created = await h.createEntry(
        { collectionName: SLUG, overrideAccess: true },
        { body: "live", status: "published" }
      );
      const id = (created.data as { id?: string }).id as string;

      // The editor's change to the published entry is held as a draft.
      await as(EDITOR.id).update({
        collection: SLUG,
        id,
        data: { body: "finished draft" },
      } as never);
      // POPULATION CONTROL: the change is held, not live.
      expect((await liveDoc(t, id)).body).toBe("live");

      await as(PUBLISHER.id).update({
        collection: SLUG,
        id,
        data: { status: "published" },
      } as never);
      expect((await liveDoc(t, id)).body).toBe("finished draft");
    });

    it("refuses the same caller a write naming a field", async () => {
      // POPULATION CONTROL: the caller may not update, so the status-only
      // write above went through on publish alone.
      const t = await boot(dialect);
      const h = handlerOf(t);
      const created = await h.createEntry(
        { collectionName: SLUG, overrideAccess: true },
        { body: "live", status: "published" }
      );
      const id = (created.data as { id?: string }).id as string;
      await expect(
        as(PUBLISHER.id).update({
          collection: SLUG,
          id,
          data: { body: "not theirs", status: "published" },
        } as never)
      ).rejects.toThrow();
      expect((await liveDoc(t, id)).body).toBe("live");
    });
  }
);

/**
 * Publishes `body` live in `collection` and holds the editor's change to it
 * as a draft; answers the entry's id.
 */
async function heldDraft(t: TestNextly, collection: string): Promise<string> {
  const created = await handlerOf(t).createEntry(
    { collectionName: collection, overrideAccess: true },
    { body: "live", status: "published" }
  );
  const id = (created.data as { id?: string }).id as string;
  await as(EDITOR.id).update({
    collection,
    id,
    data: { body: "finished draft" },
  } as never);
  return id;
}

/** What `userId` reads of the entry, asking for its pending change. */
const readAs = (userId: string, collection: string, id: string) =>
  as(userId).findByID({ collection, id, draft: true } as never) as Promise<
    Record<string, unknown>
  >;

describe.each(getConfiguredTestDialects())(
  "who is shown an entry's pending change (%s)",
  dialect => {
    it("shows it to a caller who may publish the entry", async () => {
      const t = await boot(dialect);
      const id = await heldDraft(t, SLUG);
      const read = await readAs(PUBLISHER.id, SLUG, id);
      expect(read.body).toBe("finished draft");
      expect(read._isWorkingDraft).toBe(true);
    });

    it("hides it from a caller whose publish rule refuses the entry", async () => {
      const t = await boot(dialect);
      const id = await heldDraft(t, GUARDED);
      const read = await readAs(PUBLISHER.id, GUARDED, id);
      expect(read.body).toBe("live");
      expect(read._isWorkingDraft).toBeUndefined();
      // POPULATION CONTROL: the editor, who may update, is shown it.
      expect((await readAs(EDITOR.id, GUARDED, id)).body).toBe(
        "finished draft"
      );
    });

    it("hides it from a caller who may only read", async () => {
      const t = await boot(dialect);
      const id = await heldDraft(t, SLUG);
      const read = await readAs(READER.id, SLUG, id);
      expect(read.body).toBe("live");
      expect(read._isWorkingDraft).toBeUndefined();
    });
  }
);
