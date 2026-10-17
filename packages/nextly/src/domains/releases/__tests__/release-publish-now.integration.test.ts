/**
 * Publish now, and the states a release can no longer leave.
 *
 * Publish now schedules a release for this moment and runs the runner's own
 * releases drain job at once, under the claim a scheduled pass takes, so the
 * properties worth proving against a real database are the ones a shortcut
 * would lose: the documents are written for real (the stored row, not only
 * what a read projects), they are written as each member's author, the whole
 * release goes together, a run is never repeated, and nothing runs beside a
 * drain another runner already holds.
 *
 * The second half is what "never re-run or change a release that ran" means
 * for the other transitions: a published or cancelled release takes no further
 * change, while a STOPPED one — which has not run — can still be fixed.
 *
 * Runs against whichever dialects the integration run configures; CI covers
 * SQLite, PostgreSQL and MySQL.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection } from "../../../collections/config/define-collection";
import { text } from "../../../collections/fields";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { container } from "../../../di/container";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { JobRegistry } from "../../jobs/job-registry";
import { JobsRepository } from "../../jobs/jobs-repository";
import { runJobsPass, sweepDedupeKey } from "../../jobs/jobs-runner";
import { RELEASES_DRAIN_JOB } from "../releases-drain-job";
import { ReleasesRepository } from "../releases-repository";

import { deactivate, seedLiveAuthor } from "./helpers/live-author";
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
const DAY = 24 * 60 * 60 * 1000;

async function boot(
  dialect: TestDialect,
  /** Run after each write to a document, for a case that must pause one. */
  afterChange?: () => Promise<void>
): Promise<TestNextly> {
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
        ...(afterChange === undefined
          ? {}
          : { hooks: { afterChange: [() => afterChange()] } }),
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return current;
}

/**
 * A gate a document write waits at once armed, so a case can act while a
 * drain is part-way through a release. `entered` settles when a write reaches
 * it; `open` lets every waiting write through. Writes before `arm` pass.
 */
function writeGate() {
  let armed = false;
  let writes = 0;
  let signalEntered: () => void = () => {};
  let release: () => void = () => {};
  const entered = new Promise<void>(resolve => {
    signalEntered = resolve;
  });
  const opened = new Promise<void>(resolve => {
    release = resolve;
  });
  return {
    arm: () => {
      armed = true;
    },
    entered,
    open: () => release(),
    writes: () => writes,
    afterChange: async () => {
      if (!armed) return;
      writes += 1;
      signalEntered();
      await opened;
    },
  };
}

/** The stored lifecycle of a row, read RAW rather than through the read path. */
async function storedStatus(
  t: TestNextly,
  id: string
): Promise<string | undefined> {
  const row = await t.adapter.selectOne<{ status?: string }>(`dc_${SLUG}`, {
    where: { and: [{ column: "id", op: "=", value: id }] },
  });
  return row?.status;
}

async function draft(t: TestNextly, title: string): Promise<string> {
  const handler = t.getService("collectionsHandler") as CollectionsHandler;
  const created = await handler.createEntry(
    { collectionName: SLUG, overrideAccess: true },
    { title, status: "draft" }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");
  return id;
}

/** A release holding these drafts to go live, added by `author`. */
async function releaseOf(
  t: TestNextly,
  author: string,
  entryIds: string[],
  title = "Launch"
): Promise<string> {
  const repo = new ReleasesRepository(t.adapter);
  const release = await repo.createRelease({ title, createdBy: author });
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

async function stateOf(t: TestNextly, id: string): Promise<string | undefined> {
  return (await t.nextly.releases.findByID({ id }))?.state;
}

/** How long another runner's claim on the drain is held in these cases. */
const LEASE_MS = 30_000;

/**
 * Hold the releases drain as another runner would: its one sweep row, queued
 * under the sweep's dedupe key the way a pass queues it, and claimed under a
 * lease. Returns the instant that lease lapses.
 */
async function holdDrain(t: TestNextly): Promise<Date> {
  const jobs = new JobsRepository(t.adapter);
  const now = new Date();
  const { id } = await jobs.enqueue({
    slug: RELEASES_DRAIN_JOB,
    input: null,
    runAt: null,
    runAsUserId: null,
    dedupeKey: sweepDedupeKey(RELEASES_DRAIN_JOB),
    now,
  });
  const claimed = await jobs.claim(id, "another-runner", now, LEASE_MS);
  if (claimed === null) throw new Error("the drain could not be held");
  return new Date(now.getTime() + LEASE_MS);
}

describe.each(getConfiguredTestDialects())(
  "publish now, and releases that ran (%s)",
  dialect => {
    it("runs a scheduled release at once, writing every document as its author", async () => {
      // Scheduled for next week, so only Publish now can explain the rows
      // being published today — the read path would not project a release
      // whose time has not come.
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const a = await draft(t, "First");
      const b = await draft(t, "Second");
      const id = await releaseOf(t, author, [a, b]);
      await scheduleAsItStands(
        new ReleasesRepository(t.adapter),
        id,
        new Date(Date.now() + 7 * DAY),
        "Europe/Berlin"
      );

      const ran = await t.nextly.releases.publishNow({ id });

      expect(ran.state).toBe("published");
      // Raw rows: a run that wrote nothing would still read as published
      // through the read path once its instant had passed.
      expect(await storedStatus(t, a)).toBe("published");
      expect(await storedStatus(t, b)).toBe("published");
      // The zone the author chose is kept: it is part of the record.
      expect(ran.timezone).toBe("Europe/Berlin");
    });

    it("runs a release once when two requests to publish it now overlap", async () => {
      // A double click or a retry. The first request moves the release to now
      // and runs the drain. The second arrives while that drain is part-way
      // through: the release is due, so it is not moved again, and the drain
      // is held, so nothing runs a second time. It answers `scheduled`, and
      // the first run finishes the release.
      const gate = writeGate();
      const t = await boot(dialect, gate.afterChange);
      const author = await seedLiveAuthor(t);
      const a = await draft(t, "Once");
      const id = await releaseOf(t, author, [a]);
      await scheduleAsItStands(
        new ReleasesRepository(t.adapter),
        id,
        new Date(Date.now() + 7 * DAY),
        "UTC"
      );
      gate.arm();

      const first = t.nextly.releases.publishNow({ id });
      // The first run is writing the document, and waits there.
      const reached = await Promise.race([
        gate.entered.then(() => "drain" as const),
        first.then(() => "finished" as const),
      ]);
      expect(reached).toBe("drain");
      const moved = await new ReleasesRepository(t.adapter).findReleases({
        ids: [id],
      });

      const second = await t.nextly.releases.publishNow({ id });

      expect(second.state).toBe("scheduled");
      // Not moved again: the instant the running drain checks is unchanged.
      expect(second.scheduledAt?.getTime()).toBe(
        moved[0]?.scheduledAt?.getTime()
      );
      expect(second.revision).toBe(moved[0]?.revision);

      gate.open();
      expect((await first).state).toBe("published");
      expect(await stateOf(t, id)).toBe("published");
      expect(await storedStatus(t, a)).toBe("published");
      // Written once: the second request ran nothing of its own.
      expect(gate.writes()).toBe(1);
    });

    it("a second Publish now while the first's drain runs does not delay the release", async () => {
      // The release is already due and another runner holds the drain. Moving
      // it again would change the instant that drain checks before marking it
      // published, and it would leave the release for the next pass. So it is
      // left as it is, and answered `scheduled`.
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const a = await draft(t, "Due");
      const id = await releaseOf(t, author, [a]);
      const due = new Date(Date.now() - 60_000);
      await scheduleAsItStands(
        new ReleasesRepository(t.adapter),
        id,
        due,
        "UTC"
      );
      const [before] = await new ReleasesRepository(t.adapter).findReleases({
        ids: [id],
      });
      await holdDrain(t);

      const answered = await t.nextly.releases.publishNow({ id });

      expect(answered.state).toBe("scheduled");
      expect(answered.scheduledAt?.getTime()).toBe(
        before?.scheduledAt?.getTime()
      );
      expect(answered.revision).toBe(before?.revision);
      expect(await storedStatus(t, a)).toBe("draft");
    });

    it("answers scheduled while another runner holds the drain, and the next pass publishes it", async () => {
      // Publish now runs the drain under its claim rather than a pass of its
      // own, so while another runner holds that claim nothing runs here: the
      // release is moved to now and left for that runner or the next pass.
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const a = await draft(t, "Waits");
      const id = await releaseOf(t, author, [a]);
      await scheduleAsItStands(
        new ReleasesRepository(t.adapter),
        id,
        new Date(Date.now() + 7 * DAY),
        "UTC"
      );
      const lapses = await holdDrain(t);

      const answered = await t.nextly.releases.publishNow({ id });

      expect(answered.state).toBe("scheduled");
      expect(await storedStatus(t, a)).toBe("draft");
      // Moved to now, so the next pass finds it due rather than next week.
      expect(answered.scheduledAt?.getTime()).toBeLessThan(lapses.getTime());

      // The next pass, once the other runner's lease has lapsed: the ordinary
      // trigger, through the installation's own registry.
      const pass = await runJobsPass(
        t.adapter,
        container.get<JobRegistry>("jobRegistry"),
        { now: () => new Date(lapses.getTime() + 1_000), retentionMs: null }
      );

      expect(pass.done).toBeGreaterThanOrEqual(1);
      expect(await stateOf(t, id)).toBe("published");
      expect(await storedStatus(t, a)).toBe("published");
    });

    it("runs a draft release at once", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const a = await draft(t, "Only");
      const id = await releaseOf(t, author, [a]);

      const ran = await t.nextly.releases.publishNow({ id });

      expect(ran.state).toBe("published");
      expect(await storedStatus(t, a)).toBe("published");
    });

    it("refuses a release that would stop, and changes nothing", async () => {
      // The same check scheduling makes: an author who can no longer act would
      // stop the run part-way. Refused BEFORE any document is written, so none
      // of the release goes out rather than some of it.
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const gone = await seedLiveAuthor(t);
      const a = await draft(t, "Fine");
      const b = await draft(t, "Stuck");
      const id = await releaseOf(t, author, [a]);
      await new ReleasesRepository(t.adapter).addMember(
        {
          releaseId: id,
          scopeKind: "collection",
          scopeSlug: SLUG,
          entryId: b,
          locale: null,
          action: "publish",
          createdBy: gone,
        },
        ANY_EDITABLE_STATE
      );
      await deactivate(t, gone);

      await expect(t.nextly.releases.publishNow({ id })).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(await stateOf(t, id)).toBe("draft");
      expect(await storedStatus(t, a)).toBe("draft");
      expect(await storedStatus(t, b)).toBe("draft");
    });

    it("sends out with it a release that was already due, as the runner's pass does", async () => {
      // Publish now runs the drain itself, and a drain sends out every release
      // whose time has come. An overdue release is the runner's to send, and
      // it would have gone out on the runner's next pass anyway; it is not
      // left waiting behind one that was run on demand.
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const mine = await draft(t, "Mine");
      const theirs = await draft(t, "Theirs");
      const id = await releaseOf(t, author, [mine]);
      const other = await releaseOf(t, author, [theirs], "Other");
      await scheduleAsItStands(
        new ReleasesRepository(t.adapter),
        other,
        new Date(Date.now() - DAY),
        "UTC"
      );

      await t.nextly.releases.publishNow({ id });

      expect(await storedStatus(t, mine)).toBe("published");
      expect(await storedStatus(t, theirs)).toBe("published");
      expect(await stateOf(t, other)).toBe("published");
    });

    it("refuses a single-document release with no document, and changes nothing", async () => {
      // Run now, it would publish nothing and be final with nothing in it. The
      // same refusal scheduling makes, before anything is written.
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const repo = new ReleasesRepository(t.adapter);
      const empty = await repo.createRelease({
        title: "Launch post",
        kind: "single",
        createdBy: author,
      });

      await expect(
        t.nextly.releases.publishNow({ id: empty.id })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining(
          "A single-document release needs its document"
        ),
      });
      const [after] = await repo.findReleases({ ids: [empty.id] });
      expect(after?.state).toBe("draft");
      expect(after?.scheduledAt).toBeNull();
      expect(after?.revision).toBe(empty.revision);
    });

    it("never runs a release twice, nor one that stopped or was cancelled", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const repo = new ReleasesRepository(t.adapter);

      const published = await releaseOf(t, author, [await draft(t, "P")]);
      await t.nextly.releases.publishNow({ id: published });

      const cancelled = await releaseOf(t, author, [await draft(t, "C")]);
      await repo.cancelRelease(cancelled);

      const stoppedDoc = await draft(t, "S");
      const stopped = await releaseOf(t, author, [stoppedDoc]);
      const at = new Date(Date.now() - DAY);
      await scheduleAsItStands(repo, stopped, at, "UTC");
      await repo.blockReleases([{ id: stopped, scheduledAt: at }]);

      for (const [id, state] of [
        [published, "published"],
        [cancelled, "cancelled"],
        [stopped, "blocked"],
      ] as const) {
        await expect(
          t.nextly.releases.publishNow({ id })
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(await stateOf(t, id)).toBe(state);
      }
      // A stopped release is fixed and scheduled again, never run as it is.
      expect(await storedStatus(t, stoppedDoc)).toBe("draft");
    });

    it("lets documents come out of a stopped release, and not out of one that ran", async () => {
      // Removing the document that stopped a release is how it is fixed, so a
      // stopped release must stay editable. A published or cancelled one is
      // the record of what happened, and stays as it is.
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const repo = new ReleasesRepository(t.adapter);

      const stopped = await releaseOf(t, author, [await draft(t, "S")]);
      const at = new Date(Date.now() - DAY);
      await scheduleAsItStands(repo, stopped, at, "UTC");
      await repo.blockReleases([{ id: stopped, scheduledAt: at }]);
      const [stoppedMember] = await repo.listMembers(stopped);
      await t.nextly.releases.removeMember({
        memberId: stoppedMember.id,
        releaseId: stopped,
      });
      expect(await repo.listMembers(stopped)).toEqual([]);

      const published = await releaseOf(t, author, [await draft(t, "P")]);
      await t.nextly.releases.publishNow({ id: published });
      const cancelled = await releaseOf(t, author, [await draft(t, "C")]);
      await repo.cancelRelease(cancelled);

      for (const id of [published, cancelled]) {
        const [member] = await repo.listMembers(id);
        await expect(
          t.nextly.releases.removeMember({ memberId: member.id, releaseId: id })
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(await repo.listMembers(id)).toHaveLength(1);
      }
    });

    it("treats a cancelled release as final: no new documents, no new time", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const repo = new ReleasesRepository(t.adapter);
      const id = await releaseOf(t, author, [await draft(t, "C")]);
      await repo.cancelRelease(id);

      await expect(
        t.nextly.releases.addMember({
          releaseId: id,
          scopeKind: "collection",
          scopeSlug: SLUG,
          entryId: await draft(t, "Late"),
          locale: null,
          action: "publish",
          userId: author,
        })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining("create a new release"),
      });
      await expect(
        t.nextly.releases.schedule({
          id,
          at: new Date(Date.now() + DAY),
          timezone: "UTC",
        })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining("create a new release"),
      });
      expect(await stateOf(t, id)).toBe("cancelled");
      expect(await repo.listMembers(id)).toHaveLength(1);
    });
  }
);
