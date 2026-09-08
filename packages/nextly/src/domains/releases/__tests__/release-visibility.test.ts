/**
 * The seam a read path uses to ask what a due release reveals.
 *
 * @module domains/releases/__tests__/release-visibility.test
 */
import { describe, expect, it, vi } from "vitest";

import { NO_DECISIONS } from "../release-scope";
import {
  NO_RELEASE_VISIBILITY,
  createReleaseVisibility,
} from "../release-visibility";

const QUERY = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  now: new Date("2026-01-01T00:00:00.000Z"),
};

describe("createReleaseVisibility", () => {
  it("does not query at all while nothing is due", async () => {
    // The cheap check is the entire optimisation: every read of every
    // collection on a site that has never scheduled a release must cost one
    // memo read, not a query against the members table.
    const findDueDecisions = vi.fn(async () => ({
      reveal: ["e1"],
      hide: ["e2"],
    }));
    const visibility = createReleaseVisibility({
      cache: { mayHaveDue: async () => false },
      repository: { findDueDecisions },
    });

    expect(await visibility.decisions(QUERY)).toEqual(NO_DECISIONS);
    expect(findDueDecisions).not.toHaveBeenCalled();
  });

  it("asks, and answers, once something IS due", async () => {
    // The control for the case above: a seam that never queried would satisfy
    // it while making the whole read path inert.
    const findDueDecisions = vi.fn(async () => ({
      reveal: ["e1", "e2"],
      hide: ["e3"],
    }));
    const visibility = createReleaseVisibility({
      cache: { mayHaveDue: async () => true },
      repository: { findDueDecisions },
    });

    // BOTH directions reach the caller. A seam that forwarded only `reveal`
    // would satisfy every earlier case here while making a scheduled takedown
    // a no-op.
    expect(await visibility.decisions(QUERY)).toEqual({
      reveal: ["e1", "e2"],
      hide: ["e3"],
    });
    expect(findDueDecisions).toHaveBeenCalledWith(QUERY);
  });
});

describe("NO_RELEASE_VISIBILITY", () => {
  it("answers nothing, so a runtime without releases needs no special case", async () => {
    expect(await NO_RELEASE_VISIBILITY.decisions(QUERY)).toEqual(NO_DECISIONS);
  });
});
