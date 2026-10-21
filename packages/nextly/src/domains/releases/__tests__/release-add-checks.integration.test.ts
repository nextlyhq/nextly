/**
 * The checks a document must pass to join a release, on every way in.
 *
 * They were the REST route's alone, so the Direct API accepted a member REST
 * refuses: a document that is not there, a collection with no draft/published
 * lifecycle, a Single named by a stale id. Each of those is recorded, scheduled
 * and then fails at its instant, holding the release open with nobody
 * watching. These cases go through the Direct API, which is the door that had
 * no check.
 *
 * And the due releases are found by a query, not by reading every scheduled
 * release: a site with a year of launches planned reads only the ones due.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { Logger } from "../../../services/shared";
import { ReleasesRepository } from "../releases-repository";

import { seedLiveAuthor } from "./helpers/live-author";
import { scheduleAsItStands } from "./helpers/release-writes";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(
  dialect: TestDialect,
  logger?: Logger
): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    logger,
    collections: [
      defineCollection({
        slug: "posts",
        status: true,
        access: { read: () => true, update: () => true, publish: () => true },
        fields: [text({ name: "title" })],
      }),
      // Anyone may write and publish a memo, but there is no read rule: who
      // may READ one is the caller's grants alone, so a scoped key is judged
      // by its own and not its owner's.
      defineCollection({
        slug: "memos",
        status: true,
        access: { update: () => true, publish: () => true },
        fields: [text({ name: "title" })],
      }),
      // No `status`: no draft/published lifecycle, so nothing a release can
      // publish.
      defineCollection({
        slug: "notes",
        access: { read: () => true, update: () => true },
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      // Never saved in these tests: it has no stored row.
      defineSingle({
        slug: "banner",
        status: true,
        access: { read: () => true, update: () => true },
        fields: [text({ name: "headline" })],
      }),
      defineSingle({
        slug: "homepage",
        status: true,
        access: { read: () => true, update: () => true },
        fields: [text({ name: "headline" })],
      }),
    ],
  });
  return current;
}

async function post(t: TestNextly): Promise<string> {
  const created = (await t.nextly.create({
    collection: "posts" as never,
    data: { title: "Draft", status: "draft" } as never,
  })) as unknown as { item?: { id?: string }; id?: string };
  return String(created.item?.id ?? created.id);
}

/**
 * Forget a Single's table in this process, as a worker that booted before
 * the Single existed has never registered it: the table is in the database,
 * not in this worker's schema registry, until a request-scoped read registers
 * it. `register` stands in for that registration, to make it fail.
 */
function forgetTables(
  t: TestNextly,
  names: string[],
  register?: (name: string, table: unknown) => void
): void {
  const inner = (
    t.adapter as unknown as { tableResolver: { getTable(n: string): unknown } }
  ).tableResolver;
  const forgotten = new Set(names);
  const own = new Map<string, unknown>();
  (
    t.adapter as unknown as { setTableResolver(r: unknown): void }
  ).setTableResolver({
    getTable(name: string) {
      if (own.has(name)) return own.get(name);
      if (forgotten.has(name)) return null;
      return inner.getTable(name);
    },
    registerDynamicSchema(name: string, table: unknown) {
      register?.(name, table);
      own.set(name, table);
    },
  });
}

describe.each(getConfiguredTestDialects())(
  "a document joining a release through the Direct API (%s)",
  dialect => {
    it("refuses a document that is not there", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const release = await t.nextly.releases.create({ title: "Launch" });
      await expect(
        t.nextly.releases.addMember({
          releaseId: release.id,
          scopeKind: "collection",
          scopeSlug: "posts",
          entryId: "00000000-0000-4000-8000-00000000dead",
          locale: null,
          action: "publish",
          userId: author,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(
        await t.nextly.releases.listMembers({ releaseId: release.id })
      ).toEqual([]);
    });

    it("refuses a collection with no draft/published lifecycle", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const note = (await t.nextly.create({
        collection: "notes" as never,
        data: { title: "A note" } as never,
      })) as unknown as { item?: { id?: string }; id?: string };
      const release = await t.nextly.releases.create({ title: "Launch" });
      await expect(
        t.nextly.releases.addMember({
          releaseId: release.id,
          scopeKind: "collection",
          scopeSlug: "notes",
          entryId: String(note.item?.id ?? note.id),
          locale: null,
          action: "publish",
          userId: author,
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    });

    it("stores a Single's own id, not the one the caller sent", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      await t.nextly.updateSingle({
        slug: "homepage" as never,
        data: { headline: "Draft", status: "draft" } as never,
      });
      const row = await t.adapter.selectOne<{ id: string }>(
        "single_homepage",
        {}
      );
      const release = await t.nextly.releases.create({ title: "Launch" });
      const member = await t.nextly.releases.addMember({
        releaseId: release.id,
        scopeKind: "single",
        scopeSlug: "homepage",
        entryId: "stale-id",
        locale: null,
        action: "publish",
        userId: author,
      });
      expect(member.entryId).toBe(row?.id);
    });

    it("reads the target as the calling key, not as the key's owner", async () => {
      // The owner holds no grant on memos at all; the key holds the ones the
      // add needs. Judged by the owner, the key could not see the memo it was
      // allowed to schedule — and, the other way round, a key without
      // `read-memos` could confirm a document its owner can read.
      const t = await boot(dialect);
      const owner = await seedLiveAuthor(t);
      const memo = (await t.nextly.create({
        collection: "memos" as never,
        data: { title: "Memo", status: "draft" } as never,
      })) as unknown as { item?: { id?: string }; id?: string };
      const entryId = String(memo.item?.id ?? memo.id);
      const release = await t.nextly.releases.create({ title: "Launch" });
      const asKey = (permissions: string[]) =>
        t.nextly.releases.addMember({
          releaseId: release.id,
          scopeKind: "collection",
          scopeSlug: "memos",
          entryId,
          locale: null,
          action: "publish",
          userId: owner,
          overrideAccess: false,
          authenticatedScope: { actorType: "apiKey", permissions },
          // The key's own id, which the release's history names it by.
          apiKeyId: "memo-key",
        });
      const writes = [
        "create-content-releases",
        "update-memos",
        "publish-memos",
      ];

      await expect(asKey(writes)).rejects.toMatchObject({ code: "NOT_FOUND" });
      const member = await asKey([...writes, "read-memos"]);
      expect(member.entryId).toBe(entryId);
    });

    it("refuses a Single that was never saved, and creates no row for it", async () => {
      // A Single's ordinary read creates its row when there is none. The
      // check must not: it would accept a document that is not there and
      // leave a blank row behind.
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const release = await t.nextly.releases.create({ title: "Launch" });
      await expect(
        t.nextly.releases.addMember({
          releaseId: release.id,
          scopeKind: "single",
          scopeSlug: "banner",
          entryId: "anything",
          locale: null,
          action: "publish",
          userId: author,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await t.adapter.select("single_banner", {})).toEqual([]);
    });

    it("finds a saved Single in a worker that has not registered its table", async () => {
      // The read-only existence check must register the runtime table as
      // every request-scoped Single read does, or a valid Single cannot be
      // added from a second server process.
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      await t.nextly.updateSingle({
        slug: "homepage" as never,
        data: { headline: "Draft", status: "draft" } as never,
      });
      const row = await t.adapter.selectOne<{ id: string }>(
        "single_homepage",
        {}
      );
      forgetTables(t, ["single_homepage"]);
      const release = await t.nextly.releases.create({ title: "Launch" });
      const member = await t.nextly.releases.addMember({
        releaseId: release.id,
        scopeKind: "single",
        scopeSlug: "homepage",
        entryId: "stale-id",
        locale: null,
        action: "publish",
        userId: author,
      });
      expect(member.entryId).toBe(row?.id);
    });

    it("says why a Single's table could not be registered", async () => {
      // A worker that cannot register the table still refuses the add, and
      // the logger it was booted with carries the reason, as on every other
      // request-scoped Single read.
      const traces: Array<{ message: string; meta: unknown }> = [];
      const t = await boot(dialect, {
        debug: (message, meta) => traces.push({ message, meta }),
        info() {},
        warn() {},
        error() {},
      });
      const author = await seedLiveAuthor(t);
      await t.nextly.updateSingle({
        slug: "homepage" as never,
        data: { headline: "Draft", status: "draft" } as never,
      });
      forgetTables(t, ["single_homepage"], () => {
        throw new Error("stored fields are unreadable");
      });
      const release = await t.nextly.releases.create({ title: "Launch" });
      await expect(
        t.nextly.releases.addMember({
          releaseId: release.id,
          scopeKind: "single",
          scopeSlug: "homepage",
          entryId: "any",
          locale: null,
          action: "publish",
          userId: author,
        })
      ).rejects.toThrow();
      expect(traces).toContainEqual({
        message: "Lazy single runtime-table registration skipped",
        meta: expect.objectContaining({
          slug: "homepage",
          error: "stored fields are unreadable",
        }),
      });
    });

    it("accepts a real draft in a collection with a lifecycle", async () => {
      // The control: the checks refuse only what they should.
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const id = await post(t);
      const release = await t.nextly.releases.create({ title: "Launch" });
      const member = await t.nextly.releases.addMember({
        releaseId: release.id,
        scopeKind: "collection",
        scopeSlug: "posts",
        entryId: id,
        locale: null,
        action: "publish",
        userId: author,
      });
      expect(member.entryId).toBe(id);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "finding the due releases (%s)",
  dialect => {
    it("finds a release due at exactly now, and not one a second later", async () => {
      // The drain's query at the boundary itself: inclusive, as the resolver
      // is. Whole seconds, because SQLite stores instants in whole seconds.
      const t = await boot(dialect);
      const repo = new ReleasesRepository(t.adapter);
      const now = new Date(Math.floor(Date.now() / 1000) * 1000);
      const atNow = await repo.createRelease({ title: "At now" });
      await scheduleAsItStands(repo, atNow.id, now, "UTC");
      const later = await repo.createRelease({ title: "A second later" });
      await scheduleAsItStands(
        repo,
        later.id,
        new Date(now.getTime() + 1000),
        "UTC"
      );

      const due = await repo.findDueReleases(now);
      expect(due.map(row => row.title)).toEqual(["At now"]);
    });

    it("reads only the releases that are due, not every scheduled one", async () => {
      const t = await boot(dialect);
      const repo = new ReleasesRepository(t.adapter);
      const now = new Date();
      const day = 24 * 60 * 60 * 1000;
      for (let i = 0; i < 40; i += 1) {
        const future = await repo.createRelease({ title: `Future ${i}` });
        await scheduleAsItStands(
          repo,
          future.id,
          new Date(now.getTime() + (i + 1) * day),
          "UTC"
        );
      }
      const due = await repo.createRelease({ title: "Due" });
      await scheduleAsItStands(
        repo,
        due.id,
        new Date(now.getTime() - day),
        "UTC"
      );

      // Count the rows the database hands back for the read, through a
      // wrapper on the adapter the repository reads with.
      let rowsRead = 0;
      const counted = Object.create(t.adapter) as typeof t.adapter;
      counted.select = async <T = unknown>(
        ...args: Parameters<typeof t.adapter.select>
      ): Promise<T[]> => {
        const rows = await t.adapter.select<T>(...args);
        rowsRead += rows.length;
        return rows;
      };
      const found = await new ReleasesRepository(counted).findDueReleases(now);

      expect(found.map(row => row.title)).toEqual(["Due"]);
      // The forty future releases never left the database.
      expect(rowsRead).toBe(1);
    });
  }
);
