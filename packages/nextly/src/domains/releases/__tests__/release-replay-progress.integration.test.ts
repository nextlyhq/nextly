/**
 * A release pass leaves out a write that would change nothing.
 *
 * A pass the host ends part-way through a component settles no release, so
 * the next pass plans every document again. One already published, holding no
 * working draft, is passed over rather than written, so its hooks and outbox
 * events do not run twice and the pass reaches the documents still to go. One
 * already published but holding a working draft is still written, because
 * putting that draft live is what the release is for.
 *
 * A localized document is passed over only when EVERY language is already
 * where the action leaves it. The document read reports the default language,
 * so a page published in English with its German translation still a draft
 * reads as published, and passing it over would mark the release published
 * with German never put live. Its assertions read the translation rows
 * directly, because a localized read falls back to the default language.
 *
 * A document is accepted as settled only as the write would accept it: from
 * its stored status, which a read hook cannot rewrite, and only for an author
 * the write's own access gate would let perform the action.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection } from "../../../collections/config/define-collection";
import { text } from "../../../collections/fields";
import { defineSingle } from "../../../config";
import { resetHookRegistry } from "../../../hooks/hook-registry";
import {
  clearFieldFunctions,
  registerFieldFunctions,
} from "../../../shared/lib/field-level-registry";
import { releaseSettlementReads } from "../../../di/registrations/release-document-checks";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { SingleEntryService } from "../../singles/services/single-entry-service";
import { VersionsRepository } from "../../versions/versions-repository";
import { applyDueReleases } from "../apply-due-releases";
import { createReleaseMutations } from "../release-mutations";
import { ReleasesRepository } from "../releases-repository";

import {
  ANY_EDITABLE_STATE,
  scheduleAsItStands,
} from "./helpers/release-writes";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  // Collection hooks and field rules register into global registries.
  resetHookRegistry();
  clearFieldFunctions();
});

const SLUG = "posts";
const PAST = new Date("2020-01-01T00:00:00Z");

let changes = 0;

async function boot(dialect: TestDialect): Promise<TestNextly> {
  changes = 0;
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: SLUG,
        status: true,
        versions: { drafts: true },
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        hooks: {
          afterChange: [
            () => {
              changes += 1;
            },
          ],
        },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return current;
}

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler") as CollectionsHandler;

async function entry(
  t: TestNextly,
  title: string,
  status: "draft" | "published"
): Promise<string> {
  const created = await handlerOf(t).createEntry(
    { collectionName: SLUG, overrideAccess: true },
    { title, status }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");
  return id;
}

async function dueReleaseOf(
  t: TestNextly,
  entryIds: readonly string[],
  scope: { scopeKind: "collection" | "single"; scopeSlug: string } = {
    scopeKind: "collection",
    scopeSlug: SLUG,
  }
): Promise<string> {
  const repo = new ReleasesRepository(t.adapter);
  const release = await repo.createRelease({ title: "Go live" });
  for (const entryId of entryIds) {
    await repo.addMember(
      {
        releaseId: release.id,
        ...scope,
        entryId,
        locale: null,
        action: "publish",
        createdBy: "author",
      },
      ANY_EDITABLE_STATE
    );
  }
  await scheduleAsItStands(repo, release.id, PAST, "UTC");
  return release.id;
}

/** One materialisation pass, as the drain job performs it. */
function materialise(t: TestNextly) {
  return applyDueReleases({
    repository: new ReleasesRepository(t.adapter),
    mutations: createReleaseMutations({
      contentApi: t.nextly,
      settlement: releaseSettlementReads(t.adapter, t.getService("logger")),
    }),
    runAs: {
      findUser: async id => ({ id, isActive: true }),
      listRoleSlugs: async () => [],
    },
  });
}

async function stored(
  t: TestNextly,
  id: string
): Promise<{ title?: string; status?: string } | null> {
  return t.adapter.selectOne<{ title?: string; status?: string }>(
    `dc_${SLUG}`,
    { where: { and: [{ column: "id", op: "=", value: id }] } }
  );
}

describe.each(getConfiguredTestDialects())(
  "a release pass leaves out a write that changes nothing (%s)",
  dialect => {
    it("writes only the documents still to go when the rest are already live", async () => {
      const t = await boot(dialect);
      // What a pass the host ended part-way leaves behind: two documents of
      // the release already published, one not yet.
      const live1 = await entry(t, "one", "published");
      const live2 = await entry(t, "two", "published");
      const waiting = await entry(t, "three", "draft");
      const releaseId = await dueReleaseOf(t, [live1, live2, waiting]);
      changes = 0;

      const result = await materialise(t);

      expect(changes).toBe(1);
      expect(result.failed).toBe(0);
      expect((await stored(t, waiting))?.status).toBe("published");
      expect((await t.nextly.releases.findByID({ id: releaseId }))?.state).toBe(
        "published"
      );
    });

    it("still writes a published document holding a working draft, and puts the draft live", async () => {
      const t = await boot(dialect);
      const id = await entry(t, "live title", "published");
      // A status-less save on a drafts-enabled collection holds the edit as
      // a working draft and leaves the live row alone.
      await handlerOf(t).updateEntry(
        { collectionName: SLUG, entryId: id, overrideAccess: true },
        { title: "pending title" }
      );
      expect((await stored(t, id))?.title).toBe("live title");
      await dueReleaseOf(t, [id]);
      changes = 0;

      await materialise(t);

      expect(changes).toBe(1);
      expect((await stored(t, id))?.title).toBe("pending title");
      expect(
        await new VersionsRepository(t.adapter).listWorkingDraftLocales({
          scopeKind: "collection",
          scopeSlug: SLUG,
          entryId: id,
        })
      ).toEqual([]);
    });
  }
);

const PAGES = "pages";
const PREFERENCES = "preferences";

async function bootLocalized(dialect: TestDialect): Promise<TestNextly> {
  changes = 0;
  const open = {
    read: () => true,
    update: () => true,
    publish: () => true,
    unpublish: () => true,
  };
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: PAGES,
        localized: true,
        status: true,
        access: open,
        hooks: {
          afterChange: [
            () => {
              changes += 1;
            },
          ],
        },
        fields: [text({ name: "title", localized: true })],
      }),
    ],
    singles: [
      defineSingle({
        slug: PREFERENCES,
        localized: true,
        status: true,
        access: open,
        fields: [text({ name: "siteName", localized: true })],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

/** Every stored translation's own status, keyed by locale, read raw. */
async function languageStatuses(
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

/** A page published in English, its German translation as `de`. */
async function page(t: TestNextly, de: "draft" | "published"): Promise<string> {
  const created = await handlerOf(t).createEntry(
    { collectionName: PAGES, overrideAccess: true },
    { title: "Page EN", status: "published" }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");
  await handlerOf(t).updateEntry(
    { collectionName: PAGES, entryId: id, overrideAccess: true, locale: "de" },
    { title: "Seite DE", status: de }
  );
  return id;
}

describe.each(getConfiguredTestDialects())(
  "a release pass judges a localized document by every language (%s)",
  dialect => {
    it("WRITES a page published in English while German is still a draft", async () => {
      const t = await bootLocalized(dialect);
      const id = await page(t, "draft");
      // The state the default-language read misjudges: it reports the page
      // published, while German has not gone live.
      expect(await languageStatuses(t, `dc_${PAGES}_locales`)).toEqual({
        en: "published",
        de: "draft",
      });
      expect(
        (
          (await t.nextly.findByID({
            collection: PAGES,
            id,
            overrideAccess: true,
            status: "all",
          } as never)) as { status?: string } | null
        )?.status
      ).toBe("published");
      await dueReleaseOf(t, [id], {
        scopeKind: "collection",
        scopeSlug: PAGES,
      });

      const result = await materialise(t);

      expect(result.failed).toBe(0);
      expect(await languageStatuses(t, `dc_${PAGES}_locales`)).toEqual({
        en: "published",
        de: "published",
      });
    });

    it("WRITES a Single published in English while German is still a draft", async () => {
      const t = await bootLocalized(dialect);
      const singles: SingleEntryService = t.getService("singleEntryService");
      await singles.update(
        PREFERENCES,
        { siteName: "Prefs EN", status: "published" },
        { locale: "en", overrideAccess: true }
      );
      await singles.update(
        PREFERENCES,
        { siteName: "Prefs DE", status: "draft" },
        { locale: "de", overrideAccess: true }
      );
      const table = `single_${PREFERENCES}_locales`;
      expect(await languageStatuses(t, table)).toEqual({
        en: "published",
        de: "draft",
      });
      const rows = await t.adapter.select<{ id: string }>(
        `single_${PREFERENCES}`,
        {}
      );
      const singleId = rows[0]?.id;
      if (typeof singleId !== "string") throw new Error("no single row");
      await dueReleaseOf(t, [singleId], {
        scopeKind: "single",
        scopeSlug: PREFERENCES,
      });

      const result = await materialise(t);

      expect(result.failed).toBe(0);
      expect(await languageStatuses(t, table)).toEqual({
        en: "published",
        de: "published",
      });
    });

    it("passes over a page already published in every language", async () => {
      // The control: the languages are read, not merely distrusted. A reader
      // that could not tell would write this page too.
      const t = await bootLocalized(dialect);
      const id = await page(t, "published");
      const releaseId = await dueReleaseOf(t, [id], {
        scopeKind: "collection",
        scopeSlug: PAGES,
      });
      changes = 0;

      const result = await materialise(t);

      expect(changes).toBe(0);
      expect(result.failed).toBe(0);
      expect((await t.nextly.releases.findByID({ id: releaseId }))?.state).toBe(
        "published"
      );
    });
  }
);

const HOOKED = "hooked";
const LOCKED = "locked";
const RULED = "ruled";
const SEASONAL = "seasonal";

async function bootGuarded(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: HOOKED,
        status: true,
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        hooks: {
          // Reports every document as live, whatever is stored.
          afterRead: [
            ({ data }: { data?: unknown }) => ({
              ...(data as Record<string, unknown>),
              status: "published",
            }),
          ],
        },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: LOCKED,
        status: true,
        // Editable, but nobody may publish or take down.
        access: {
          read: () => true,
          update: () => true,
          publish: () => false,
          unpublish: () => false,
        },
        fields: [text({ name: "title" })],
      }),
      // Open to everyone; a field rule on its status is added per case.
      defineCollection({
        slug: RULED,
        status: true,
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        fields: [text({ name: "title" })],
      }),
      // Its draft/published lifecycle is turned off part-way through a case.
      defineCollection({
        slug: SEASONAL,
        status: true,
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return current;
}

/**
 * Let nobody set a ruled document's status, by a field rule: registered as a
 * plugin's raw field contribution, since the code-first config refuses a
 * field named `status` while the lifecycle is on.
 */
function guardStatus(): void {
  registerFieldFunctions("collection", RULED, [
    { name: "title", type: "text" },
    { name: "status", type: "text", access: { update: () => false } },
  ]);
}

async function entryIn(
  t: TestNextly,
  collectionName: string,
  status: "draft" | "published"
): Promise<string> {
  const created = await handlerOf(t).createEntry(
    { collectionName, overrideAccess: true },
    { title: "one", status }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");
  return id;
}

async function storedStatus(
  t: TestNextly,
  collectionName: string,
  id: string
): Promise<string | undefined> {
  const row = await t.adapter.selectOne<{ status?: string }>(
    `dc_${collectionName}`,
    { where: { and: [{ column: "id", op: "=", value: id }] } }
  );
  return row?.status;
}

describe.each(getConfiguredTestDialects())(
  "a release pass accepts a settled document only as the write would (%s)",
  dialect => {
    it("WRITES a stored draft that a read hook reports as published", async () => {
      const t = await bootGuarded(dialect);
      const id = await entryIn(t, HOOKED, "draft");
      // The hook is in force: a read says live while the row says draft.
      expect(
        (
          (await t.nextly.findByID({
            collection: HOOKED,
            id,
            overrideAccess: true,
            status: "all",
          } as never)) as { status?: string } | null
        )?.status
      ).toBe("published");
      expect(await storedStatus(t, HOOKED, id)).toBe("draft");
      await dueReleaseOf(t, [id], {
        scopeKind: "collection",
        scopeSlug: HOOKED,
      });

      const result = await materialise(t);

      expect(result.failed).toBe(0);
      expect(await storedStatus(t, HOOKED, id)).toBe("published");
    });

    it("does NOT discharge a release whose author may not publish, though the document is live", async () => {
      const t = await bootGuarded(dialect);
      const id = await entryIn(t, LOCKED, "published");
      const releaseId = await dueReleaseOf(t, [id], {
        scopeKind: "collection",
        scopeSlug: LOCKED,
      });

      const result = await materialise(t);

      expect(result.failed).toBe(1);
      expect(result.outcomes[0]?.failure).toBe("WRITE_FAILED");
      expect((await t.nextly.releases.findByID({ id: releaseId }))?.state).toBe(
        "scheduled"
      );
    });

    it("does NOT discharge a release whose author's field rules refuse the status, though the document is live", async () => {
      const t = await bootGuarded(dialect);
      guardStatus();
      const id = await entryIn(t, RULED, "published");
      const releaseId = await dueReleaseOf(t, [id], {
        scopeKind: "collection",
        scopeSlug: RULED,
      });

      const result = await materialise(t);

      expect(result.failed).toBe(1);
      expect(result.outcomes[0]?.failure).toBe("WRITE_FAILED");
      expect((await t.nextly.releases.findByID({ id: releaseId }))?.state).toBe(
        "scheduled"
      );
    });

    it("does NOT discharge a release once its collection's lifecycle is turned off, though the stored row still reads live", async () => {
      const t = await bootGuarded(dialect);
      const id = await entryIn(t, SEASONAL, "published");
      const releaseId = await dueReleaseOf(t, [id], {
        scopeKind: "collection",
        scopeSlug: SEASONAL,
      });
      await t.adapter.update(
        "dynamic_collections",
        { status: false },
        { and: [{ column: "slug", op: "=", value: SEASONAL }] }
      );
      expect(await storedStatus(t, SEASONAL, id)).toBe("published");

      const result = await materialise(t);

      expect(result.failed).toBe(1);
      expect((await t.nextly.releases.findByID({ id: releaseId }))?.state).toBe(
        "scheduled"
      );
    });
  }
);
