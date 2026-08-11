// Why: status auto-filter is the safety guarantee for Draft/Published.
// Public/untrusted callers must never see drafts unless they explicitly opt in.
// Trusted callers (admin UI, server-side internal calls with overrideAccess)
// see everything by default. These tests lock the rule so future refactors
// can't silently change which calls leak unpublished content.
import { describe, expect, it } from "vitest";

import { expansionStatusScope, resolveStatusFilter } from "./status-filter";

describe("resolveStatusFilter", () => {
  it("returns null when collection does not have status enabled", () => {
    expect(
      resolveStatusFilter({
        collectionHasStatus: false,
        overrideAccess: false,
        explicit: undefined,
      })
    ).toBeNull();

    // Overrides are also no-ops when the collection has no status column.
    expect(
      resolveStatusFilter({
        collectionHasStatus: false,
        overrideAccess: false,
        explicit: "draft",
      })
    ).toBeNull();
  });

  it("returns 'published' for public callers by default (status enabled, no override)", () => {
    expect(
      resolveStatusFilter({
        collectionHasStatus: true,
        overrideAccess: false,
        explicit: undefined,
      })
    ).toEqual({ value: "published" });
  });

  it("returns null for trusted callers by default (overrideAccess: true)", () => {
    expect(
      resolveStatusFilter({
        collectionHasStatus: true,
        overrideAccess: true,
        explicit: undefined,
      })
    ).toBeNull();
  });

  it("respects explicit 'all' for any caller", () => {
    expect(
      resolveStatusFilter({
        collectionHasStatus: true,
        overrideAccess: false,
        explicit: "all",
      })
    ).toBeNull();

    expect(
      resolveStatusFilter({
        collectionHasStatus: true,
        overrideAccess: true,
        explicit: "all",
      })
    ).toBeNull();
  });

  it("respects explicit 'draft' for any caller", () => {
    expect(
      resolveStatusFilter({
        collectionHasStatus: true,
        overrideAccess: false,
        explicit: "draft",
      })
    ).toEqual({ value: "draft" });

    expect(
      resolveStatusFilter({
        collectionHasStatus: true,
        overrideAccess: true,
        explicit: "draft",
      })
    ).toEqual({ value: "draft" });
  });

  it("respects explicit 'published' for any caller", () => {
    expect(
      resolveStatusFilter({
        collectionHasStatus: true,
        overrideAccess: true,
        explicit: "published",
      })
    ).toEqual({ value: "published" });
  });
});

describe("expansionStatusScope", () => {
  // Relationship expansion reads a collection the caller never named, so the
  // lifecycle scope it runs under is DERIVED. These cases pin which derivations
  // survive a caller that has bounded its own bypass.

  it("propagates a scope the caller actually asked for", () => {
    // `status: "all"` is a statement about this read, not an inference from
    // trust, so bounding the bypass does not retract it.
    expect(
      expansionStatusScope({
        status: "all",
        overrideAccess: true,
        bounded: true,
      })
    ).toBe("all");
  });

  it("widens for a trusted caller that has not bounded itself", () => {
    // The admin UI and server tasks: they have already decided who is asking,
    // so expansion keeps seeing everything the parent read could.
    expect(expansionStatusScope({ overrideAccess: true, bounded: false })).toBe(
      "all"
    );
  });

  it("does NOT widen for a trusted caller that HAS bounded itself", () => {
    // The defect this exists to prevent. Supplying `trusted` declares one fixed
    // audience; an inherited "all" would then beat that bound rather than be
    // checked against it, because `resolveStatusFilter` short-circuits on an
    // explicit "all" before consulting the narrowed override. Every target
    // would return drafts — including the ones the caller refused to trust.
    expect(
      expansionStatusScope({ overrideAccess: true, bounded: true })
    ).toBeUndefined();
  });

  it("does not widen for an untrusted caller", () => {
    expect(
      expansionStatusScope({ overrideAccess: false, bounded: false })
    ).toBeUndefined();
  });

  it("leaves a concrete lifecycle to the target's own default", () => {
    // `published` and `draft` name the lifecycle of the collection being read
    // and say nothing about what it points at, so neither propagates. The
    // target resolves its own default, which is published-only unless the
    // expansion is entitled to more.
    expect(
      expansionStatusScope({
        status: "published",
        overrideAccess: true,
        bounded: true,
      })
    ).toBeUndefined();
  });

  it("composes with resolveStatusFilter to exclude a bounded caller's drafts", () => {
    // The composition is the property that matters: the two functions are
    // correct apart and the leak lived in how they met. Asserting only the
    // scope would pass for a scope that the filter then ignores.
    const scope = expansionStatusScope({
      overrideAccess: true,
      bounded: true,
    });

    expect(
      resolveStatusFilter({
        collectionHasStatus: true,
        // The narrowed, per-target answer: this target was NOT trusted.
        overrideAccess: false,
        explicit: scope,
      })
    ).toEqual({ value: "published" });
  });
});
