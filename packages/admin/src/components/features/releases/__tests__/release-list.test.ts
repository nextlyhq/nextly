/**
 * The release list's wording rules: where a row says it stands, what it says
 * a release does, and how it counts ready documents.
 *
 * @module components/features/releases/__tests__/release-list.test
 */
import { describe, expect, it } from "vitest";

import {
  countMemberActions,
  describeDocuments,
  describeMemberActions,
  describeNeedFix,
  describeReadiness,
  ownerIdToLookUp,
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
    expect(describeMemberActions({ publish: 5, unpublish: 1 }, "ahead")).toBe(
      "5 go live, 1 comes down"
    );
    expect(describeMemberActions({ publish: 1, unpublish: 0 }, "ahead")).toBe(
      "1 goes live"
    );
  });

  it("describes a release that only takes documents down without mentioning going live", () => {
    expect(describeMemberActions({ publish: 0, unpublish: 2 }, "ahead")).toBe(
      "2 come down"
    );
  });

  it("puts a release that ran in the past tense", () => {
    expect(describeMemberActions({ publish: 3, unpublish: 1 }, "ran")).toBe(
      "3 went live, 1 came down"
    );
  });

  it("counts members by their action", () => {
    expect(
      countMemberActions([
        { action: "publish" },
        { action: "unpublish" },
        { action: "publish" },
      ])
    ).toEqual({ publish: 2, unpublish: 1 });
  });
});

describe("describeDocuments", () => {
  it("reads the action straight on from the count when every document does the same thing", () => {
    expect(describeDocuments({ publish: 3, unpublish: 0 }, "ahead")).toEqual({
      count: "3 documents",
      tail: " go live",
    });
    expect(describeDocuments({ publish: 1, unpublish: 0 }, "ahead")).toEqual({
      count: "1 document",
      tail: " goes live",
    });
    expect(describeDocuments({ publish: 0, unpublish: 2 }, "ran")).toEqual({
      count: "2 documents",
      tail: " came down",
    });
  });

  it("breaks a mixed release down", () => {
    expect(describeDocuments({ publish: 5, unpublish: 1 }, "ahead")).toEqual({
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
  const idle = { pending: false };

  it("calls the reader's own release theirs, without asking the users list", () => {
    expect(
      releaseOwnerView({
        ownerId: "u-me",
        me,
        canReadUsers: true,
        lookup: idle,
      })
    ).toEqual({ kind: "known", label: "You", name: me.name, image: undefined });
    expect(
      ownerIdToLookUp({ ownerId: "u-me", meId: "u-me", canReadUsers: true })
    ).toBeUndefined();
  });

  it("names another owner only for a reader who may read users", () => {
    const lookup = { pending: false, user: { id: "u-a", name: "Aqib" } };
    expect(
      releaseOwnerView({ ownerId: "u-a", me, canReadUsers: true, lookup })
    ).toMatchObject({ kind: "known", label: "Aqib" });
    expect(
      releaseOwnerView({ ownerId: "u-a", me, canReadUsers: false, lookup })
    ).toEqual({ kind: "unnamed" });
    expect(
      ownerIdToLookUp({ ownerId: "u-a", meId: "u-me", canReadUsers: false })
    ).toBeUndefined();
    expect(
      ownerIdToLookUp({ ownerId: "u-a", meId: "u-me", canReadUsers: true })
    ).toBe("u-a");
  });

  it("waits for the lookup, and says nothing it cannot back", () => {
    expect(
      releaseOwnerView({
        ownerId: "u-a",
        me,
        canReadUsers: true,
        lookup: { pending: true },
      })
    ).toEqual({ kind: "loading" });
    // A deleted user, or one the lookup could not find, is not named.
    expect(
      releaseOwnerView({ ownerId: "u-a", me, canReadUsers: true, lookup: idle })
    ).toEqual({ kind: "unnamed" });
    expect(
      releaseOwnerView({ ownerId: null, me, canReadUsers: true, lookup: idle })
    ).toEqual({ kind: "unrecorded" });
  });
});
