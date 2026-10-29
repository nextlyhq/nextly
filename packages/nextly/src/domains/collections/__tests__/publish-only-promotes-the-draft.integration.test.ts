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
/** The same, with a field the publisher may read and not update. */
const FIELD_RULED = "fieldruledpost";
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
      defineCollection({
        slug: FIELD_RULED,
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "body" }),
          text({
            name: "note",
            access: {
              update: ({ req }) =>
                (req.user as { id?: string } | undefined)?.id !== PUBLISHER.id,
            },
          }),
        ],
      }),
    ],
  });
  const both = [SLUG, GUARDED, FIELD_RULED];
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
async function heldDraft(
  t: TestNextly,
  collection: string,
  change: Record<string, unknown> = { body: "finished draft" }
): Promise<string> {
  const created = await handlerOf(t).createEntry(
    { collectionName: collection, overrideAccess: true },
    { body: "live", status: "published" }
  );
  const id = (created.data as { id?: string }).id as string;
  await as(EDITOR.id).update({ collection, id, data: change } as never);
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

    it("hides a change to a field the caller may not update, whose publish the field rule refuses", async () => {
      const t = await boot(dialect);
      const id = await heldDraft(t, FIELD_RULED, { note: "held note" });
      const read = await readAs(PUBLISHER.id, FIELD_RULED, id);
      expect(read.note).not.toBe("held note");
      expect(read._isWorkingDraft).toBeUndefined();
      // POPULATION CONTROL: the change is held, the editor is shown it, and
      // the publisher's status-only publish of it is refused, so what is
      // hidden is exactly what they could not put live.
      expect((await readAs(EDITOR.id, FIELD_RULED, id)).note).toBe("held note");
      await expect(
        as(PUBLISHER.id).update({
          collection: FIELD_RULED,
          id,
          data: { status: "published" },
        } as never)
      ).rejects.toThrow();
    });

    it("shows a change only to fields the caller may update", async () => {
      const t = await boot(dialect);
      const id = await heldDraft(t, FIELD_RULED);
      const read = await readAs(PUBLISHER.id, FIELD_RULED, id);
      expect(read.body).toBe("finished draft");
      expect(read._isWorkingDraft).toBe(true);
    });
  }
);

/** Its publish rule refuses any publish told it involves French. */
const LOCALIZED = "frenchwaryposts";
/** Its field's update rule refuses any write told it involves French. */
const FIELD_LOCALIZED = "frenchwaryfields";

/** A rule that refuses whatever is told it involves French. */
const frenchRefused = ({ locales }: { locales?: readonly string[] }) =>
  !(locales ?? []).includes("fr");

describe.each(getConfiguredTestDialects())(
  "a pending change in one language (%s)",
  dialect => {
    it("is shown to its publisher while the read also asks every language's status", async () => {
      // The read asks every language's translation state, so its rules hear
      // every language; the publish that would put the change live writes
      // English alone, and its rule allows that.
      current = await createTestNextly({
        dialect,
        localization: { locales: ["en", "fr"], defaultLocale: "en" },
        collections: [
          defineCollection({
            slug: LOCALIZED,
            localized: true,
            status: true,
            versions: { drafts: true },
            access: {
              publish: ({ locales }: { locales: readonly string[] }) =>
                !locales.includes("fr"),
            },
            fields: [text({ name: "body" })],
          }),
        ],
      });
      const t = current;
      await userWhoMay(t, EDITOR.id, "update", [LOCALIZED]);
      for (const action of ["read", "publish"]) {
        await grantTo(t, EDITOR.id, action, [LOCALIZED]);
      }
      await userWhoMay(t, PUBLISHER.id, "publish", [LOCALIZED]);
      await grantTo(t, PUBLISHER.id, "read", [LOCALIZED]);
      const id = await heldDraft(t, LOCALIZED);
      const read = (states: boolean) =>
        handlerOf(t)
          .getEntryService()
          .getEntry({
            collectionName: LOCALIZED,
            entryId: id,
            user: PUBLISHER,
            overrideAccess: false,
            includeWorkingDraft: true,
            locale: "en",
            ...(states ? { translationStatus: true } : {}),
          } as never) as Promise<{ data?: Record<string, unknown> }>;

      // POPULATION CONTROL: asked of English alone, the draft is shown.
      expect((await read(false)).data?.body).toBe("finished draft");
      const withStates = (await read(true)).data;
      expect(withStates?.body).toBe("finished draft");
      expect(withStates?._isWorkingDraft).toBe(true);
    });

    it("is shown to its publisher when its field rules allow the write's language, whatever the read asks", async () => {
      // The promotion's field rules are judged as the status write judges
      // them, in English alone, not in every language the read involves.
      current = await createTestNextly({
        dialect,
        localization: { locales: ["en", "fr"], defaultLocale: "en" },
        collections: [
          defineCollection({
            slug: FIELD_LOCALIZED,
            localized: true,
            status: true,
            versions: { drafts: true },
            fields: [
              text({
                name: "body",
                access: { update: frenchRefused as never },
              }),
            ],
          }),
        ],
      });
      const t = current;
      await userWhoMay(t, EDITOR.id, "update", [FIELD_LOCALIZED]);
      for (const action of ["read", "publish"]) {
        await grantTo(t, EDITOR.id, action, [FIELD_LOCALIZED]);
      }
      await userWhoMay(t, PUBLISHER.id, "publish", [FIELD_LOCALIZED]);
      await grantTo(t, PUBLISHER.id, "read", [FIELD_LOCALIZED]);
      const id = await heldDraft(t, FIELD_LOCALIZED);
      const read = (states: boolean) =>
        handlerOf(t)
          .getEntryService()
          .getEntry({
            collectionName: FIELD_LOCALIZED,
            entryId: id,
            user: PUBLISHER,
            overrideAccess: false,
            includeWorkingDraft: true,
            locale: "en",
            ...(states ? { translationStatus: true } : {}),
          } as never) as Promise<{ data?: Record<string, unknown> }>;

      // POPULATION CONTROL: asked of English alone, the draft is shown.
      expect((await read(false)).data?.body).toBe("finished draft");
      const withStates = (await read(true)).data;
      expect(withStates?.body).toBe("finished draft");
      expect(withStates?._isWorkingDraft).toBe(true);
    });
  }
);
