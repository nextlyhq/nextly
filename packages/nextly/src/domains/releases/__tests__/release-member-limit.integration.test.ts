/**
 * A release holds at most `RELEASE_MEMBER_LIMIT` documents, and a full one
 * publishes within one pass of the job that runs releases.
 *
 * The limit is a measured number, not a default: a release is settled all
 * together, so one that no pass can finish holds every one of its documents
 * back. The last case here is the measurement, on every dialect, and prints
 * its timing so the number stays tied to evidence.
 *
 * A release made before the limit and holding more is not an error to repair:
 * it runs as scheduled and can shrink, but takes nothing new.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection } from "../../../collections/config/define-collection";
import { text } from "../../../collections/fields";
import { container } from "../../../di/container";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { RELEASE_MEMBER_LIMIT } from "../../../schemas/releases/types";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { JobRegistry } from "../../jobs/job-registry";
import { runJobsPass } from "../../jobs/jobs-runner";
import { DEFAULT_MAX_DURATION_MS } from "../../jobs/run-jobs";
import { ReleasesRepository } from "../releases-repository";

import { seedLiveAuthor } from "./helpers/live-author";
import {
  ANY_EDITABLE_STATE,
  scheduleAsItStands,
} from "./helpers/release-writes";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "posts";

// Two hundred documents written and published per case, which on MySQL is
// the slow part; the pass itself is what the measured case times.
const LONG = 300_000;

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

async function drafts(t: TestNextly, count: number): Promise<string[]> {
  const handler = t.getService("collectionsHandler") as CollectionsHandler;
  const ids: string[] = [];
  for (let n = 0; n < count; n++) {
    const created = await handler.createEntry(
      { collectionName: SLUG, overrideAccess: true },
      { title: `Draft ${n}`, status: "draft" }
    );
    const id = (created.data as { id?: string } | undefined)?.id;
    if (typeof id !== "string") throw new Error("no id from create");
    ids.push(id);
  }
  return ids;
}

/**
 * A release holding these documents, written through the repository so the
 * limit the service enforces does not stand in the way: how a release made
 * before the limit came to hold more than it.
 */
async function releaseHolding(
  t: TestNextly,
  author: string,
  entryIds: readonly string[]
): Promise<string> {
  const repo = new ReleasesRepository(t.adapter);
  const release = await repo.createRelease({
    title: "Relaunch",
    createdBy: author,
  });
  for (const entryId of entryIds) {
    await repo.addMember(
      {
        releaseId: release.id,
        scopeKind: "collection",
        scopeSlug: SLUG,
        entryId,
        locale: null,
        action: "publish",
        createdBy: author,
      },
      ANY_EDITABLE_STATE
    );
  }
  return release.id;
}

function add(
  t: TestNextly,
  releaseId: string,
  entryId: string,
  author: string
) {
  return t.nextly.releases.addMember({
    releaseId,
    scopeKind: "collection",
    scopeSlug: SLUG,
    entryId,
    locale: null,
    action: "publish",
    userId: author,
  });
}

async function publishedCount(t: TestNextly): Promise<number> {
  return t.adapter.count(`dc_${SLUG}`, {
    where: { and: [{ column: "status", op: "=", value: "published" }] },
  });
}

describe.each(getConfiguredTestDialects())(
  "a release's size limit (%s)",
  dialect => {
    it(
      "takes its 200th document and refuses the 201st, saying none fit",
      async () => {
        const t = await boot(dialect);
        const author = await seedLiveAuthor(t);
        const ids = await drafts(t, RELEASE_MEMBER_LIMIT + 1);
        const id = await releaseHolding(
          t,
          author,
          ids.slice(0, RELEASE_MEMBER_LIMIT - 1)
        );

        // The 200th, through the Direct API like any caller.
        await expect(
          add(t, id, ids[RELEASE_MEMBER_LIMIT - 1], author)
        ).resolves.toBeTruthy();
        // The 201st is refused before anything is written.
        await expect(
          add(t, id, ids[RELEASE_MEMBER_LIMIT], author)
        ).rejects.toMatchObject({
          code: "CONFLICT",
          publicMessage: expect.stringMatching(/no more fit/),
        });
        const members = await t.nextly.releases.listMembers({ releaseId: id });
        expect(members).toHaveLength(RELEASE_MEMBER_LIMIT);
      },
      LONG
    );

    it(
      "refuses to grow a release made before the limit, and runs it as it stands",
      async () => {
        const t = await boot(dialect);
        const author = await seedLiveAuthor(t);
        const ids = await drafts(t, RELEASE_MEMBER_LIMIT + 2);
        const id = await releaseHolding(
          t,
          author,
          ids.slice(0, RELEASE_MEMBER_LIMIT + 1)
        );

        await expect(
          add(t, id, ids[RELEASE_MEMBER_LIMIT + 1], author)
        ).rejects.toMatchObject({
          code: "CONFLICT",
          publicMessage: expect.stringMatching(/can still be removed/),
        });

        // Scheduled and run while still OVER the limit: a release made before
        // it keeps working as it is.
        await scheduleAsItStands(
          new ReleasesRepository(t.adapter),
          id,
          new Date(Date.now() - 1_000),
          "UTC"
        );
        await runJobsPass(
          t.adapter,
          container.get<JobRegistry>("jobRegistry"),
          { retentionMs: null }
        );
        expect((await t.nextly.releases.findByID({ id }))?.state).toBe(
          "published"
        );
        expect(await publishedCount(t)).toBe(RELEASE_MEMBER_LIMIT + 1);
      },
      LONG
    );

    it(
      "lets a release made before the limit shrink, and offers removal but no add",
      async () => {
        const t = await boot(dialect);
        const author = await seedLiveAuthor(t);
        const ids = await drafts(t, RELEASE_MEMBER_LIMIT + 1);
        const id = await releaseHolding(t, author, ids);

        const row = await t.nextly.releases.findByID({ id });
        if (row === null) throw new Error("release not found");
        const can = (
          await t.nextly.releases.capabilities({ releases: [row] })
        ).get(id);
        expect(can?.addMember).toBe(false);
        expect(can?.removeMember).toBe(true);

        const members = await t.nextly.releases.listMembers({ releaseId: id });
        await t.nextly.releases.removeMember({
          releaseId: id,
          memberId: members[0].id,
        });
        expect(
          await t.nextly.releases.listMembers({ releaseId: id })
        ).toHaveLength(RELEASE_MEMBER_LIMIT);
      },
      LONG
    );

    it(
      "keeps a document already in a full release a duplicate, not a full release",
      async () => {
        const t = await boot(dialect);
        const author = await seedLiveAuthor(t);
        const ids = await drafts(t, RELEASE_MEMBER_LIMIT);
        const id = await releaseHolding(t, author, ids);
        // The retry of a document the release already holds is answered as
        // the duplicate it is, however full the release.
        await expect(add(t, id, ids[0], author)).rejects.toMatchObject({
          code: "DUPLICATE",
        });
      },
      LONG
    );

    it(
      "answers a full release that ran as final, without saying what it holds",
      async () => {
        const t = await boot(dialect);
        const author = await seedLiveAuthor(t);
        const ids = await drafts(t, RELEASE_MEMBER_LIMIT + 1);
        const id = await releaseHolding(
          t,
          author,
          ids.slice(0, RELEASE_MEMBER_LIMIT)
        );
        await t.nextly.releases.cancel({ id });
        // The final-state refusal comes first: a caller who may only create
        // learns the release is cancelled, not how many documents it holds.
        const refusal = add(t, id, ids[RELEASE_MEMBER_LIMIT], author);
        await expect(refusal).rejects.toMatchObject({ code: "CONFLICT" });
        await refusal.catch((error: { publicMessage?: string }) => {
          expect(error.publicMessage).toMatch(/cancelled/);
          expect(error.publicMessage).not.toMatch(/holds|200/);
        });
      },
      LONG
    );

    it(
      "holds the limit when documents are added at once, not only one by one",
      async () => {
        const t = await boot(dialect);
        const author = await seedLiveAuthor(t);
        const ids = await drafts(t, RELEASE_MEMBER_LIMIT + 4);
        const id = await releaseHolding(
          t,
          author,
          ids.slice(0, RELEASE_MEMBER_LIMIT - 1)
        );

        // Five adds racing for the one place left: every one reads 199 before
        // any has written, so only the check under the release lock can hold.
        const results = await Promise.allSettled(
          ids
            .slice(RELEASE_MEMBER_LIMIT - 1)
            .map(entryId => add(t, id, entryId, author))
        );
        expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
        expect(
          await t.nextly.releases.listMembers({ releaseId: id })
        ).toHaveLength(RELEASE_MEMBER_LIMIT);
      },
      LONG
    );

    it(
      "publishes a full release within one pass of the job that runs releases",
      async () => {
        const t = await boot(dialect);
        const author = await seedLiveAuthor(t);
        const ids = await drafts(t, RELEASE_MEMBER_LIMIT);
        const id = await releaseHolding(t, author, ids);
        await scheduleAsItStands(
          new ReleasesRepository(t.adapter),
          id,
          new Date(Date.now() - 1_000),
          "UTC"
        );

        // ONE pass with the runner's own default budget: the release must be
        // settled by it, or the limit is too high for this dialect.
        const started = Date.now();
        await runJobsPass(
          t.adapter,
          container.get<JobRegistry>("jobRegistry"),
          { retentionMs: null }
        );
        const elapsedMs = Date.now() - started;

        expect((await t.nextly.releases.findByID({ id }))?.state).toBe(
          "published"
        );
        expect(await publishedCount(t)).toBe(RELEASE_MEMBER_LIMIT);
        // Within the runner's own budget, not merely allowed to overrun it:
        // the runner lets a started handler outlive its deadline, so finishing
        // is not the property; finishing inside one tick is.
        expect(elapsedMs).toBeLessThan(DEFAULT_MAX_DURATION_MS);
        console.info(
          `[release-member-limit] ${dialect}: ${RELEASE_MEMBER_LIMIT} documents published in one pass, ${elapsedMs} ms`
        );
      },
      LONG
    );
  }
);
