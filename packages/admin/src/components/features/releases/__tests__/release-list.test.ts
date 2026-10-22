/**
 * The release list's wording rules: where a row says it stands, what it says
 * a release does, and how it counts ready documents.
 *
 * @module components/features/releases/__tests__/release-list.test
 */
import { describe, expect, it } from "vitest";

import {
  describeDocuments,
  describeMemberActions,
  describeNeedFix,
  describeReadiness,
  releaseOwnerView,
  releaseRowStatus,
  releaseWhenInstant,
  summariseReadiness,
} from "../release-list";

const finding = (memberId: string) => ({
  memberId,
  code: "REQUIRED_FIELD_MISSING",
  source: "core.fields",
  action: "publish" as const,
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: memberId,
});

describe("releaseRowStatus", () => {
  it("calls a scheduled release overdue only where the server listed it as needing attention", () => {
    expect(releaseRowStatus({ state: "scheduled" }, "upcoming")).toBe(
      "scheduled"
    );
    expect(releaseRowStatus({ state: "scheduled" }, "attention")).toBe(
      "overdue"
    );
  });

  it("says a blocked release stopped", () => {
    expect(releaseRowStatus({ state: "blocked" }, "attention")).toBe("stopped");
  });

  it("keeps the engine's other states as they are", () => {
    expect(releaseRowStatus({ state: "draft" }, "drafts")).toBe("draft");
    expect(releaseRowStatus({ state: "published" }, "done")).toBe("published");
    expect(releaseRowStatus({ state: "cancelled" }, "done")).toBe("cancelled");
  });
});

describe("releaseWhenInstant", () => {
  const release = {
    state: "published" as const,
    scheduledAt: "2026-10-01T09:00:00.000Z",
    publishedAt: "2026-10-01T09:02:00.000Z",
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: "2026-10-01T09:02:30.000Z",
  };

  it("shows each tab's own instant", () => {
    expect(releaseWhenInstant(release, "upcoming")).toBe(release.scheduledAt);
    expect(releaseWhenInstant(release, "attention")).toBe(release.scheduledAt);
    expect(releaseWhenInstant(release, "drafts")).toBe(release.createdAt);
    // When it went out, which can be after its instant if the runner was late.
    expect(releaseWhenInstant(release, "done")).toBe(release.publishedAt);
  });

  it("dates a cancelled release by when it was called off", () => {
    expect(releaseWhenInstant({ ...release, state: "cancelled" }, "done")).toBe(
      release.updatedAt
    );
  });
});

describe("describeMemberActions", () => {
  it("says what goes live and what comes down, with agreement", () => {
    expect(describeMemberActions({ goLive: 5, comeDown: 1 }, "ahead")).toBe(
      "5 go live, 1 comes down"
    );
    expect(describeMemberActions({ goLive: 1, comeDown: 0 }, "ahead")).toBe(
      "1 goes live"
    );
  });

  it("describes a release that only takes documents down without mentioning going live", () => {
    expect(describeMemberActions({ goLive: 0, comeDown: 2 }, "ahead")).toBe(
      "2 come down"
    );
  });

  it("puts a release that ran in the past tense", () => {
    expect(describeMemberActions({ goLive: 3, comeDown: 1 }, "ran")).toBe(
      "3 went live, 1 came down"
    );
  });
});

describe("describeDocuments", () => {
  it("reads the action straight on from the count when every document does the same thing", () => {
    expect(describeDocuments({ goLive: 3, comeDown: 0 }, "ahead")).toEqual({
      count: "3 documents",
      tail: " go live",
    });
    expect(describeDocuments({ goLive: 1, comeDown: 0 }, "ahead")).toEqual({
      count: "1 document",
      tail: " goes live",
    });
    expect(describeDocuments({ goLive: 0, comeDown: 2 }, "ran")).toEqual({
      count: "2 documents",
      tail: " came down",
    });
  });

  it("breaks a mixed release down", () => {
    expect(describeDocuments({ goLive: 5, comeDown: 1 }, "ahead")).toEqual({
      count: "6 documents",
      tail: " · 5 go live, 1 comes down",
    });
  });
});

describe("summariseReadiness", () => {
  it("counts documents, not findings: one document with two problems is one to fix", () => {
    const summary = summariseReadiness(6, {
      hard: [finding("m1"), finding("m1")],
    });
    expect(summary).toEqual({ total: 6, ready: 5, needFix: 1 });
    expect(describeReadiness(summary)).toBe("5 of 6 ready");
    expect(describeNeedFix(summary.needFix)).toBe("1 needs a fix");
  });

  it("counts documents the reader cannot view among those to fix", () => {
    // Four documents, one visible one and one hidden one with a hard problem:
    // the bar must not read "3 of 4" because the reader is missing one.
    const summary = summariseReadiness(4, {
      hard: [finding("m1")],
      hidden: [
        {
          scopeKind: "collection",
          scopeSlug: "secrets",
          count: 2,
          hard: 1,
          soft: 0,
        },
      ],
    });
    expect(summary).toEqual({ total: 4, ready: 2, needFix: 2 });
  });

  it("calls a release with no hard problems ready", () => {
    expect(describeReadiness(summariseReadiness(3, { hard: [] }))).toBe(
      "All 3 ready"
    );
    expect(describeReadiness(summariseReadiness(1, { hard: [] }))).toBe(
      "Ready"
    );
  });

  it("never counts more documents to fix than the release holds", () => {
    const summary = summariseReadiness(1, {
      hard: [finding("m1"), finding("m2")],
    });
    expect(summary).toEqual({ total: 1, ready: 0, needFix: 1 });
  });
});

describe("releaseOwnerView", () => {
  const me = { id: "u-me", name: "Mobeen Abdullah" };

  it("calls the reader's own release theirs, from the session", () => {
    expect(
      releaseOwnerView({ createdBy: "u-me", owner: null, me })
    ).toMatchObject({ kind: "known", label: "You" });
  });

  it("names another owner by the name the list sent", () => {
    expect(
      releaseOwnerView({
        createdBy: "u-a",
        owner: { id: "u-a", name: "Aqib" },
        me,
      })
    ).toEqual({ kind: "known", label: "Aqib", name: "Aqib" });
  });

  it("labels an owner who cannot be named as an owner, in its own words", () => {
    // Recorded but gone (deleted or erased), or nameless: unavailable.
    expect(releaseOwnerView({ createdBy: "u-gone", owner: null, me })).toEqual({
      kind: "unnamed",
      label: "Owner unavailable",
    });
    expect(
      releaseOwnerView({
        createdBy: "u-a",
        owner: { id: "u-a", name: null },
        me,
      })
    ).toEqual({ kind: "unnamed", label: "Owner unavailable" });
    // Nothing recorded at all.
    expect(releaseOwnerView({ createdBy: null, owner: null, me })).toEqual({
      kind: "unnamed",
      label: "Owner not recorded",
    });
  });
});
