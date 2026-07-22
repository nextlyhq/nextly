/**
 * The publish-transition classifier decides which permission a status change
 * needs, so every branch is load-bearing for authorization: a wrong `null`
 * lets a publish through as an update, and a wrong `"publish"` blocks an
 * ordinary edit.
 */
import { describe, it, expect } from "vitest";

import { resolvePublishTransition } from "./status-transition";

describe("resolvePublishTransition", () => {
  it("treats draft → published as a publish", () => {
    expect(resolvePublishTransition("draft", "published")).toBe("publish");
  });

  it("treats a create landing in published as a publish", () => {
    // previousStatus is null for a create; null is not "published".
    expect(resolvePublishTransition(null, "published")).toBe("publish");
  });

  it("treats published → draft as an unpublish", () => {
    expect(resolvePublishTransition("published", "draft")).toBe("unpublish");
  });

  it("treats published → any other status as an unpublish", () => {
    // Leaving published in any direction is an unpublish, not only to draft.
    expect(resolvePublishTransition("published", "archived")).toBe("unpublish");
  });

  it("is not a transition when status stays published", () => {
    // Editing a live document is an ordinary update, not a re-publish.
    expect(resolvePublishTransition("published", "published")).toBeNull();
  });

  it("is not a transition when status stays draft", () => {
    expect(resolvePublishTransition("draft", "draft")).toBeNull();
  });

  it("is not a transition between two non-published statuses", () => {
    expect(resolvePublishTransition("draft", "archived")).toBeNull();
  });

  it("is not a transition when the write sets no status", () => {
    // A patch that omits status leaves the stored value untouched.
    expect(resolvePublishTransition("published", undefined)).toBeNull();
    expect(resolvePublishTransition("draft", undefined)).toBeNull();
  });

  it("is not a transition for a non-string status", () => {
    // A malformed payload expresses no lifecycle move.
    expect(resolvePublishTransition("draft", 1)).toBeNull();
    expect(resolvePublishTransition("draft", null)).toBeNull();
    expect(resolvePublishTransition("published", {})).toBeNull();
  });

  it("treats an undefined previous status like an absent one", () => {
    // Some callers pass undefined rather than null for "no prior status".
    expect(resolvePublishTransition(undefined, "published")).toBe("publish");
    expect(resolvePublishTransition(undefined, "draft")).toBeNull();
  });
});
