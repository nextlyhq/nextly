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
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

const SLUG = "draftedpost";
/** May update and publish: writes the draft. */
const EDITOR = { id: "editor-1", email: "editor@x.test", roles: [] };
/** May publish, and holds no update. */
const PUBLISHER = { id: "publisher-1", email: "publisher@x.test", roles: [] };

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
    ],
  });
  await userWhoMay(current, EDITOR.id, "update", [SLUG]);
  for (const action of ["read", "publish"]) {
    await grantTo(current, EDITOR.id, action, [SLUG]);
  }
  await userWhoMay(current, PUBLISHER.id, "publish", [SLUG]);
  await grantTo(current, PUBLISHER.id, "read", [SLUG]);
  return current;
}

function handlerOf(t: TestNextly): CollectionsHandler {
  return t.getService("collectionsHandler") as CollectionsHandler;
}

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
      const saved = await h.updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          routeAuthorized: true,
          user: EDITOR,
        },
        { body: "finished draft" }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);
      // POPULATION CONTROL: the change is held, not live.
      expect((await liveDoc(t, id)).body).toBe("live");

      const published = await h.updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          routeAuthorized: true,
          user: PUBLISHER,
        },
        { status: "published" }
      );
      expect(published.success, JSON.stringify(published)).toBe(true);
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
      const edited = await h.updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          routeAuthorized: true,
          user: PUBLISHER,
        },
        { body: "not theirs", status: "published" }
      );
      expect(edited.success).toBe(false);
      expect((await liveDoc(t, id)).body).toBe("live");
    });
  }
);
