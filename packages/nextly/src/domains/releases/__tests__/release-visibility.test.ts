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

describe("createReleaseVisibility with a hold on going live", () => {
  it("leaves out a document it would reveal that is held back, and asks only about those", async () => {
    // A reader in the window between a release's moment and its run must not be shown what the
    // run will refuse to publish.
    const held = vi.fn(
      async (documents: readonly { id: string; entryId: string }[]) =>
        new Set(
          documents.filter(d => d.entryId === "e2").map(document => document.id)
        )
    );
    const visibility = createReleaseVisibility({
      cache: { mayHaveDue: async () => true },
      repository: {
        findDueDecisions: async () => ({ reveal: ["e1", "e2"], hide: ["e3"] }),
      },
      hold: () => ({ held }),
    });

    expect(await visibility.decisions(QUERY)).toEqual({
      reveal: ["e1"],
      hide: ["e3"],
    });
    expect(held.mock.calls.map(call => call[0].map(d => d.entryId))).toEqual([
      ["e1", "e2"],
    ]);
  });

  it("never asks while nothing would be revealed, so a takedown is never held", async () => {
    const held = vi.fn(async () => new Set(["e3"]));
    const visibility = createReleaseVisibility({
      cache: { mayHaveDue: async () => true },
      repository: {
        findDueDecisions: async () => ({ reveal: [], hide: ["e3"] }),
      },
      hold: () => ({ held }),
    });

    expect(await visibility.decisions(QUERY)).toEqual({
      reveal: [],
      hide: ["e3"],
    });
    expect(held).not.toHaveBeenCalled();
  });
});

describe("NO_RELEASE_VISIBILITY", () => {
  it("answers nothing, so a runtime without releases needs no special case", async () => {
    expect(await NO_RELEASE_VISIBILITY.decisions(QUERY)).toEqual(NO_DECISIONS);
  });
});
