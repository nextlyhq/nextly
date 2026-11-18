/**
 * A save that keeps an entry published changes what visitors see, so it is a
 * publish: a caller who may update but not publish must not change the live
 * content of an already-published entry or Single by naming
 * `status: "published"`. Every write path refuses it, as it refuses a move
 * into published, and the probes that answer "may this caller make that
 * write" say no too.
 *
 * Unchanged: a caller with the publish permission saves live; a save naming
 * no status is held as the working draft; trusted server code
 * (`overrideAccess: true`) writes as before; and where there are no working
 * drafts, `update` is still what changes a published entry's live content,
 * as the admin's Save does there.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { singleDocumentStatusMoveAllowed } from "../../singles/services/single-document-access";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const PAGES = "pages";
/** No working drafts: update changes a published post's live content. */
const POSTS = "posts";
const BANNER = "banner";

/** Pages and a banner Single with drafts: published edits are held until published. */
async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: PAGES,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: POSTS,
        status: true,
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: BANNER,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "headline" })],
      }),
    ],
  });
  return current;
}

/** A published page, written by trusted code. */
async function publishedPage(t: TestNextly): Promise<string> {
  const created = await t.nextly.create({
    collection: PAGES,
    data: { title: "live words", status: "published" },
    overrideAccess: true,
  });
  return String((created.item as { id: string | number }).id);
}

/** The published banner, written by trusted code. */
async function publishedBanner(t: TestNextly): Promise<void> {
  await t.nextly.updateSingle({
    slug: BANNER,
    data: { headline: "live words", status: "published", _overwrite: true },
  });
}

/** The page title visitors see: the live row's. */
async function liveTitle(t: TestNextly, id: string): Promise<unknown> {
  const [row] = await t.adapter.select<{ title: unknown }>(`dc_${PAGES}`, {
    where: { and: [{ column: "id", op: "=", value: id }] },
  });
  return row?.title;
}

/** The banner headline visitors see: the live row's. */
async function liveHeadline(t: TestNextly): Promise<unknown> {
  const [row] = await t.adapter.select<{ headline: unknown }>(
    `single_${BANNER}`,
    {}
  );
  return row?.headline;
}

/** A signed-in caller holding `actions` on the page and the banner. */
async function caller(
  t: TestNextly,
  id: string,
  actions: readonly string[]
): Promise<{ id: string; isActive: true }> {
  const [first, ...rest] = actions;
  await userWhoMay(t, id, first ?? "read", [PAGES, POSTS, BANNER]);
  for (const action of rest) {
    await grantTo(t, id, action, [PAGES, POSTS, BANNER]);
  }
  return { id, isActive: true };
}

/** May read and update, and not publish. */
const editor = (t: TestNextly) => caller(t, "editor", ["read", "update"]);

/** May read, update and publish. */
const publisher = (t: TestNextly) =>
  caller(t, "publisher", ["read", "update", "publish"]);

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler");

describe.each(getConfiguredTestDialects())(
  "a save naming published over a published entry needs publish (%s)",
  dialect => {
    it("is refused through the Direct API, and the live content is left as it was", async () => {
      const t = await boot(dialect);
      const id = await publishedPage(t);
      const user = await editor(t);

      await expect(
        t.nextly.update({
          collection: PAGES,
          id,
          data: { title: "changed", status: "published", _overwrite: true },
          overrideAccess: false,
          user,
        })
      ).rejects.toThrow();

      expect(await liveTitle(t, id)).toBe("live words");
    });

    it("is refused through REST, and the live content is left as it was", async () => {
      const t = await boot(dialect);
      const id = await publishedPage(t);
      await editor(t);

      const result = await handlerOf(t).updateEntry(
        {
          collectionName: PAGES,
          entryId: id,
          userId: "editor",
          routeAuthorized: true,
        },
        { title: "changed", status: "published", _overwrite: true }
      );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(await liveTitle(t, id)).toBe("live words");
    });

    it("is refused in a batch update, and the live content is left as it was", async () => {
      const t = await boot(dialect);
      const id = await publishedPage(t);
      const user = await editor(t);

      const result = await handlerOf(t).bulkUpdateEntries({
        collectionName: PAGES,
        ids: [id],
        data: { title: "changed", status: "published", _overwrite: true },
        overrideAccess: false,
        user,
      });

      const outcome = (result as { data?: unknown }).data ?? result;
      const { successes, failures } = outcome as {
        successes: unknown[];
        failures: { id: string; code: string }[];
      };
      expect(successes).toEqual([]);
      expect(failures).toEqual([
        expect.objectContaining({ id, code: "FORBIDDEN" }),
      ]);
      expect(await liveTitle(t, id)).toBe("live words");
    });

    it("is answered no by the status-move probe", async () => {
      const t = await boot(dialect);
      const id = await publishedPage(t);
      const user = await editor(t);

      expect(
        await handlerOf(t).canMoveEntryStatus({
          collectionName: PAGES,
          entryId: id,
          nextStatus: "published",
          user,
        })
      ).toBe(false);
    });

    it("is refused for a Single, and its live content is left as it was", async () => {
      const t = await boot(dialect);
      await publishedBanner(t);
      const user = await editor(t);

      await expect(
        t.nextly.updateSingle({
          slug: BANNER,
          data: { headline: "changed", status: "published", _overwrite: true },
          overrideAccess: false,
          user,
        })
      ).rejects.toThrow();

      expect(await liveHeadline(t)).toBe("live words");
      expect(
        await singleDocumentStatusMoveAllowed(BANNER, "published", {
          user,
          routeAuthorized: false,
        })
      ).toBe(false);
    });

    it("is saved live for a caller who may publish (the control)", async () => {
      const t = await boot(dialect);
      const id = await publishedPage(t);
      const user = await publisher(t);

      await t.nextly.update({
        collection: PAGES,
        id,
        data: { title: "changed", status: "published", _overwrite: true },
        overrideAccess: false,
        user,
      });

      expect(await liveTitle(t, id)).toBe("changed");
      expect(
        await handlerOf(t).canMoveEntryStatus({
          collectionName: PAGES,
          entryId: id,
          nextStatus: "published",
          user,
        })
      ).toBe(true);
    });

    it("still holds the same edit naming no status as the working draft (the control)", async () => {
      const t = await boot(dialect);
      const id = await publishedPage(t);
      const user = await editor(t);

      await t.nextly.update({
        collection: PAGES,
        id,
        data: { title: "changed", _overwrite: true },
        overrideAccess: false,
        user,
      });

      expect(await liveTitle(t, id)).toBe("live words");
    });

    it("leaves update saving a published entry live where there are no working drafts (the control)", async () => {
      const t = await boot(dialect);
      const created = await t.nextly.create({
        collection: POSTS,
        data: { title: "live words", status: "published" },
        overrideAccess: true,
      });
      const id = String((created.item as { id: string | number }).id);
      const user = await editor(t);

      await t.nextly.update({
        collection: POSTS,
        id,
        data: { title: "changed", status: "published", _overwrite: true },
        overrideAccess: false,
        user,
      });

      const [row] = await t.adapter.select<{ title: unknown }>(`dc_${POSTS}`, {
        where: { and: [{ column: "id", op: "=", value: id }] },
      });
      expect(row?.title).toBe("changed");
    });

    it("leaves trusted server code saving live (the control)", async () => {
      const t = await boot(dialect);
      const id = await publishedPage(t);

      await t.nextly.update({
        collection: PAGES,
        id,
        data: { title: "changed", status: "published", _overwrite: true },
        overrideAccess: true,
      });

      expect(await liveTitle(t, id)).toBe("changed");
    });
  }
);
