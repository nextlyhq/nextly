/**
 * The removal job's pass: it carries removals on and deletes what they took
 * out once past the window an undo has, the purge running whether or not the
 * walk does.
 *
 * @module breakpoint-removal/job.test
 */
import { describe, expect, it, vi } from "vitest";

import { FRAGMENTS_KEPT_DAYS } from "./fragments";
import { breakpointRemovalJob } from "./job";

/** One pass, as the jobs runner runs it. */
function pass(service: {
  carryOn: () => Promise<void>;
  purgeFragments: (before: Date) => Promise<void>;
}) {
  const job = breakpointRemovalJob(() => service);
  return job.handler(
    null as never,
    { deadline: new Date(Date.now() + 60_000) } as never
  );
}

describe("the removal job's pass", () => {
  it("deletes what removals took out past the window, after carrying them on", async () => {
    const order: string[] = [];
    const purgeFragments = vi.fn(async () => {
      order.push("purge");
    });
    await pass({
      carryOn: async () => {
        order.push("walk");
      },
      purgeFragments,
    });
    expect(order).toEqual(["walk", "purge"]);
    const before = purgeFragments.mock.calls[0]?.[0] as Date;
    const days = (Date.now() - before.getTime()) / (24 * 60 * 60 * 1000);
    expect(Math.round(days)).toBe(FRAGMENTS_KEPT_DAYS);
  });

  it("still deletes them when the walk fails, and fails the pass with the walk's error", async () => {
    const purgeFragments = vi.fn(async () => {});
    await expect(
      pass({
        carryOn: async () => {
          throw new Error("a document's hook refused every write");
        },
        purgeFragments,
      })
    ).rejects.toThrow("refused every write");
    expect(purgeFragments).toHaveBeenCalledTimes(1);
  });
});
