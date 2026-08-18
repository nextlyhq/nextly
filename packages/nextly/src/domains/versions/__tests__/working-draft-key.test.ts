import { describe, expect, it } from "vitest";

import type { VersionRef } from "../versions-repository";
import { workingDraftKey } from "../working-draft-key";

const ref = (slug: string, entryId: string): VersionRef => ({
  scopeKind: "collection",
  scopeSlug: slug,
  entryId,
});

describe("workingDraftKey", () => {
  it("is a fixed-width lowercase hex digest", () => {
    expect(workingDraftKey(ref("posts", "e1"), "en")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for the same inputs", () => {
    expect(workingDraftKey(ref("posts", "e1"), "en")).toBe(
      workingDraftKey(ref("posts", "e1"), "en")
    );
  });

  it("separates one language from another", () => {
    expect(workingDraftKey(ref("posts", "e1"), "en")).not.toBe(
      workingDraftKey(ref("posts", "e1"), "es")
    );
  });

  it("separates an unlocalized document from a localized one", () => {
    expect(workingDraftKey(ref("posts", "e1"), null)).not.toBe(
      workingDraftKey(ref("posts", "e1"), "en")
    );
  });

  it("cannot be forged by moving the delimiter into a segment", () => {
    // Without per-segment encoding, ("posts:a", "e1") and ("posts", "a:e1")
    // would join to the same string and collapse two documents into one key.
    expect(workingDraftKey(ref("posts:a", "e1"), null)).not.toBe(
      workingDraftKey(ref("posts", "a:e1"), null)
    );
  });

  it("separates scope kinds", () => {
    const asSingle: VersionRef = {
      scopeKind: "single",
      scopeSlug: "posts",
      entryId: "e1",
    };
    expect(workingDraftKey(asSingle, null)).not.toBe(
      workingDraftKey(ref("posts", "e1"), null)
    );
  });
});
