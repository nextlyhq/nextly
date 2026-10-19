/**
 * A scheduled release stopped as soon as a hard problem appears, before any
 * reader is shown its effect, and its owner told once per stop.
 *
 * Each event that can create a hard problem is driven through its ordinary
 * path, and the case then reads as a visitor would, after the release's
 * instant and before any drain pass: the release's documents read as they
 * did before it. Without the stop, the read path projects the due release and
 * the visitor is shown the effect of a release that will never run.
 *
 * Releases are arranged through the repository, so an instant already past
 * can be set, and each is asserted ready first: what the event does is what
 * stops it.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { NOTICES_TABLE } from "../../../schemas/notices/table-name";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { ServiceContainer } from "../../../services/index";
import type { CollectionRegistryService } from "../../collections/services/collection-registry-service";
import type { SingleEntryService } from "../../singles/services/single-entry-service";
import { applyDueReleases } from "../apply-due-releases";
import {
  clearReleaseCheckSourcesForTests,
  registerReleaseCheckSource,
} from "../readiness/check-sources";
import { registerCoreReleaseCheckSources } from "../readiness/core-sources";
import type { ReleaseRecheckTarget } from "../release-recheck";
import { createReleaseMutations } from "../release-mutations";
import { ReleasesRepository } from "../releases-repository";

import { seedLiveAuthor, seedPlainAuthor } from "./helpers/live-author";
import {
  ANY_EDITABLE_STATE,
  scheduleAsItStands,
} from "./helpers/release-writes";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  // A case may register a source of its own; the next boot starts from core's.
  clearReleaseCheckSourcesForTests();
  registerCoreReleaseCheckSources();
});

const PAST = new Date("2020-01-01T00:00:00Z");
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
      // Pending work in another language stops a document-wide write.
      defineCollection({
        slug: "pages",
        localized: true,
        status: true,
        versions: { drafts: true },
        access: OPEN,
        fields: [text({ name: "title", localized: true })],
      }),
      // No rule for taking a memo down: who may is decided by grants alone.
      defineCollection({
        slug: "memos",
        status: true,
        access: { read: () => true, update: () => true, publish: () => true },
        fields: [text({ name: "title" })],
      }),
      // Its summary is optional until a case makes it required.
      defineCollection({
        slug: "articles",
        status: true,
        access: OPEN,
        fields: [text({ name: "title" }), text({ name: "summary" })],
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

/** A document stored through the ordinary write, trusted. */
async function entry(
  t: TestNextly,
  collection: "pages" | "memos" | "articles",
  status: "draft" | "published"
): Promise<string> {
  const created = await handlerOf(t).createEntry(
    { collectionName: collection, overrideAccess: true },
    { title: "Fine", status }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");
  return id;
}

/** The ids an anonymous visitor's ordinary list read returns. */
async function visibleIds(
  t: TestNextly,
  collection: "pages" | "memos" | "articles"
): Promise<string[]> {
  const result = await handlerOf(t).listEntries({
    collectionName: collection,
    limit: 50,
  });
  const docs = (result.data?.docs ?? []) as { id: string }[];
  return docs.map(row => row.id);
}

/** Whether an anonymous visitor can read the Single at all. */
async function singleVisible(t: TestNextly): Promise<boolean> {
  const singles = t.getService("singleEntryService") as SingleEntryService;
  const result = await singles.get("notice", { overrideAccess: false });
  return result.success === true;
}

interface Arranged {
  releaseId: string;
  owner: string;
  author: string;
}

/**
 * A release owned by the instance's first user, holding these documents,
 * each added by a plain author, scheduled for an instant already past, and
 * ready: no hard problem until the case makes one.
 */
async function dueRelease(
  t: TestNextly,
  members: Array<{
    scopeKind: "collection" | "single";
    scopeSlug: string;
    entryId: string;
    action: "publish" | "unpublish";
  }>,
  people?: { owner: string; author: string }
): Promise<Arranged> {
  const owner = people?.owner ?? (await seedLiveAuthor(t));
  const author = people?.author ?? (await seedPlainAuthor(t));
  const repo = new ReleasesRepository(t.adapter);
  const release = await repo.createRelease({
    title: "Launch",
    createdBy: owner,
  });
  for (const member of members) {
    await repo.addMember(
      { releaseId: release.id, locale: null, createdBy: author, ...member },
      ANY_EDITABLE_STATE
    );
  }
  await scheduleAsItStands(repo, release.id, PAST, "UTC");
  expect(
    (await t.nextly.releases.readiness({ releaseId: release.id })).hard
  ).toEqual([]);
  return { releaseId: release.id, owner, author };
}

async function stateOf(t: TestNextly, releaseId: string): Promise<string> {
  const [row] = await new ReleasesRepository(t.adapter).findReleases({
    ids: [releaseId],
  });
  return row?.state ?? "missing";
}

/** The stopped notices this release's owner has been given. */
async function stoppedNotices(
  t: TestNextly,
  arranged: Pick<Arranged, "releaseId" | "owner">
): Promise<number> {
  const rows = await t.adapter.select<{ id: string }>(NOTICES_TABLE, {
    columns: ["id"],
    where: {
      and: [
        { column: "kind", op: "=", value: "releases.stopped" },
        { column: "subjectId", op: "=", value: arranged.releaseId },
        { column: "userId", op: "=", value: arranged.owner },
      ],
    },
  });
  return rows.length;
}

/** A role holding exactly these seeded grants, given to `userId`. */
async function grantRole(
  t: TestNextly,
  userId: string,
  slugs: string[]
): Promise<string> {
  await (
    t.getService("permissionSeedService") as {
      seedSystemPermissions: () => Promise<unknown>;
    }
  ).seedSystemPermissions();
  const nextly = t.nextly as unknown as {
    permissions: {
      find: (a: { page: number; limit: number }) => Promise<{
        items: { id: string; slug: string }[];
        meta: { hasNext: boolean };
      }>;
    };
    roles: {
      create: (a: { data: Record<string, unknown> }) => Promise<{
        item: { id: string };
      }>;
    };
  };
  const seeded: { id: string; slug: string }[] = [];
  for (let page = 1; ; page += 1) {
    const listed = await nextly.permissions.find({ page, limit: 100 });
    seeded.push(...listed.items);
    if (!listed.meta.hasNext) break;
  }
  const role = await nextly.roles.create({
    data: {
      name: `Role ${userId}`,
      slug: `role-${userId.slice(0, 8)}`,
      permissionIds: slugs.map(slug => {
        const found = seeded.find(p => p.slug === slug);
        if (found === undefined) throw new Error(`${slug} is not seeded`);
        return found.id;
      }),
    },
  });
  await new ServiceContainer(t.adapter).userRoles.assignRoleToUser(
    userId,
    role.item.id
  );
  return role.item.id;
}

/** A published memo, taken down by a due release whose author may do so by a role. */
async function memoTakedown(
  t: TestNextly
): Promise<Arranged & { memo: string; roleId: string }> {
  const owner = await seedLiveAuthor(t);
  const author = await seedPlainAuthor(t);
  const roleId = await grantRole(t, author, [
    "update-memos",
    "unpublish-memos",
  ]);
  const memo = await entry(t, "memos", "published");
  const arranged = await dueRelease(
    t,
    [
      {
        scopeKind: "collection",
        scopeSlug: "memos",
        entryId: memo,
        action: "unpublish",
      },
    ],
    { owner, author }
  );
  // The takedown is in effect for readers: the release is due.
  expect(await visibleIds(t, "memos")).not.toContain(memo);
  return { ...arranged, memo, roleId };
}

describe.each(getConfiguredTestDialects())(
  "a scheduled release stopped as soon as a hard problem appears (%s)",
  dialect => {
    it("stops it when a draft saved in another language would refuse its takedown", async () => {
      const t = await boot(dialect);
      const page = await entry(t, "pages", "published");
      const arranged = await dueRelease(t, [
        {
          scopeKind: "collection",
          scopeSlug: "pages",
          entryId: page,
          action: "unpublish",
        },
      ]);
      expect(await visibleIds(t, "pages")).not.toContain(page);

      await handlerOf(t).updateEntry(
        {
          collectionName: "pages",
          entryId: page,
          overrideAccess: true,
          locale: "de",
        },
        { title: "DE pending" }
      );

      expect(await visibleIds(t, "pages")).toContain(page);
      expect(await stateOf(t, arranged.releaseId)).toBe("blocked");
      expect(await stoppedNotices(t, arranged)).toBe(1);
    });

    it("stops it when a Single's draft saved in another language would refuse its takedown", async () => {
      const t = await boot(dialect);
      for (const [locale, headline] of [
        ["en", "EN live"],
        ["de", "DE live"],
      ]) {
        await t.nextly.updateSingle({
          slug: "notice" as never,
          locale,
          data: { headline, status: "published" } as never,
        });
      }
      const row = await t.adapter.selectOne<{ id: string }>(
        "single_notice",
        {}
      );
      if (row === null || row === undefined) throw new Error("no notice row");
      const arranged = await dueRelease(t, [
        {
          scopeKind: "single",
          scopeSlug: "notice",
          entryId: row.id,
          action: "unpublish",
        },
      ]);
      expect(await singleVisible(t)).toBe(false);

      await t.nextly.updateSingle({
        slug: "notice" as never,
        locale: "de",
        data: { headline: "DE pending" } as never,
      });

      expect(await singleVisible(t)).toBe(true);
      expect(await stateOf(t, arranged.releaseId)).toBe("blocked");
      expect(await stoppedNotices(t, arranged)).toBe(1);
    });

    it("stops it when its author loses the role that let them take the document down", async () => {
      const t = await boot(dialect);
      const arranged = await memoTakedown(t);

      await new ServiceContainer(t.adapter).userRoles.unassignRoleFromUser(
        arranged.author,
        arranged.roleId
      );

      expect(await visibleIds(t, "memos")).toContain(arranged.memo);
      expect(await stateOf(t, arranged.releaseId)).toBe("blocked");
      expect(await stoppedNotices(t, arranged)).toBe(1);
    });

    it("stops it when the author's role stops granting the takedown", async () => {
      const t = await boot(dialect);
      const arranged = await memoTakedown(t);

      await new ServiceContainer(
        t.adapter
      ).rolePermissions.removePermissionFromRole(arranged.roleId, {
        action: "unpublish",
        resource: "memos",
      });

      expect(await visibleIds(t, "memos")).toContain(arranged.memo);
      expect(await stateOf(t, arranged.releaseId)).toBe("blocked");
      expect(await stoppedNotices(t, arranged)).toBe(1);
    });

    it("stops it when one of its documents is deleted, so the others are not shown going live", async () => {
      const t = await boot(dialect);
      const kept = await entry(t, "articles", "draft");
      const gone = await entry(t, "articles", "draft");
      const arranged = await dueRelease(
        t,
        [kept, gone].map(entryId => ({
          scopeKind: "collection" as const,
          scopeSlug: "articles",
          entryId,
          action: "publish" as const,
        }))
      );
      expect(await visibleIds(t, "articles")).toContain(kept);

      await t.nextly.delete({ collection: "articles" as never, id: gone });

      expect(await visibleIds(t, "articles")).not.toContain(kept);
      expect(await stateOf(t, arranged.releaseId)).toBe("blocked");
      expect(await stoppedNotices(t, arranged)).toBe(1);
    });

    it("stops it when the schema makes a field its document lacks required", async () => {
      const t = await boot(dialect);
      const article = await entry(t, "articles", "draft");
      const arranged = await dueRelease(t, [
        {
          scopeKind: "collection",
          scopeSlug: "articles",
          entryId: article,
          action: "publish",
        },
      ]);
      expect(await visibleIds(t, "articles")).toContain(article);

      const registry = t.getService(
        "collectionRegistryService"
      ) as CollectionRegistryService;
      const stored = await registry.getCollection("articles");
      await registry.updateCollection(
        "articles",
        {
          fields: stored.fields.map(field =>
            "name" in field && field.name === "summary"
              ? { ...field, required: true }
              : field
          ),
        },
        { source: "code" }
      );

      expect(await visibleIds(t, "articles")).not.toContain(article);
      expect(await stateOf(t, arranged.releaseId)).toBe("blocked");
      expect(await stoppedNotices(t, arranged)).toBe(1);
    });

    it("stops it when a registered source signals a change it judges hard", async () => {
      const t = await boot(dialect);
      const withdrawn = new Set<string>();
      let recheck:
        | ((target: ReleaseRecheckTarget) => Promise<void>)
        | undefined;
      registerReleaseCheckSource({
        key: "test.approval",
        severity: "hard",
        codes: ["NOT_APPROVED"],
        check: async batch =>
          batch
            .filter(member => withdrawn.has(member.entryId))
            .map(member => ({
              memberId: member.id,
              code: "NOT_APPROVED" as const,
            })),
        signal: handed => {
          recheck = handed;
        },
      });
      const article = await entry(t, "articles", "draft");
      const arranged = await dueRelease(t, [
        {
          scopeKind: "collection",
          scopeSlug: "articles",
          entryId: article,
          action: "publish",
        },
      ]);
      expect(await visibleIds(t, "articles")).toContain(article);

      withdrawn.add(article);
      await recheck?.({
        documents: [
          { scopeKind: "collection", scopeSlug: "articles", entryId: article },
        ],
      });

      expect(await visibleIds(t, "articles")).not.toContain(article);
      expect(await stateOf(t, arranged.releaseId)).toBe("blocked");
      expect(await stoppedNotices(t, arranged)).toBe(1);
    });

    it("never stops it for a soft problem", async () => {
      // The control: the document is in a second scheduled release, which is
      // a note, and a save checks it all the same.
      const t = await boot(dialect);
      const article = await entry(t, "articles", "draft");
      const member = {
        scopeKind: "collection" as const,
        scopeSlug: "articles",
        entryId: article,
        action: "publish" as const,
      };
      const arranged = await dueRelease(t, [member]);
      const other = await dueRelease(t, [member]);

      await handlerOf(t).updateEntry(
        { collectionName: "articles", entryId: article, overrideAccess: true },
        { title: "Edited" }
      );

      expect(await visibleIds(t, "articles")).toContain(article);
      expect(await stateOf(t, arranged.releaseId)).toBe("scheduled");
      expect(await stateOf(t, other.releaseId)).toBe("scheduled");
      expect(await stoppedNotices(t, arranged)).toBe(0);
    });

    it("tells the owner once per stop: a repeated event adds nothing, a second stop adds one", async () => {
      const t = await boot(dialect);
      const arranged = await memoTakedown(t);
      const roles = new ServiceContainer(t.adapter).userRoles;

      await roles.unassignRoleFromUser(arranged.author, arranged.roleId);
      // The same event again, as a retry delivers it.
      await roles.invalidateRoleCaches(arranged.author);
      expect(await stoppedNotices(t, arranged)).toBe(1);

      // Fixed, rescheduled, and stopped again: a second occurrence.
      await roles.assignRoleToUser(arranged.author, arranged.roleId);
      expect(
        (await t.nextly.releases.readiness({ releaseId: arranged.releaseId }))
          .hard
      ).toEqual([]);
      await scheduleAsItStands(
        new ReleasesRepository(t.adapter),
        arranged.releaseId,
        PAST,
        "UTC"
      );
      expect(await stateOf(t, arranged.releaseId)).toBe("scheduled");
      await roles.unassignRoleFromUser(arranged.author, arranged.roleId);

      expect(await stateOf(t, arranged.releaseId)).toBe("blocked");
      expect(await stoppedNotices(t, arranged)).toBe(2);
    });

    it("tells the owner once per stop when the drain stops it", async () => {
      const t = await boot(dialect);
      const owner = await seedLiveAuthor(t);
      const article = await entry(t, "articles", "draft");
      const repo = new ReleasesRepository(t.adapter);
      const release = await repo.createRelease({
        title: "Launch",
        createdBy: owner,
      });
      // No recorded author: nobody the run could act as, which only the run
      // finds and stops on.
      await repo.addMember(
        {
          releaseId: release.id,
          scopeKind: "collection",
          scopeSlug: "articles",
          entryId: article,
          locale: null,
          action: "publish",
          createdBy: null,
        },
        ANY_EDITABLE_STATE
      );
      await scheduleAsItStands(repo, release.id, PAST, "UTC");
      const arranged = { releaseId: release.id, owner };
      const pass = () =>
        applyDueReleases({
          repository: new ReleasesRepository(t.adapter),
          mutations: createReleaseMutations({ contentApi: t.nextly }),
          runAs: { findUser: async () => null, listRoleSlugs: async () => [] },
        });

      expect((await pass()).blocked).toBe(1);
      expect(await stoppedNotices(t, arranged)).toBe(1);
      // A second pass finds nothing due and tells nobody again.
      expect((await pass()).blocked).toBe(0);
      expect(await stoppedNotices(t, arranged)).toBe(1);

      // Put back on as it stands, and stopped again: a second occurrence.
      await scheduleAsItStands(repo, release.id, PAST, "UTC");
      expect((await pass()).blocked).toBe(1);
      expect(await stoppedNotices(t, arranged)).toBe(2);
    });
  }
);
