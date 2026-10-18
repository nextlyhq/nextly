/**
 * A release's document-wide write and the unreleased work of other languages.
 *
 * The write that moves every language at once refuses while another language
 * holds a pending edit, going live or coming down alike. Readiness asks that
 * same rule ahead of the release's time, so the refusal is learned while it
 * can still be acted on, and scheduling refuses as the run would.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

import { seedPlainAuthor } from "./helpers/live-author";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const LATER = new Date("2099-01-01T09:00:00Z");
const OPEN = {
  read: () => true,
  update: () => true,
  publish: () => true,
  unpublish: () => true,
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      // Localized before Draft/Published was enabled: its translation table
      // loses the per-language status column below.
      defineCollection({
        slug: "glossary",
        localized: true,
        status: true,
        access: OPEN,
        fields: [text({ name: "term", localized: true })],
      }),
      defineCollection({
        slug: "pages",
        localized: true,
        status: true,
        versions: { drafts: true },
        access: OPEN,
        fields: [text({ name: "title", localized: true })],
      }),
    ],
    singles: [
      defineSingle({
        slug: "notice",
        localized: true,
        status: true,
        versions: { drafts: true },
        access: OPEN,
        fields: [text({ name: "headline", localized: true })],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler") as CollectionsHandler;

/** A published page, with German work saved and not yet released. */
async function pageHeldInGerman(t: TestNextly): Promise<string> {
  const created = await handlerOf(t).createEntry(
    { collectionName: "pages", overrideAccess: true, locale: "en" },
    { title: "EN live", status: "published" }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");
  await handlerOf(t).updateEntry(
    {
      collectionName: "pages",
      entryId: id,
      overrideAccess: true,
      locale: "de",
    },
    { title: "DE pending" }
  );
  return id;
}

/** A release holding these documents, each added by `author`. */
async function releaseOf(
  t: TestNextly,
  author: string,
  members: Array<{
    scopeKind: "collection" | "single";
    scopeSlug: string;
    entryId: string;
    action: "publish" | "unpublish";
  }>
): Promise<{ releaseId: string; memberIds: string[] }> {
  const release = await t.nextly.releases.create({ title: "Launch" });
  const memberIds: string[] = [];
  for (const member of members) {
    const added = await t.nextly.releases.addMember({
      releaseId: release.id,
      locale: null,
      userId: author,
      ...member,
    });
    memberIds.push(added.id);
  }
  return { releaseId: release.id, memberIds };
}

/**
 * Take the per-language status column off a translation table, leaving the
 * shape an install has when the collection was localized before Draft/Published
 * was enabled: the runtime reconcile never adds the column, and neither does
 * `nextly migrate`. Quoted per dialect, since MySQL reads a double-quoted
 * token as a string.
 */
async function dropCompanionStatus(
  t: TestNextly,
  dialect: TestDialect,
  table: string
): Promise<void> {
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  await (
    t.adapter as unknown as { executeQuery: (sql: string) => Promise<unknown> }
  ).executeQuery(`ALTER TABLE ${q(table)} DROP COLUMN ${q("_status")}`);
}

describe.each(getConfiguredTestDialects())(
  "a release over another language's unreleased work (%s)",
  dialect => {
    it("reports a document whose translations have no per-language status, going live or coming down", async () => {
      const t = await boot(dialect);
      const author = await seedPlainAuthor(t);
      const created = await handlerOf(t).createEntry(
        { collectionName: "glossary", overrideAccess: true, locale: "en" },
        { term: "Live", status: "published" }
      );
      const id = (created.data as { id?: string } | undefined)?.id;
      if (typeof id !== "string") throw new Error("no id from create");
      const { releaseId, memberIds } = await releaseOf(t, author, [
        {
          scopeKind: "collection",
          scopeSlug: "glossary",
          entryId: id,
          action: "unpublish",
        },
      ]);
      // Going live is the same document-wide move, and asks the same.
      const goingLive = await releaseOf(t, author, [
        {
          scopeKind: "collection",
          scopeSlug: "glossary",
          entryId: id,
          action: "publish",
        },
      ]);
      // Members are added while the translation table still had the column.
      await dropCompanionStatus(t, dialect, "dc_glossary_locales");

      // The takedown itself refuses: the fixture reaches the rule asked.
      const refused = await handlerOf(t).unpublishAllLocales({
        collectionName: "glossary",
        entryId: id,
        overrideAccess: true,
      });
      expect(refused).toMatchObject({ success: false, statusCode: 409 });

      expect((await t.nextly.releases.readiness({ releaseId })).hard).toEqual([
        expect.objectContaining({
          memberId: memberIds[0],
          code: "COMPANION_WITHOUT_LIFECYCLE",
        }),
      ]);
      await expect(
        t.nextly.releases.schedule({
          id: releaseId,
          at: LATER,
          timezone: "UTC",
        })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        publicData: {
          problems: [
            { memberId: memberIds[0], code: "COMPANION_WITHOUT_LIFECYCLE" },
          ],
        },
      });

      expect(
        (await t.nextly.releases.readiness({ releaseId: goingLive.releaseId }))
          .hard
      ).toEqual([
        expect.objectContaining({
          memberId: goingLive.memberIds[0],
          code: "COMPANION_WITHOUT_LIFECYCLE",
        }),
      ]);
    });

    it("reports a page held in another language, going live or coming down, and refuses to schedule", async () => {
      const t = await boot(dialect);
      const author = await seedPlainAuthor(t);
      const id = await pageHeldInGerman(t);

      // The write itself refuses: the fixture reaches the rule being asked.
      const written = await handlerOf(t).updateEntry(
        {
          collectionName: "pages",
          entryId: id,
          overrideAccess: true,
          locale: "*",
        },
        { status: "draft" }
      );
      expect(written).toMatchObject({ success: false, statusCode: 409 });

      const goingLive = await releaseOf(t, author, [
        {
          scopeKind: "collection",
          scopeSlug: "pages",
          entryId: id,
          action: "publish",
        },
      ]);
      const comingDown = await releaseOf(t, author, [
        {
          scopeKind: "collection",
          scopeSlug: "pages",
          entryId: id,
          action: "unpublish",
        },
      ]);
      for (const { releaseId, memberIds } of [goingLive, comingDown]) {
        expect((await t.nextly.releases.readiness({ releaseId })).hard).toEqual(
          [
            expect.objectContaining({
              memberId: memberIds[0],
              code: "DRAFT_HELD_IN_LOCALE",
              source: "core.held-drafts",
              detail: { locales: ["de"] },
            }),
          ]
        );
        await expect(
          t.nextly.releases.schedule({
            id: releaseId,
            at: LATER,
            timezone: "UTC",
          })
        ).rejects.toMatchObject({
          code: "CONFLICT",
          publicData: {
            problems: [
              { memberId: memberIds[0], code: "DRAFT_HELD_IN_LOCALE" },
            ],
          },
        });
      }

      // Released, the German work no longer holds the document.
      await handlerOf(t).updateEntry(
        {
          collectionName: "pages",
          entryId: id,
          overrideAccess: true,
          locale: "de",
        },
        { status: "published" }
      );
      expect(
        (await t.nextly.releases.readiness({ releaseId: comingDown.releaseId }))
          .hard
      ).toEqual([]);
    });

    it("reports a Single held in another language", async () => {
      const t = await boot(dialect);
      const author = await seedPlainAuthor(t);
      await t.nextly.updateSingle({
        slug: "notice" as never,
        locale: "en",
        data: { headline: "EN live", status: "published" } as never,
      });
      await t.nextly.updateSingle({
        slug: "notice" as never,
        locale: "de",
        data: { headline: "DE live", status: "published" } as never,
      });
      // German is live, so this edit is held as its pending work.
      await t.nextly.updateSingle({
        slug: "notice" as never,
        locale: "de",
        data: { headline: "DE pending" } as never,
      });
      const row = await t.adapter.selectOne<{ id: string }>(
        "single_notice",
        {}
      );
      if (row === null || row === undefined) throw new Error("no notice row");
      // The write itself refuses: the fixture reaches the rule being asked.
      await expect(
        t.nextly.updateSingle({
          slug: "notice" as never,
          locale: "*",
          data: { status: "draft" } as never,
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });

      const { releaseId, memberIds } = await releaseOf(t, author, [
        {
          scopeKind: "single",
          scopeSlug: "notice",
          entryId: row.id,
          action: "unpublish",
        },
      ]);
      expect((await t.nextly.releases.readiness({ releaseId })).hard).toEqual([
        expect.objectContaining({
          memberId: memberIds[0],
          code: "DRAFT_HELD_IN_LOCALE",
          detail: { locales: ["de"] },
        }),
      ]);
    });
  }
);
