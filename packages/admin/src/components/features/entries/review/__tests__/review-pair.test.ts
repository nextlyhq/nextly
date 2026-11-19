/**
 * How a reviewer's comparison is found: the part's own newest saved version,
 * against its last approval, else against what the server resolves as
 * published in the part.
 */
import { describe, expect, it } from "vitest";

import type { VersionMeta } from "@admin/services/versionApi";

import { reviewPlan, sharedReviewPlan } from "../review-pair";

/** A version, newest-first lists name only what each case changes. */
function version(
  versionNo: number | null,
  over: Partial<VersionMeta> = {}
): VersionMeta {
  return {
    id: `v${versionNo}`,
    versionNo,
    status: "draft",
    isAutosave: false,
    label: null,
    locale: "en",
    sourceVersionNo: null,
    createdBy: null,
    author: null,
    createdAt: "2026-11-19T09:00:00.000Z",
    updatedAt: "2026-11-19T09:00:00.000Z",
    ...over,
  };
}

describe("reviewPlan", () => {
  it("asks the server for the comparison of the part's newest version", () => {
    const versions = [
      version(7),
      version(6),
      version(5, { status: "published" }),
    ];
    expect(reviewPlan(versions, "en", 6)).toEqual({ kind: "server", to: 7 });
    // With no approval in the review state too: the server keeps the last one
    // an edit withdrew, and answers with what is published where none was.
    expect(reviewPlan(versions, "en", null)).toEqual({
      kind: "server",
      to: 7,
    });
  });

  it("never takes a newer shared-fields row as a language's version under review", () => {
    // A language's list holds the shared fields' versions too.
    const versions = [version(9, { locale: null }), version(7), version(6)];
    expect(reviewPlan(versions, "en", 6)).toEqual({ kind: "server", to: 7 });
  });

  it("reviews an autosave's saved version, not the autosave", () => {
    const versions = [
      version(null, { isAutosave: true }),
      version(4),
      version(3, { status: "published" }),
    ];
    expect(reviewPlan(versions, "en", null)).toEqual({
      kind: "server",
      to: 4,
    });
  });

  it("says nothing changed where the newest version is the one approved", () => {
    expect(reviewPlan([version(4)], "en", 4)).toEqual({
      kind: "unchanged",
      to: 4,
    });
  });

  it("has nothing to review before a version is saved", () => {
    expect(reviewPlan([], "en", null)).toEqual({ kind: "none" });
  });
});

describe("sharedReviewPlan", () => {
  it("asks the server for the comparison of the version the review state names", () => {
    expect(sharedReviewPlan(11, 7)).toEqual({ kind: "server", to: 11 });
    expect(sharedReviewPlan(11, null)).toEqual({ kind: "server", to: 11 });
  });

  it("says nothing changed where the version under review is the one approved", () => {
    expect(sharedReviewPlan(7, 7)).toEqual({ kind: "unchanged", to: 7 });
  });

  it("has nothing to review before a version is saved", () => {
    expect(sharedReviewPlan(null, null)).toEqual({ kind: "none" });
  });
});
