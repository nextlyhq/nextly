/**
 * The jobs DI registration.
 *
 * Two things are asserted here that nothing else can see. The first is that
 * `releases:drain` is actually REGISTERED — before this registration existed,
 * `createReleasesDrainJob` was exported and constructed by nothing, so the job
 * type was defined and unrunnable, and a queued row for it would be deferred on
 * every pass forever while the queue looked simply empty. A test that asserts
 * the definition exists passes in exactly that broken state; only the registry
 * lookup tells the two apart.
 *
 * The second is that the reporter reports. `createReleasesDrainJob` demands
 * `onOutcome` rather than defaulting it, because a pass can fail individual
 * members while the job row completes successfully, and a no-op there would
 * leave a release that never publishes with no trace anywhere.
 */

import { describe, expect, it, vi } from "vitest";

import type { ApplyDueReleasesResult } from "../../domains/releases/apply-due-releases";
import type { JobRegistry } from "../../domains/jobs/job-registry";
import { RELEASES_DRAIN_JOB } from "../../domains/releases/releases-drain-job";
import type { Logger } from "../../shared/types";

import { reportReleasesOutcome } from "../registrations/register-jobs";

function logger(): Logger & { error: ReturnType<typeof vi.fn> } {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger & { error: ReturnType<typeof vi.fn> };
}

function failedMember(releaseId: string, memberId: string) {
  return {
    ref: {
      scopeKind: "collection" as const,
      scopeSlug: "posts",
      entryId: `entry-${memberId}`,
      locale: null,
    },
    memberId,
    releaseId,
    effect: "publish" as const,
    failure: "author-unresolvable" as unknown as never,
    detail: "the author no longer exists",
  };
}

function result(
  over: Partial<ApplyDueReleasesResult> = {}
): ApplyDueReleasesResult {
  return {
    due: 1,
    published: 1,
    applied: 1,
    failed: 0,
    outcomes: [],
    ...over,
  } as ApplyDueReleasesResult;
}

describe("the registered job types", () => {
  it("registers releases:drain, so a queued release drain can actually run", async () => {
    // The REAL JobRegistry, and the assertion is a lookup by slug — the same
    // call the runner makes. Asserting that `register` was invoked would pass
    // against a registry that then failed to hold the definition, and "the
    // runner can find it" is the property that matters.
    const singletons = new Map<string, unknown>();

    vi.resetModules();
    vi.doMock("../container", () => ({
      container: {
        registerSingleton: (name: string, factory: () => unknown) => {
          singletons.set(name, factory());
        },
      },
    }));

    const { registerJobServices } = await import(
      "../registrations/register-jobs"
    );
    registerJobServices({
      adapter: { select: async () => [] },
      logger: logger(),
    } as never);

    const registry = singletons.get("jobRegistry") as JobRegistry;
    expect(registry.get(RELEASES_DRAIN_JOB)).toBeDefined();

    // And registered as a SWEEP. Being in the registry only means the runner
    // can find the handler; a release comes due at an instant with no request
    // attached, so unless a trigger keeps one queued there is never a row to
    // find. Registered-but-not-a-sweep is the same silent failure as
    // defined-but-not-registered, one layer along.
    expect(registry.sweeps().map(d => d.slug)).toContain(RELEASES_DRAIN_JOB);

    vi.doUnmock("../container");
    vi.resetModules();
  });

  it("registers a repository, so something can enqueue work", async () => {
    const singletons = new Map<string, unknown>();

    vi.resetModules();
    vi.doMock("../container", () => ({
      container: {
        registerSingleton: (name: string, factory: () => unknown) => {
          singletons.set(name, factory());
        },
      },
    }));

    const { registerJobServices } = await import(
      "../registrations/register-jobs"
    );
    // Imported INSIDE the reset module graph. `vi.resetModules()` gives the
    // dynamic import a fresh copy of every module, so a statically imported
    // class is a different class here and `instanceof` compares across two
    // graphs rather than testing anything.
    const { JobsRepository } = await import(
      "../../domains/jobs/jobs-repository"
    );
    registerJobServices({
      adapter: { select: async () => [] },
      logger: logger(),
    } as never);

    expect(singletons.get("jobsRepository")).toBeInstanceOf(JobsRepository);

    vi.doUnmock("../container");
    vi.resetModules();
  });
});

describe("reportReleasesOutcome", () => {
  it("reports each failed member individually, not just a count", async () => {
    // "3 failed" says something is wrong; the document and the reason are what
    // let an operator fix it. A release stuck on one deactivated author is
    // indistinguishable from three unrelated problems until you can see which.
    const log = logger();

    reportReleasesOutcome(
      log,
      result({
        failed: 2,
        outcomes: [failedMember("r1", "m1"), failedMember("r1", "m2")],
      })
    );

    expect(log.error).toHaveBeenCalledTimes(2);
    const reported = log.error.mock.calls.map(
      call => (call[1] as { memberId: string }).memberId
    );
    expect(reported).toEqual(["m1", "m2"]);
  });

  it("reports a member failure even when the pass otherwise succeeded", async () => {
    // The exact case that makes `onOutcome` required: the job row completes,
    // so nothing upstream treats this as a failure at all.
    const log = logger();

    reportReleasesOutcome(
      log,
      result({ applied: 5, failed: 1, outcomes: [failedMember("r1", "m9")] })
    );

    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it("says nothing when no release was due", async () => {
    // A sweep runs on an interval and is silent by design; a line per tick
    // would bury the pass that mattered.
    const log = logger();

    reportReleasesOutcome(log, result({ due: 0, published: 0, applied: 0 }));

    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });
});
