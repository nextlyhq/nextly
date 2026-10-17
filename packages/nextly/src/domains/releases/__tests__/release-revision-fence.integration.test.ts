/**
 * A release's revision, and the moves fenced on it, against a REAL database.
 *
 * Scheduling a single-document release is judged from a read — it must hold its
 * one document — and written by a later statement. A member removal landing
 * between the two must make the write miss, and so must the opposite order:
 * a removal judged against a draft must not land on a release scheduled since.
 * The fence that decides both is the revision every membership change and every
 * schedule bumps, so the interleavings are run on each dialect the integration
 * run configures.
 *
 * Each interleaving is placed deterministically: a repository subclass runs the
 * competing move through the ordinary Direct API immediately before its own
 * write, after the service has formed its verdict. No timers, no sleeps.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  RELEASE_ASSEMBLABLE_FROM,
  RELEASE_SCHEDULABLE_FROM,
} from "../../../schemas/releases/types";
import { ReleasesRepository } from "../releases-repository";
import { ReleasesService } from "../services/releases-service";

import { seedLiveAuthor } from "./helpers/live-author";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
/** Whole seconds, so every dialect stores exactly this instant. */
const PAST = new Date("2020-01-01T00:00:00Z");

/** A caller the service does not ask the permission store about. */
const TRUSTED = { userId: null, overrideAccess: true };

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "posts",
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return current;
}

/** A drafted post, by id. */
async function post(t: TestNextly, title: string): Promise<string> {
  const created = await t.nextly.create({
    collection: "posts",
    data: { title, status: "draft" },
    overrideAccess: true,
  });
  const id = (created.item as { id?: unknown }).id;
  if (typeof id !== "string") throw new Error("the post has no id");
  return id;
}

/** A single-document release holding one post, and that member's id. */
async function singleWithOneMember(
  t: TestNextly
): Promise<{ releaseId: string; memberId: string }> {
  const userId = await seedLiveAuthor(t);
  const release = await t.nextly.releases.create({
    title: "Launch post",
    kind: "single",
  });
  const member = await t.nextly.releases.addMember({
    releaseId: release.id,
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId: await post(t, "launch"),
    locale: null,
    action: "publish",
    userId,
  });
  return { releaseId: release.id, memberId: member.id };
}

/**
 * The service over a given repository. Only the repository is reached by the
 * moves under test for a trusted caller; the other collaborators refuse, so a
 * path that reached one would fail loudly rather than pass by accident.
 */
function serviceOver(repository: ReleasesRepository): ReleasesService {
  return new ReleasesService({
    repository,
    targets: {
      readDocument: async () => null,
      declaresLifecycle: async () => false,
    },
    canManageReleases: async () => false,
    canActOnDocument: async () => false,
    // No move under test runs a release.
    runDrainNow: async () => undefined,
  });
}

/** Runs `before` once, immediately before the schedule's own write. */
class InterleavedSchedule extends ReleasesRepository {
  ran = 0;
  constructor(
    db: TestNextly["adapter"],
    private readonly before: () => Promise<unknown>
  ) {
    super(db);
  }
  override async scheduleRelease(
    ...args: Parameters<ReleasesRepository["scheduleRelease"]>
  ): Promise<boolean> {
    this.ran += 1;
    await this.before();
    return super.scheduleRelease(...args);
  }
}

/** Runs `before` once, immediately before the removal's own write. */
class InterleavedRemoval extends ReleasesRepository {
  ran = 0;
  constructor(
    db: TestNextly["adapter"],
    private readonly before: () => Promise<unknown>
  ) {
    super(db);
  }
  override async removeMember(
    ...args: Parameters<ReleasesRepository["removeMember"]>
  ): ReturnType<ReleasesRepository["removeMember"]> {
    this.ran += 1;
    await this.before();
    return super.removeMember(...args);
  }
}

async function readRelease(repo: ReleasesRepository, id: string) {
  const [row] = await repo.findReleases({ ids: [id] });
  if (row === undefined) throw new Error("the release is gone");
  return row;
}

describe.each(getConfiguredTestDialects())(
  "a release's revision fences its schedule (%s)",
  dialect => {
    it("refuses a schedule when the only member is removed after the check", async () => {
      const t = await boot(dialect);
      const { releaseId, memberId } = await singleWithOneMember(t);
      // The removal commits AFTER the service has read the release and seen
      // its one member, and BEFORE the schedule writes.
      const repo = new InterleavedSchedule(t.adapter, () =>
        t.nextly.releases.removeMember({ memberId, releaseId })
      );

      await expect(
        serviceOver(repo).schedule(releaseId, FUTURE, "UTC", TRUSTED)
      ).rejects.toMatchObject({ code: "CONFLICT" });

      // Positive control: the interleaving happened, so the refusal above is
      // the fence and not the membership check seeing an empty release.
      expect(repo.ran).toBe(1);
      expect(await repo.listMembers(releaseId)).toHaveLength(0);
      const row = await readRelease(repo, releaseId);
      expect(row.state).toBe("draft");
      expect(row.scheduledAt).toBeNull();
    });

    it("refuses a removal judged against a draft once the release is scheduled", async () => {
      const t = await boot(dialect);
      const { releaseId, memberId } = await singleWithOneMember(t);
      // The schedule commits AFTER the service has judged the release a draft,
      // and BEFORE the removal writes.
      const repo = new InterleavedRemoval(t.adapter, () =>
        t.nextly.releases.schedule({
          id: releaseId,
          at: FUTURE,
          timezone: "UTC",
        })
      );

      await expect(
        serviceOver(repo).removeMember(memberId, TRUSTED, releaseId)
      ).rejects.toMatchObject({ code: "CONFLICT" });

      expect(repo.ran).toBe(1);
      const members = await repo.listMembers(releaseId);
      expect(members.map(member => member.id)).toEqual([memberId]);
      expect((await readRelease(repo, releaseId)).state).toBe("scheduled");
    });

    it("refuses removing the member of a scheduled single release, and keeps it", async () => {
      const t = await boot(dialect);
      const { releaseId, memberId } = await singleWithOneMember(t);
      await t.nextly.releases.schedule({
        id: releaseId,
        at: FUTURE,
        timezone: "UTC",
      });

      await expect(
        t.nextly.releases.removeMember({ memberId, releaseId })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const repo = new ReleasesRepository(t.adapter);
      expect(
        (await repo.listMembers(releaseId)).map(member => member.id)
      ).toEqual([memberId]);
    });

    it("bumps the revision on every membership change and every schedule", async () => {
      const t = await boot(dialect);
      const repo = new ReleasesRepository(t.adapter);
      const release = await repo.createRelease({ title: "Spring" });
      expect(release.revision).toBe(0);

      const member = await repo.addMember(
        {
          releaseId: release.id,
          scopeKind: "collection",
          scopeSlug: "posts",
          entryId: await post(t, "one"),
          locale: null,
          action: "publish",
        },
        RELEASE_ASSEMBLABLE_FROM
      );
      expect((await readRelease(repo, release.id)).revision).toBe(1);

      await repo.removeMember(member, RELEASE_ASSEMBLABLE_FROM);
      expect(await repo.listMembers(release.id)).toHaveLength(0);
      expect((await readRelease(repo, release.id)).revision).toBe(2);

      // A schedule against the revision read before the removal misses, and
      // changes nothing.
      expect(
        await repo.scheduleRelease(
          release.id,
          FUTURE,
          "UTC",
          RELEASE_SCHEDULABLE_FROM,
          1
        )
      ).toBe(false);
      const stale = await readRelease(repo, release.id);
      expect(stale.state).toBe("draft");
      expect(stale.revision).toBe(2);

      expect(
        await repo.scheduleRelease(
          release.id,
          FUTURE,
          "UTC",
          RELEASE_SCHEDULABLE_FROM,
          2
        )
      ).toBe(true);
      const scheduled = await readRelease(repo, release.id);
      expect(scheduled.state).toBe("scheduled");
      expect(scheduled.revision).toBe(3);
    });

    it("refuses a member, writing nothing, when the release is outside the states allowed", async () => {
      const t = await boot(dialect);
      const repo = new ReleasesRepository(t.adapter);
      const release = await repo.createRelease({ title: "Spring" });
      await repo.scheduleRelease(
        release.id,
        FUTURE,
        "UTC",
        RELEASE_SCHEDULABLE_FROM,
        0
      );

      const entryId = await post(t, "late");
      await expect(
        repo.addMember(
          {
            releaseId: release.id,
            scopeKind: "collection",
            scopeSlug: "posts",
            entryId,
            locale: null,
            action: "publish",
          },
          RELEASE_ASSEMBLABLE_FROM
        )
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await repo.listMembers(release.id)).toHaveLength(0);
      expect((await readRelease(repo, release.id)).revision).toBe(1);
    });

    it("refuses a schedule when the release is cancelled after the check, and it stays cancelled", async () => {
      // `cancelled` is a state a schedule may leave, so the state fence alone
      // would put back a launch somebody called off after the schedule read
      // it. The cancel moves the revision, and the schedule misses on that.
      const t = await boot(dialect);
      const release = await t.nextly.releases.create({ title: "Spring" });
      const repo = new InterleavedSchedule(t.adapter, () =>
        t.nextly.releases.cancel({ id: release.id })
      );

      await expect(
        serviceOver(repo).schedule(release.id, FUTURE, "UTC", TRUSTED)
      ).rejects.toMatchObject({ code: "CONFLICT" });

      expect(repo.ran).toBe(1);
      const row = await readRelease(repo, release.id);
      expect(row.state).toBe("cancelled");
      expect(row.scheduledAt).toBeNull();
    });

    it("bumps the revision when a release is cancelled, and not when a cancel is refused", async () => {
      const t = await boot(dialect);
      const repo = new ReleasesRepository(t.adapter);
      const release = await repo.createRelease({ title: "Spring" });

      expect(await repo.cancelRelease(release.id)).toBe(true);
      const cancelled = await readRelease(repo, release.id);
      expect(cancelled.state).toBe("cancelled");
      expect(cancelled.revision).toBe(1);

      // Already cancelled, so outside the states a cancel may leave.
      expect(await repo.cancelRelease(release.id)).toBe(false);
      expect((await readRelease(repo, release.id)).revision).toBe(1);
    });

    it("bumps the revision when the drain blocks a release", async () => {
      const t = await boot(dialect);
      const repo = new ReleasesRepository(t.adapter);
      const release = await repo.createRelease({ title: "Spring" });
      await repo.scheduleRelease(
        release.id,
        PAST,
        "UTC",
        RELEASE_SCHEDULABLE_FROM,
        0
      );
      // The instant as stored, which is what the drain plans against.
      const scheduled = await readRelease(repo, release.id);
      if (scheduled.scheduledAt === null) throw new Error("not scheduled");

      expect(
        await repo.blockReleases([
          { id: release.id, scheduledAt: scheduled.scheduledAt },
        ])
      ).toEqual([release.id]);
      const blocked = await readRelease(repo, release.id);
      expect(blocked.state).toBe("blocked");
      expect(blocked.revision).toBe(2);
    });

    it("bumps the revision when the drain publishes a release", async () => {
      const t = await boot(dialect);
      const repo = new ReleasesRepository(t.adapter);
      const release = await repo.createRelease({ title: "Spring" });
      await repo.scheduleRelease(
        release.id,
        PAST,
        "UTC",
        RELEASE_SCHEDULABLE_FROM,
        0
      );

      expect(await repo.markReleasePublished(release.id, new Date())).toBe(
        true
      );
      const published = await readRelease(repo, release.id);
      expect(published.state).toBe("published");
      expect(published.revision).toBe(2);

      // A second pass is refused by the state fence and moves nothing.
      expect(await repo.markReleasePublished(release.id, new Date())).toBe(
        false
      );
      expect((await readRelease(repo, release.id)).revision).toBe(2);
    });
  }
);
