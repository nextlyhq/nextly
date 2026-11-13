/**
 * What each overview address shows for each reader, and the line under its
 * title, decided apart from the page that draws them.
 */
import { describe, expect, it } from "vitest";

import { overviewPlan, overviewSummary } from "../overview-plan";

const BOTH = { collections: true, singles: true };
const SINGLES_ONLY = { collections: false, singles: true };
const COLLECTIONS_ONLY = { collections: true, singles: false };
const NEITHER = { collections: false, singles: false };

describe("overviewPlan", () => {
  it("waits, claiming nothing, until the lists and the answer are in", () => {
    for (const readable of [BOTH, NEITHER, SINGLES_ONLY]) {
      expect(
        overviewPlan({ scope: "collections", settled: false, readable })
      ).toEqual({ kind: "pending" });
    }
  });

  it("shows each kind the reader has at /admin/content", () => {
    expect(
      overviewPlan({ scope: "all", settled: true, readable: BOTH })
    ).toEqual({ kind: "tables", collections: true, singles: true });
    expect(
      overviewPlan({ scope: "all", settled: true, readable: SINGLES_ONLY })
    ).toEqual({ kind: "tables", collections: false, singles: true });
  });

  it("shows one kind's table at its own address", () => {
    expect(
      overviewPlan({ scope: "collections", settled: true, readable: BOTH })
    ).toEqual({ kind: "tables", collections: true, singles: false });
    expect(
      overviewPlan({ scope: "singles", settled: true, readable: BOTH })
    ).toEqual({ kind: "tables", collections: false, singles: true });
  });

  it("sends a reader of the other kind alone to that kind's address", () => {
    expect(
      overviewPlan({
        scope: "collections",
        settled: true,
        readable: SINGLES_ONLY,
      })
    ).toEqual({ kind: "redirect", to: "/admin/singles" });
    expect(
      overviewPlan({
        scope: "singles",
        settled: true,
        readable: COLLECTIONS_ONLY,
      })
    ).toEqual({ kind: "redirect", to: "/admin/collections" });
  });

  it("redirects a reader with neither nowhere", () => {
    for (const scope of ["all", "collections", "singles"] as const) {
      expect(overviewPlan({ scope, settled: true, readable: NEITHER })).toEqual(
        {
          kind: "empty",
        }
      );
    }
  });
});

describe("overviewSummary", () => {
  it("counts each kind, in the singular for one, and says what the page is for", () => {
    expect(overviewSummary({ scope: "all", collections: 1, singles: 1 })).toBe(
      "1 collection · 1 Single. Everything editors write lives here."
    );
    expect(
      overviewSummary({ scope: "collections", collections: 8, singles: 5 })
    ).toBe("8 collections · 5 Singles");
    // A kind the reader has none of is not counted.
    expect(
      overviewSummary({ scope: "singles", collections: 0, singles: 5 })
    ).toBe("5 Singles");
  });
});
