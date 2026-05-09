// Why: status auto-filter is the safety guarantee for Draft/Published.
// Public/untrusted callers must never see drafts unless they explicitly opt in.
// Trusted callers (admin UI, server-side internal calls with overrideAccess)
// see everything by default. These tests lock the rule so future refactors
// can't silently change which calls leak unpublished content.
import { describe, expect, it } from "vitest";

import { resolveStatusFilter } from "./status-filter";

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
