/**
 * Whether a document may join a release, and why not when it may not.
 *
 * The two actions have DIFFERENT preconditions, and that asymmetry is the
 * thing most likely to be "simplified" into one rule later:
 *
 *   publish   needs a pending edit to publish, so it needs the draft split.
 *   unpublish needs only the Draft/Published lifecycle — a collection with
 *             status and no drafts can still be scheduled off the site.
 *
 * Collapsing them would silently remove scheduled takedown from every
 * status-only collection, and no test that checked publish alone would notice.
 *
 * @module domains/releases/__tests__/release-eligibility.test
 */
import { describe, it, expect } from "vitest";

import type { DraftSplitEligibility } from "../../versions/draft-split-eligibility";
import { canScheduleMember } from "../release-eligibility";

const eligible: DraftSplitEligibility = {
  eligible: true,
  reason: null,
  componentSlug: null,
};

const refusedFor = (
  reason: DraftSplitEligibility["reason"],
  componentSlug: string | null = null
): DraftSplitEligibility => ({ eligible: false, reason, componentSlug });

describe("canScheduleMember", () => {
  it("allows publishing a document whose draft split is eligible", () => {
    expect(
      canScheduleMember({
        action: "publish",
        collectionHasStatus: true,
        draftEligibility: eligible,
      })
    ).toEqual({ allowed: true, reason: null, componentSlug: null });
  });

  it("refuses publishing with the SAME reason the schema response reports", () => {
    // Reusing the vocabulary rather than inventing a second one: the admin
    // already knows how to explain `password-field`, and two spellings of one
    // cause is how the explanation and the rule drift apart.
    expect(
      canScheduleMember({
        action: "publish",
        collectionHasStatus: true,
        draftEligibility: refusedFor("password-field"),
      })
    ).toEqual({
      allowed: false,
      reason: "password-field",
      componentSlug: null,
    });
  });

  it("carries the component slug through when the cause is a component", () => {
    expect(
      canScheduleMember({
        action: "publish",
        collectionHasStatus: true,
        draftEligibility: refusedFor("unresolvable-component", "hero"),
      })
    ).toEqual({
      allowed: false,
      reason: "unresolvable-component",
      componentSlug: "hero",
    });
  });

  it("refuses publishing when the configuration never asked for drafts", () => {
    // `reason: null` on the draft side means "nothing asked for the split",
    // which is not a misconfiguration for a schema response but IS a refusal
    // here: there is no pending edit for a release to publish.
    expect(
      canScheduleMember({
        action: "publish",
        collectionHasStatus: true,
        draftEligibility: refusedFor(null),
      })
    ).toEqual({
      allowed: false,
      reason: "no-pending-changes",
      componentSlug: null,
    });
  });

  it("allows unpublishing a status-only collection, which can never be PUBLISHED by a release", () => {
    // THE asymmetry. This collection has no draft split at all, so it can
    // never carry a publish member — and scheduled takedown still has to work
    // for it, because taking a live page down needs no pending edit.
    expect(
      canScheduleMember({
        action: "unpublish",
        collectionHasStatus: true,
        draftEligibility: refusedFor(null),
      })
    ).toEqual({ allowed: true, reason: null, componentSlug: null });
  });

  it("refuses unpublishing a collection with no lifecycle at all", () => {
    // Without a status lifecycle there is no published state to leave, so
    // there is nothing for an unpublish to do.
    expect(
      canScheduleMember({
        action: "unpublish",
        collectionHasStatus: false,
        draftEligibility: refusedFor(null),
      })
    ).toEqual({ allowed: false, reason: "no-lifecycle", componentSlug: null });
  });

  it("refuses publishing a collection with no lifecycle at all", () => {
    expect(
      canScheduleMember({
        action: "publish",
        collectionHasStatus: false,
        draftEligibility: refusedFor("lifecycle-disabled"),
      }).allowed
    ).toBe(false);
  });
});
