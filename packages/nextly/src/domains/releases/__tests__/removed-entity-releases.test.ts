/**
 * The release engine's run stops the scheduled releases holding a document of
 * an entity removed from code: which entities it hands to the early stop, and
 * where in the pass it does so.
 *
 * The decision itself (`entityRemovedFromCode`) is the write guard's and has
 * its own tests; the end-to-end stop, its owner's notice and the release's
 * state are proven on every dialect by
 * `release-removed-entity.integration.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReleaseCheckScope } from "../readiness/check-sources";
import type { ReleaseRecheckTarget } from "../release-recheck";

const { applyMock, stopRemovedMock, order } = vi.hoisted(() => ({
  applyMock: vi.fn(),
  stopRemovedMock: vi.fn(),
  order: [] as string[],
}));

const { stopReleasesOfRemovedEntities } = await import(
  "../removed-entity-releases"
);

describe("stopReleasesOfRemovedEntities", () => {
  const scopes: ReleaseCheckScope[] = [
    { scopeKind: "collection", scopeSlug: "posts" },
    { scopeKind: "collection", scopeSlug: "old-posts" },
    { scopeKind: "single", scopeSlug: "banner" },
    { scopeKind: "page", scopeSlug: "home" },
  ];
  const removed = new Set(["collection:old-posts", "single:banner"]);
  const isRemoved = async (scope: ReleaseCheckScope) =>
    removed.has(`${scope.scopeKind}:${scope.scopeSlug}`);

  it("hands the early stop exactly the removed entities the scheduled releases hold", async () => {
    const stop = vi.fn(async (_target: ReleaseRecheckTarget) => {});
    await stopReleasesOfRemovedEntities({
      repository: { scheduledMemberScopes: async () => scopes },
      isRemoved,
      stop,
    });
    expect(stop.mock.calls).toEqual([
      [
        {
          scopes: [
            { scopeKind: "collection", scopeSlug: "old-posts" },
            { scopeKind: "single", scopeSlug: "banner" },
          ],
        },
      ],
    ]);
  });

  it("stops nothing, and asks nothing of the early stop, when none is removed", async () => {
    const stop = vi.fn(async (_target: ReleaseRecheckTarget) => {});
    await stopReleasesOfRemovedEntities({
      repository: { scheduledMemberScopes: async () => scopes },
      isRemoved: async () => false,
      stop,
    });
    expect(stop).not.toHaveBeenCalled();
  });
});

describe("the releases drain job", () => {
  afterEach(() => {
    vi.doUnmock("../apply-due-releases");
    vi.doUnmock("../removed-entity-releases");
    vi.resetModules();
    applyMock.mockReset();
    stopRemovedMock.mockReset();
    order.length = 0;
  });

  /** The job, with the pass and the stop replaced by recorders. */
  async function drainJob() {
    vi.resetModules();
    vi.doMock("../apply-due-releases", () => ({ applyDueReleases: applyMock }));
    vi.doMock("../removed-entity-releases", () => ({
      stopReleasesOfRemovedEntities: stopRemovedMock,
    }));
    applyMock.mockImplementation(async () => {
      order.push("apply");
      return {
        due: 0,
        published: 0,
        applied: 0,
        failed: 0,
        deferred: 0,
        undischarged: 0,
        outcomes: [],
      };
    });
    const { createReleasesDrainJob } = await import("../releases-drain-job");
    const outcomes: unknown[] = [];
    const job = createReleasesDrainJob({
      db: {} as never,
      contentApi: {} as never,
      runAs: {} as never,
      onOutcome: result => {
        outcomes.push(result);
      },
    });
    const now = new Date("2026-06-01T12:00:00.000Z");
    await job.handler(null as never, {
      jobId: "releases-drain-1",
      attempt: 1,
      user: null,
      now,
      content: {} as never,
      deadline: new Date(now.getTime() + 10_000),
    });
    return { outcomes };
  }

  it("stops releases holding a removed entity's document before it runs anything due", async () => {
    stopRemovedMock.mockImplementation(async () => {
      order.push("stop-removed");
    });
    await drainJob();
    expect(order).toEqual(["stop-removed", "apply"]);
  });

  it("still runs what is due when that stop fails", async () => {
    stopRemovedMock.mockImplementation(async () => {
      order.push("stop-removed");
      throw new Error("connection reset");
    });
    const { outcomes } = await drainJob();
    expect(order).toEqual(["stop-removed", "apply"]);
    expect(outcomes).toHaveLength(1);
  });
});
