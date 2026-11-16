/**
 * The release engine's run stops the scheduled releases holding a document of
 * an entity removed from code: which entities it finds removed, what it hands
 * the early stop, and where in the pass it does so.
 *
 * The decision itself (`isRemovedFromCode`) is the write guard's and has its
 * own tests; the end-to-end stop, its owner's notice and the release's state
 * are proven on every dialect by `release-removed-entity.integration.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { container } from "../../../di/container";
import { publishDeclaredEntities } from "../../dynamic-collections/services/removed-from-code-writes";
import type { ReleaseCheckScope } from "../readiness/check-sources";
import type { ReleaseRecheckTarget } from "../release-recheck";

const { applyMock, stopRemovedMock, order } = vi.hoisted(() => ({
  applyMock: vi.fn(),
  stopRemovedMock: vi.fn(),
  order: [] as string[],
}));

const { removedEntityScopes, stopReleasesOfRemovedEntities } = await import(
  "../removed-entity-releases"
);

/** Register `service` under `name` for one case; each case starts empty. */
function register(name: string, service: unknown): void {
  container.register(name, () => service);
}

afterEach(() => {
  container.clear();
  publishDeclaredEntities(undefined);
});

describe("removedEntityScopes", () => {
  /** The registries: the app's code, the Schema Builder and a plugin. */
  function registries(): void {
    register("collectionRegistryService", {
      getAllCollectionsForRead: async () => [
        { slug: "posts", source: "code" },
        { slug: "old-posts", source: "code" },
        { slug: "landing", source: "ui" },
        { slug: "orders", source: "plugin" },
      ],
    });
    register("singleRegistryService", {
      getAllSinglesForRead: async () => [
        { slug: "header", source: "code" },
        { slug: "banner", source: "code" },
      ],
    });
  }

  it("names the code entities the configuration no longer declares, and no other", async () => {
    registries();
    publishDeclaredEntities({
      collections: [{ slug: "posts" }],
      singles: [{ slug: "header" }],
    });
    expect(await removedEntityScopes()).toEqual([
      { scopeKind: "collection", scopeSlug: "old-posts" },
      { scopeKind: "single", scopeSlug: "banner" },
    ]);
  });

  it("names none while no configuration is published, as the write guard reads it", async () => {
    registries();
    expect(await removedEntityScopes()).toEqual([]);
  });
});

describe("stopReleasesOfRemovedEntities", () => {
  const removed: ReleaseCheckScope[] = [
    { scopeKind: "collection", scopeSlug: "old-posts" },
    { scopeKind: "single", scopeSlug: "banner" },
  ];

  it("hands the early stop exactly the removed entities, and the caller's deadline", async () => {
    const stop = vi.fn(
      async (_target: ReleaseRecheckTarget, _options: unknown) => {}
    );
    const outOfTime = () => false;
    await stopReleasesOfRemovedEntities({
      removedScopes: async () => removed,
      stop,
      outOfTime,
    });
    expect(stop.mock.calls).toEqual([[{ scopes: removed }, { outOfTime }]]);
  });

  it("asks nothing of the early stop when none is removed", async () => {
    const stop = vi.fn(
      async (_target: ReleaseRecheckTarget, _options: unknown) => {}
    );
    await stopReleasesOfRemovedEntities({
      removedScopes: async () => [],
      stop,
    });
    expect(stop).not.toHaveBeenCalled();
  });

  it("lets a stop that failed reach its caller, rather than logging it as an event's", async () => {
    register("releasesService", {
      stopOnHardProblems: async () => {
        throw new Error("connection reset");
      },
    });
    await expect(
      stopReleasesOfRemovedEntities({ removedScopes: async () => removed })
    ).rejects.toThrow("connection reset");
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
  async function drainJob(
    now = new Date("2026-06-01T12:00:00.000Z"),
    msLeftInPass = 10_000
  ) {
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
    await job.handler(null as never, {
      jobId: "releases-drain-1",
      attempt: 1,
      user: null,
      now,
      content: {} as never,
      deadline: new Date(now.getTime() + msLeftInPass),
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

  it("gives the stop half of what is left of the pass, on the pass's own clock", async () => {
    vi.useFakeTimers();
    try {
      // The runner's clock is years from wall time, as `runJobs` may give it:
      // the budget must be measured on the pass's clock, not on wall time.
      vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
      let outOfTime: (() => boolean) | undefined;
      stopRemovedMock.mockImplementation(
        async (options: { outOfTime?: () => boolean }) => {
          outOfTime = options.outOfTime;
        }
      );
      await drainJob(new Date("2020-01-01T00:00:00.000Z"), 8_000);
      if (outOfTime === undefined) throw new Error("no deadline was given");
      expect(outOfTime()).toBe(false);
      vi.advanceTimersByTime(3_999);
      expect(outOfTime()).toBe(false);
      vi.advanceTimersByTime(1);
      expect(outOfTime()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
