/**
 * The two versions a reviewer compares: the newest saved version, against the
 * last approval, else the last published version.
 */
import { describe, expect, it } from "vitest";

import type { VersionMeta } from "@admin/services/versionApi";

import { reviewPair } from "../review-pair";

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

describe("reviewPair", () => {
  it("compares the newest version with the last approval", () => {
    const versions = [
      version(7),
      version(6),
      version(5, { status: "published" }),
    ];
    expect(reviewPair(versions, 6)).toEqual({
      kind: "pair",
      from: 6,
      to: 7,
      since: "approved",
    });
  });

  it("compares with the last published version where nothing was approved", () => {
    const versions = [
      version(7),
      version(6),
      version(5, { status: "published" }),
    ];
    expect(reviewPair(versions, null)).toEqual({
      kind: "pair",
      from: 5,
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
    expect(reviewPair(versions, null)).toMatchObject({ from: 3, to: 4 });
  });

  it("says all is new where nothing was published or approved", () => {
    expect(reviewPair([version(2), version(1)], null)).toEqual({
      kind: "first",
      to: 2,
    });
  });

  it("says nothing changed where the newest version is the one approved", () => {
    expect(reviewPair([version(4)], 4)).toEqual({ kind: "unchanged", to: 4 });
  });

  it("has nothing to review before a version is saved", () => {
    expect(reviewPair([], null)).toEqual({ kind: "none" });
  });
});
