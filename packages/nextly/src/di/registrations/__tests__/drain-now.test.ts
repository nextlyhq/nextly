/**
 * Publish now's drain runs as the scheduled drain does: on nobody's request.
 *
 * The drain writes each document as its member's author, and the access gate
 * reads the request's pinned scope when a write names none. Run inside an
 * API-key request, the key would be judged in every author's place.
 */
import { describe, expect, it, vi } from "vitest";

import { apiKeyScope } from "../../../auth/authenticated-scope";
import {
  currentCallerScope,
  runWithCallerScope,
} from "../../../auth/caller-scope";
import type { JobRegistry } from "../../../domains/jobs/job-registry";

const { runSweepNow } = vi.hoisted(() => ({
  runSweepNow: vi.fn(async (..._args: unknown[]) => currentCallerScope()),
}));

vi.mock("../../../domains/jobs/jobs-runner", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../domains/jobs/jobs-runner")
  >()),
  runSweepNow,
}));

const { drainNowWith } = await import("../register-releases");

const KEY = apiKeyScope([
  {
    slug: "publish-content-releases",
    action: "publish",
    resource: "content-releases",
  },
]);

describe("Publish now's drain", () => {
  it("runs outside the scope of the request that asked for it", async () => {
    const drain = drainNowWith(
      {} as Parameters<typeof drainNowWith>[0],
      {} as JobRegistry
    );
    let pinned: unknown;
    await runWithCallerScope(KEY, async () => {
      // The control: the request's scope IS pinned around the call.
      pinned = currentCallerScope();
      await drain({ maxDurationMs: 1000 });
    });

    expect(pinned).toBe(KEY);
    expect(runSweepNow).toHaveBeenCalledTimes(1);
    expect(await runSweepNow.mock.results[0]?.value).toBeUndefined();
  });

  it("runs nothing without a job registry", async () => {
    runSweepNow.mockClear();
    await drainNowWith(
      {} as Parameters<typeof drainNowWith>[0],
      undefined
    )({ maxDurationMs: 1000 });
    expect(runSweepNow).not.toHaveBeenCalled();
  });
});
