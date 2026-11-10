/**
 * The cleanup sweep: declared a sweep, so the runner keeps one queued, and
 * handing each pass the runner's own deadline.
 */
import { describe, expect, it } from "vitest";

import type { CleanupBudget } from "./retired-cleanup";
import { RETIRED_CLEANUP_JOB, retiredCleanupJob } from "./retired-cleanup-job";

describe("the cleanup sweep", () => {
  it("is declared a sweep under the plugin's namespace", () => {
    const job = retiredCleanupJob(() => ({
      advance: async () => ({ walked: [], finished: true }),
    }));

    expect({ sweep: job.sweep, slug: job.slug }).toEqual({
      sweep: true,
      slug: RETIRED_CLEANUP_JOB,
    });
    expect(RETIRED_CLEANUP_JOB).toBe("page-builder:retired-cleanup");
  });

  it("walks each pass until the runner's deadline", async () => {
    const budgets: CleanupBudget[] = [];
    const job = retiredCleanupJob(() => ({
      advance: async budget => {
        budgets.push(budget ?? {});
        return { walked: [], finished: true };
      },
    }));
    const deadline = new Date(Date.now() + 5_000);

    await job.handler(null as never, { deadline } as never);

    expect(budgets).toEqual([{ deadline }]);
  });
});
