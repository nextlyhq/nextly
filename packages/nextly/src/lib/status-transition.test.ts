/**
 * The publish-transition classifier decides which permission a status change
 * needs, so every branch is load-bearing for authorization: a wrong `null`
 * lets a publish through as an update, and a wrong `"publish"` blocks an
 * ordinary edit.
 */
import { describe, it, expect } from "vitest";

import {
  resolveFirstPublishedStamp,
  resolvePublishTransition,
} from "./status-transition";

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

  it("is not a transition when the write omits status", () => {
    // Only an ABSENT (undefined) status leaves the stored value untouched.
    expect(resolvePublishTransition("published", undefined)).toBeNull();
    expect(resolvePublishTransition("draft", undefined)).toBeNull();
  });

  it("is not a move INTO published for a non-string status", () => {
    // A coerced number/boolean can never equal "published", so from a draft it
    // is not a publish.
    expect(resolvePublishTransition("draft", 1)).toBeNull();
    expect(resolvePublishTransition("draft", null)).toBeNull();
    expect(resolvePublishTransition("draft", false)).toBeNull();
  });

  it("treats an explicit non-published value over a published row as unpublish", () => {
    // Some dialects coerce a JSON number/boolean into the text column, storing
    // a value other than "published" — which removes the row from published
    // reads. That must be gated as an unpublish, not slip through.
    expect(resolvePublishTransition("published", 0)).toBe("unpublish");
    expect(resolvePublishTransition("published", false)).toBe("unpublish");
    expect(resolvePublishTransition("published", null)).toBe("unpublish");
    expect(resolvePublishTransition("published", {})).toBe("unpublish");
  });

  it("treats an undefined previous status like an absent one", () => {
    // Some callers pass undefined rather than null for "no prior status".
    expect(resolvePublishTransition(undefined, "published")).toBe("publish");
    expect(resolvePublishTransition(undefined, "draft")).toBeNull();
  });
});

describe("resolveFirstPublishedStamp", () => {
  const now = new Date("2026-08-02T10:00:00.000Z");
  const base = {
    hasStatus: true,
    previousStatus: "draft" as string | null | undefined,
    nextStatus: "published" as unknown,
    existingMarker: null as unknown,
    now,
  };

  it("records the instant a draft becomes published", () => {
    expect(resolveFirstPublishedStamp(base)).toBe(now);
  });

  it("records a create that lands directly on published", () => {
    // A create has no prior status, so landing on published IS the first publication.
    expect(resolveFirstPublishedStamp({ ...base, previousStatus: null })).toBe(
      now
    );
  });

  it("records nothing when the entity has no draft lifecycle", () => {
    // Nothing transitions, so there is no publication moment to date.
    expect(
      resolveFirstPublishedStamp({ ...base, hasStatus: false })
    ).toBeUndefined();
  });

  it("records nothing when a marker is already stored", () => {
    // It dates the FIRST publication; a republish must not move it.
    expect(
      resolveFirstPublishedStamp({
        ...base,
        previousStatus: "draft",
        existingMarker: new Date("2020-01-01T00:00:00.000Z"),
      })
    ).toBeUndefined();
  });

  it("records nothing for an already-published row", () => {
    // The case that matters for rows published before the column existed: their marker is null
    // because the history was never recorded, and dating them now would invent a publication.
    expect(
      resolveFirstPublishedStamp({ ...base, previousStatus: "published" })
    ).toBeUndefined();
  });

  it("records nothing for an unpublish", () => {
    expect(
      resolveFirstPublishedStamp({
        ...base,
        previousStatus: "published",
        nextStatus: "draft",
      })
    ).toBeUndefined();
  });

  it("records nothing when the write names no status", () => {
    // A content-only edit moves nothing.
    expect(
      resolveFirstPublishedStamp({ ...base, nextStatus: undefined })
    ).toBeUndefined();
  });

  it("treats a marker of 0 as already recorded", () => {
    // SQLite stores these as integers, and the epoch is falsy — a truthiness check here would
    // re-stamp a row that already carries a (very old) date.
    expect(
      resolveFirstPublishedStamp({ ...base, existingMarker: 0 })
    ).toBeUndefined();
  });

  it("treats an absent column as nothing recorded", () => {
    // A row read that did not project the column must not be mistaken for a stored value.
    expect(
      resolveFirstPublishedStamp({ ...base, existingMarker: undefined })
    ).toBe(now);
  });

  it("does not record for a non-string status coerced into the column", () => {
    // Only the exact string is published, matching resolvePublishTransition.
    expect(
      resolveFirstPublishedStamp({ ...base, nextStatus: 1 })
    ).toBeUndefined();
  });
});
