/**
 * A scheduled release on a LOCALIZED document moves every language.
 *
 * The gap this closes was not a missing feature but a shipped wrong answer: a
 * document-wide member sent no locale, the write took that to mean "the default
 * language", and a scheduled takedown pulled the main row down while leaving
 * every translation live. The release reported success, so nothing anywhere
 * said the German page was still being served.
 *
 * Every assertion here reads the COMPANION ROWS directly. Reading through the
 * content API would pass against a materialiser that touched only the main row,
 * because a localized read falls back to the default language — which is the
 * exact shape of the bug.
 *
 * @module domains/releases/__tests__/release-materialises-localized.integration.test
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
import type { SingleEntryService } from "../../singles/services/single-entry-service";
import { applyDueReleases } from "../apply-due-releases";
import { createReleaseMutations } from "../release-mutations";
import { ReleasesRepository } from "../releases-repository";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "pages";
const SINGLE_SLUG = "preferences";
const PAST = new Date("2020-01-01T00:00:00Z");
const AUTHOR = "author-1";

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: SLUG,
        localized: true,
        status: true,
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        fields: [text({ name: "title", localized: true })],
      }),
    ],
    singles: [
      defineSingle({
        slug: SINGLE_SLUG,
        localized: true,
        status: true,
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        fields: [text({ name: "siteName", localized: true })],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler") as CollectionsHandler;

const singlesOf = (t: TestNextly): SingleEntryService =>
  t.getService("singleEntryService");

/** The stored lifecycle of the MAIN row, read raw. */
async function mainStatus(
  t: TestNextly,
  table: string,
  where: Record<string, unknown>[]
): Promise<string | undefined> {
  const row = await t.adapter.selectOne<{ status?: string }>(table, {
    where: { and: where },
  });
  return row?.status;
}

/**
 * Every stored translation's `_status`, keyed by locale.
 *
 * Read through the adapter rather than the content API, because this is the
 * column the defect left behind and a read would paper over it.
 */
async function companionStatuses(
  t: TestNextly,
  companionTable: string
): Promise<Record<string, string>> {
  const rows = await t.adapter.select<{ _locale?: unknown; _status?: unknown }>(
    companionTable,
    {}
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[String(r._locale)] = String(r._status);
  return out;
}

/**
 * A published entry with BOTH languages stored and live.
 *
 * Written through the real update path per language: a locale with no companion
 * row has no per-locale status to move, so seeding only the main row would let
 * every assertion below pass over an empty companion table.
 */
async function publishedInBothLanguages(t: TestNextly): Promise<string> {
  const created = await handlerOf(t).createEntry(
    { collectionName: SLUG, overrideAccess: true },
    { title: "Page EN", status: "published" }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");

  await handlerOf(t).updateEntry(
    { collectionName: SLUG, entryId: id, overrideAccess: true, locale: "de" },
    { title: "Seite DE", status: "published" }
  );
  return id;
}

async function scheduleMember(
  t: TestNextly,
  member: {
    scopeKind: "collection" | "single";
    entryId: string;
    slug: string;
    action: "publish" | "unpublish";
    locale?: string | null;
  }
): Promise<void> {
  const repo = new ReleasesRepository(t.adapter);
  const release = await repo.createRelease({ title: "Go live" });
  await repo.addMember({
    releaseId: release.id,
    scopeKind: member.scopeKind,
    scopeSlug: member.slug,
    entryId: member.entryId,
    locale: member.locale ?? null,
    action: member.action,
    createdBy: AUTHOR,
  });
  await repo.scheduleRelease(release.id, PAST, "UTC");
}

/** One materialisation pass, as the drain job performs it. */
async function materialise(t: TestNextly) {
  return applyDueReleases({
    repository: new ReleasesRepository(t.adapter),
    mutations: createReleaseMutations({ contentApi: t.nextly }),
    runAs: {
      findUser: async id => ({ id, isActive: true }),
      listRoleSlugs: async () => [],
    },
  });
}

describe.each(getConfiguredTestDialects())(
  "a release on a localized document (%s)",
  dialect => {
    it("TAKES DOWN every translation, not only the default language", async () => {
      // The defect, stated as a test. Before the fix the main row and `en` went
      // to draft and `de` stayed `published` — a page reported as unpublished
      // while its German translation was still being served.
      const t = await boot(dialect);
      const id = await publishedInBothLanguages(t);

      // Precondition. Without it the assertion below is satisfied by a
      // companion table that is simply empty, which is the state a
      // materialiser that never touches translations also produces.
      const before = await companionStatuses(t, `dc_${SLUG}_locales`);
      expect(Object.keys(before).sort()).toEqual(["de", "en"]);
      expect(before.en).toBe("published");
      expect(before.de).toBe("published");

      await scheduleMember(t, {
        scopeKind: "collection",
        slug: SLUG,
        entryId: id,
        action: "unpublish",
      });
      const result = await materialise(t);
      expect(result).toMatchObject({ applied: 1, failed: 0 });

      const after = await companionStatuses(t, `dc_${SLUG}_locales`);
      expect(after.en).toBe("draft");
      expect(after.de).toBe("draft");
      expect(
        await mainStatus(t, `dc_${SLUG}`, [
          { column: "id", op: "=", value: id },
        ])
      ).toBe("draft");
    });

    it("PUBLISHES every translation, not only the default language", async () => {
      // The other direction, and not a formality: the two are separate access
      // actions and separate transitions, so a fix applied to one of them
      // leaves the other exactly as it was.
      const t = await boot(dialect);
      const created = await handlerOf(t).createEntry(
        { collectionName: SLUG, overrideAccess: true },
        { title: "Page EN", status: "draft" }
      );
      const id = (created.data as { id?: string } | undefined)?.id;
      if (typeof id !== "string") throw new Error("no id from create");
      await handlerOf(t).updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          overrideAccess: true,
          locale: "de",
        },
        { title: "Seite DE", status: "draft" }
      );

      const before = await companionStatuses(t, `dc_${SLUG}_locales`);
      expect(Object.keys(before).sort()).toEqual(["de", "en"]);
      expect(before.de).toBe("draft");

      await scheduleMember(t, {
        scopeKind: "collection",
        slug: SLUG,
        entryId: id,
        action: "publish",
      });
      expect(await materialise(t)).toMatchObject({ applied: 1, failed: 0 });

      const after = await companionStatuses(t, `dc_${SLUG}_locales`);
      expect(after.en).toBe("published");
      expect(after.de).toBe("published");
      expect(
        await mainStatus(t, `dc_${SLUG}`, [
          { column: "id", op: "=", value: id },
        ])
      ).toBe("published");
    });

    it("still REFUSES a member that names one language", async () => {
      // The control that keeps the fix from being "always sweep everything".
      // A locale-scoped member is refused rather than mis-applied, and widening
      // the document-wide path must not have quietly swallowed that refusal.
      const t = await boot(dialect);
      const id = await publishedInBothLanguages(t);

      await scheduleMember(t, {
        scopeKind: "collection",
        slug: SLUG,
        entryId: id,
        action: "unpublish",
        locale: "de",
      });
      const result = await materialise(t);

      expect(result.outcomes[0]?.failure).toBe("LOCALE_SCOPE_UNSUPPORTED");
      const after = await companionStatuses(t, `dc_${SLUG}_locales`);
      expect(after.en).toBe("published");
      expect(after.de).toBe("published");
    });

    it("takes down every translation of a SINGLE too", async () => {
      // A release member holds either kind, so a fix that reached only
      // collections would leave a scheduled Single takedown serving its
      // translations exactly as before.
      const t = await boot(dialect);
      await singlesOf(t).update(
        SINGLE_SLUG,
        { siteName: "Prefs EN", status: "published" },
        { locale: "en", overrideAccess: true }
      );
      await singlesOf(t).update(
        SINGLE_SLUG,
        { siteName: "Prefs DE", status: "published" },
        { locale: "de", overrideAccess: true }
      );

      const rows = await t.adapter.select<{ id: string }>(
        `single_${SINGLE_SLUG}`,
        {}
      );
      const singleId = rows[0]?.id;
      if (typeof singleId !== "string") throw new Error("no single row");

      const table = `single_${SINGLE_SLUG}_locales`;
      const before = await companionStatuses(t, table);
      expect(Object.keys(before).sort()).toEqual(["de", "en"]);
      expect(before.de).toBe("published");

      await scheduleMember(t, {
        scopeKind: "single",
        slug: SINGLE_SLUG,
        entryId: singleId,
        action: "unpublish",
      });
      expect(await materialise(t)).toMatchObject({ applied: 1, failed: 0 });

      const after = await companionStatuses(t, table);
      expect(after.en).toBe("draft");
      expect(after.de).toBe("draft");
    });

    it("REFUSES a wildcard write that names a field, rather than writing it everywhere", async () => {
      // The selector moves a lifecycle and nothing else. Admitting field values
      // under it would copy one language's prose over every other translation,
      // which is the operation Strapi's document service withholds from its
      // update method for the same reason.
      const t = await boot(dialect);
      const id = await publishedInBothLanguages(t);

      const refused = await handlerOf(t).updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          overrideAccess: true,
          locale: "*",
        },
        { title: "overwritten everywhere", status: "draft" }
      );

      expect(refused.success).toBe(false);
      expect(refused.statusCode).toBe(400);
      // Nothing moved: not the lifecycle it also named, and not the field.
      const after = await companionStatuses(t, `dc_${SLUG}_locales`);
      expect(after.en).toBe("published");
      expect(after.de).toBe("published");
      const row = await t.adapter.selectOne<{ title?: string }>(
        `dc_${SLUG}_locales`,
        { where: { and: [{ column: "_locale", op: "=", value: "de" }] } }
      );
      expect(row?.title).toBe("Seite DE");
    });
  }
);
