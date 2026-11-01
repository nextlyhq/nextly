/**
 * Two writes made outside any request reach the cache tag expiry ledger, where
 * every instance's cache handlers read them: a scheduled release going live,
 * and a job's write. Time is controlled through the clock each runner is given.
 * Each path is first run before its time, which writes and records nothing, so
 * the row found afterwards is the write's own and not the setup's.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../../config";
import { applyDueReleases } from "../../../domains/releases/apply-due-releases";
import {
  ANY_EDITABLE_STATE,
  lockServerOf,
  scheduleAsItStands,
} from "../../../domains/releases/__tests__/helpers/release-writes";
import { createReleaseMutations } from "../../../domains/releases/release-mutations";
import { ReleasesRepository } from "../../../domains/releases/releases-repository";
import { JobRegistry, defineJob } from "../../../domains/jobs/job-registry";
import { JobsRepository } from "../../../domains/jobs/jobs-repository";
import { runJobNow } from "../../../domains/jobs/jobs-runner";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { collectionTag } from "../../../revalidation/compute-tags";
import { cacheTagExpiriesTables } from "../../../schemas/cache-tag-expiries";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { ledgerFor } from "../tag-expiry-ledger";

const SLUG = "posts";
/** When the release and the job are due; each runner is told the time. */
const DUE = new Date("2030-01-01T00:00:00Z");
const BEFORE = new Date(DUE.getTime() - 60_000);
const AFTER = new Date(DUE.getTime() + 1_000);

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: SLUG,
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

/** Empties the ledger, so a row found later was recorded after this. */
async function clearLedger(t: TestNextly, dialect: TestDialect): Promise<void> {
  const table = cacheTagExpiriesTables(dialect).nextlyCacheTagExpiries;
  await t.adapter
    .getDrizzle<{ delete(table: unknown): PromiseLike<unknown> }>()
    .delete(table);
}

/** Whether the ledger holds an expiry of the collection's tag. */
async function collectionTagRecorded(t: TestNextly): Promise<boolean> {
  const tag = collectionTag(SLUG);
  return (
    (await ledgerFor(t.adapter).expiriesOf([tag]))?.expired.has(tag) ?? false
  );
}

describe.each(getConfiguredTestDialects())(
  "a write outside a request reaches the ledger (%s)",
  dialect => {
    /** A draft in a release due at {@link DUE}, with no expiry left over. */
    async function draftInRelease(t: TestNextly): Promise<void> {
      // The author the release acts as may publish posts.
      await userWhoMay(t, "author-1", "read", [SLUG]);
      await grantTo(t, "author-1", "update", [SLUG]);
      await grantTo(t, "author-1", "publish", [SLUG]);
      const handler = t.getService("collectionsHandler") as CollectionsHandler;
      const created = await handler.createEntry(
        { collectionName: SLUG, overrideAccess: true },
        { title: "pending", status: "draft" }
      );
      const id = (created.data as { id?: string } | undefined)?.id;
      if (typeof id !== "string") throw new Error("no id from create");
      const repo = new ReleasesRepository(t.adapter);
      const release = await repo.createRelease({ title: "Go live" });
      await repo.addMember(
        {
          releaseId: release.id,
          scopeKind: "collection",
          scopeSlug: SLUG,
          entryId: id,
          locale: null,
          action: "publish",
          createdBy: "author-1",
        },
        ANY_EDITABLE_STATE
      );
      await scheduleAsItStands(repo, release.id, DUE, "UTC");
      // The create and the schedule expire the collection's tags themselves.
      await clearLedger(t, dialect);
    }

    /** One pass of the release runner, at `now`. */
    const goLive = (t: TestNextly, now: Date) =>
      applyDueReleases({
        repository: new ReleasesRepository(t.adapter),
        mutations: createReleaseMutations({
          contentApi: t.nextly,
          lockServer: lockServerOf(t),
        }),
        runAs: {
          findUser: async id => ({ id, isActive: true }),
          listRoleSlugs: async () => [],
        },
        now: () => now,
      });

    it("records a scheduled release's publish once its time has come", async () => {
      const t = await boot(dialect);
      await draftInRelease(t);

      // Before its time the pass publishes nothing, and nothing is recorded.
      expect(await goLive(t, BEFORE)).toMatchObject({ due: 0, applied: 0 });
      expect(await collectionTagRecorded(t)).toBe(false);

      expect(await goLive(t, AFTER)).toMatchObject({
        applied: 1,
        published: 1,
      });
      expect(await collectionTagRecorded(t)).toBe(true);
    });

    it("records a job's write, at the runner's clock", async () => {
      const t = await boot(dialect);
      const registry = new JobRegistry();
      registry.register(
        defineJob({
          slug: "test:write-a-post",
          // A job that needs trusted access imports nextly itself.
          handler: async () => {
            await t.nextly.create({
              collection: SLUG,
              data: { title: "from a job" },
            });
          },
        })
      );
      const { id } = await new JobsRepository(t.adapter).enqueue({
        slug: "test:write-a-post",
        input: {},
        runAt: DUE,
        runAsUserId: null,
        dedupeKey: null,
        now: BEFORE,
      });
      await clearLedger(t, dialect);

      // Not due yet at the runner's clock: nothing is written or recorded.
      const early = await runJobNow(t.adapter, registry, id, {
        now: () => BEFORE,
      });
      expect(early.claimed).toBe(0);
      expect(await collectionTagRecorded(t)).toBe(false);

      const onTime = await runJobNow(t.adapter, registry, id, {
        now: () => AFTER,
      });
      expect(onTime).toMatchObject({ claimed: 1, done: 1 });
      expect(await collectionTagRecorded(t)).toBe(true);
    });
  }
);
