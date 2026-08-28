/**
 * The seam a read path uses to ask what a due release reveals.
 *
 * @module domains/releases/__tests__/release-visibility.test
 */
import { describe, expect, it, vi } from "vitest";

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
    const findDuePublishTargets = vi.fn(async () => ["e1"]);
    const visibility = createReleaseVisibility({
      cache: { mayHaveDue: async () => false },
      repository: { findDuePublishTargets },
    });

    expect(await visibility.revealIds(QUERY)).toEqual([]);
    expect(findDuePublishTargets).not.toHaveBeenCalled();
  });

  it("asks, and answers, once something IS due", async () => {
    // The control for the case above: a seam that never queried would satisfy
    // it while making the whole read path inert.
    const findDuePublishTargets = vi.fn(async () => ["e1", "e2"]);
    const visibility = createReleaseVisibility({
      cache: { mayHaveDue: async () => true },
      repository: { findDuePublishTargets },
    });

    expect(await visibility.revealIds(QUERY)).toEqual(["e1", "e2"]);
    expect(findDuePublishTargets).toHaveBeenCalledWith(QUERY);
  });
});

describe("NO_RELEASE_VISIBILITY", () => {
  it("answers nothing, so a runtime without releases needs no special case", async () => {
    expect(await NO_RELEASE_VISIBILITY.revealIds(QUERY)).toEqual([]);
  });
});
