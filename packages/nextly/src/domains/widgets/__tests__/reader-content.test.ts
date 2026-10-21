/**
 * The content a reader HAS, as the `collections:present` and `singles:present` conditions ask
 * it: the registry's readable listing, less what the dashboard keeps off.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// The shared allowlist is the seam: it is what the list endpoints scope by, and this module
// narrows it. Mocked so the case can put any slugs in reach without the RBAC stack.
const { allowlist } = vi.hoisted(() => ({ allowlist: vi.fn() }));
vi.mock("../../../services/lib/readable-slug-allowlist", () => ({
  readableSlugAllowlist: (caller: unknown, kind: string) =>
    allowlist(caller, kind) as unknown,
}));

import { recordKeptOffDashboard } from "../kept-off-dashboard";
import {
  anyHoldsEntry,
  CONTENT_CHECK_BUDGET_MS,
  readableCollectionSlugs,
  readableSingleSlugs,
} from "../reader-content";

const caller = { user: { id: "admin-1", roles: ["super-admin"] } };

afterEach(() => {
  // The record is process-wide; leave none behind for the next case.
  recordKeptOffDashboard("collection", []);
  recordKeptOffDashboard("single", []);
});

describe("the content a reader has, for offering a content card", () => {
  it("leaves out a collection kept off the dashboard, though the reader may read it", async () => {
    // A super-admin reads everything, the page builder's internal index included. Counted as
    // content, it would offer a card that then leaves it out and draws empty.
    allowlist.mockResolvedValue(["posts", "nx_pb_class_usage"]);
    recordKeptOffDashboard("collection", [
      { slug: "posts" },
      { slug: "nx_pb_class_usage", admin: { hidden: true } },
    ]);

    expect(await readableCollectionSlugs(caller)).toEqual(["posts"]);
  });

  it("leaves out a Single kept off the dashboard, and only from its own kind", async () => {
    // A collection and a Single may share a slug, so a hidden collection named "settings" must
    // not take the Single of that name with it.
    allowlist.mockResolvedValue(["settings", "hidden-single"]);
    recordKeptOffDashboard("single", [
      { slug: "hidden-single", admin: { hidden: true } },
    ]);
    recordKeptOffDashboard("collection", [
      { slug: "settings", admin: { hidden: true } },
    ]);

    expect(await readableSingleSlugs(caller)).toEqual(["settings"]);
  });

  it("keeps everything the reader may read when nothing is kept off", async () => {
    // The control: without a record, the listing is the allowlist unchanged.
    allowlist.mockResolvedValue(["posts", "pages"]);

    expect(await readableCollectionSlugs(caller)).toEqual(["posts", "pages"]);
  });
});

describe("whether any of a reader's collections holds an entry", () => {
  const slugs = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);

  /** A count the test answers by hand, recording how many were in flight at once. */
  function heldCounts() {
    const pending = new Map<string, (total: number) => void>();
    let inFlight = 0;
    let most = 0;
    const asked: string[] = [];
    const count = (slug: string) =>
      new Promise<number>(resolve => {
        asked.push(slug);
        inFlight += 1;
        most = Math.max(most, inFlight);
        pending.set(slug, total => {
          inFlight -= 1;
          resolve(total);
        });
      });
    return {
      count,
      asked,
      most: () => most,
      answer: (slug: string, total: number) => pending.get(slug)?.(total),
      answerEvery: (total: number) => {
        for (const [slug, resolve] of [...pending]) {
          pending.delete(slug);
          resolve(total);
        }
      },
    };
  }

  /** Lets every count settled so far run its continuation. */
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));

  it("counts at most the limit at once, and every collection when all are empty", async () => {
    const counts = heldCounts();
    const answer = anyHoldsEntry(slugs(20), counts.count, 8);

    await settle();
    // The bound, reached and not passed: a sequential walk would show 1, an unbounded one 20.
    expect(counts.most()).toBe(8);
    for (let round = 0; round < 3; round += 1) {
      counts.answerEvery(0);
      await settle();
    }

    expect(await answer).toBe(false);
    expect(counts.asked).toHaveLength(20);
    expect(counts.most()).toBe(8);
  });

  it("answers yes at the first collection holding a row, and starts no count after it", async () => {
    const counts = heldCounts();
    const answer = anyHoldsEntry(slugs(20), counts.count, 8);
    await settle();

    // One of the first round holds a row; the other seven are still counting.
    counts.answer("c3", 1);

    // Answered without waiting for the seven still in flight.
    expect(await answer).toBe(true);
    counts.answerEvery(0);
    await settle();
    expect(counts.asked).toHaveLength(8);
  });

  it('answers "unknown", never "empty", when the budget runs out first', async () => {
    vi.useFakeTimers();
    try {
      const counts = heldCounts();
      const answer = anyHoldsEntry(slugs(3), counts.count);

      await vi.advanceTimersByTimeAsync(CONTENT_CHECK_BUDGET_MS - 1);
      // The must-differ half: inside the budget there is no answer yet.
      let settled: unknown = "pending";
      void answer.then(value => (settled = value));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe("pending");

      await vi.advanceTimersByTimeAsync(1);
      expect(await answer).toBe("unknown");
      // A count that ends after the answer changes nothing, and starts nothing.
      counts.answerEvery(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(counts.asked).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails when a count fails, rather than guess either way", async () => {
    await expect(
      anyHoldsEntry(["a", "b"], async slug => {
        if (slug === "b") throw new Error("count refused");
        return 0;
      })
    ).rejects.toThrow("count refused");
  });

  it("answers no, asking nothing, when there are no collections", async () => {
    const count = vi.fn();
    expect(await anyHoldsEntry([], count)).toBe(false);
    expect(count).not.toHaveBeenCalled();
  });
});
