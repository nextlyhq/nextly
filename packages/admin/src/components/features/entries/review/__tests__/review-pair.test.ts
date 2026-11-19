/**
 * How a reviewer's comparison is found: the part's own newest saved version,
 * against its last approval, else against what the server resolves as
 * published in the part.
 */
import { describe, expect, it } from "vitest";

import type { VersionMeta } from "@admin/services/versionApi";

import { reviewPlan } from "../review-pair";

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
  it("compares the newest version with the last approval", () => {
    const versions = [
      version(7),
      version(6),
      version(5, { status: "published" }),
    ];
    expect(reviewPlan(versions, "en", 6)).toEqual({
      kind: "approved",
      from: 6,
      to: 7,
    });
  });

  it("never takes a newer shared-fields row as a language's version under review", () => {
    // A language's list holds the shared fields' versions too.
    const versions = [version(9, { locale: null }), version(7), version(6)];
    expect(reviewPlan(versions, "en", 6)).toEqual({
      kind: "approved",
      from: 6,
      to: 7,
    });
    expect(reviewPlan(versions, "en", null)).toEqual({
      kind: "server",
      baseline: "published",
      to: 7,
      since: "published",
    });
  });

  it("reviews the document's newest version in any language for the shared part", () => {
    // Every language's version carries the shared fields: a localized save
    // newer than any shared-only row is what the shared part shows.
    const versions = [version(9), version(8, { locale: null }), version(7)];
    expect(reviewPlan(versions, null, null)).toEqual({
      kind: "server",
      baseline: "published",
      to: 9,
      since: "published",
    });
    // Its approval may name another language's version: the server pairs it.
    expect(reviewPlan(versions, null, 4)).toEqual({
      kind: "server",
      baseline: "since-approved",
      to: 9,
      since: "approved",
    });
    expect(reviewPlan(versions, null, 9)).toEqual({ kind: "unchanged", to: 9 });
  });

  it("asks the server for what is published where nothing was approved, whatever the page holds", () => {
    // Nothing published on this page: the published version may be past it.
    const versions = [version(7), version(6)];
    expect(reviewPlan(versions, "en", null)).toEqual({
      kind: "server",
      baseline: "published",
      to: 7,
      since: "published",
    });
  });

  it("reviews an autosave's saved version, not the autosave", () => {
    const versions = [
      version(null, { isAutosave: true }),
      version(4),
      version(3, { status: "published" }),
    ];
    expect(reviewPlan(versions, "en", null)).toEqual({
      kind: "server",
      baseline: "published",
      to: 4,
      since: "published",
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
