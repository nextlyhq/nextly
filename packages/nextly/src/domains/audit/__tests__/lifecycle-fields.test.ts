/**
 * Whether a publish edits what it promotes, as it states `requestEdits`: a
 * field a person writes, sent with a value the draft does not hold.
 */
import { describe, expect, it } from "vitest";

import { editsOver, LIFECYCLE_FIELDS } from "../lifecycle-fields";

const draft = {
  id: "page-1",
  createdAt: "2026-10-01T00:00:00.000Z",
  title: "pending",
  status: "published",
  hero: { caption: "draft" },
};

describe("whether a publish edits what it promotes", () => {
  it("does when it sends a field a person writes with a value the draft does not hold", () => {
    expect(editsOver(draft, { status: "published", title: "new" })).toBe(true);
    expect(editsOver(draft, { hero: { caption: "new" } })).toBe(true);
    // A title and a slug are system columns until an author declares their
    // own, and a person writes them either way.
    expect(editsOver({ ...draft, slug: "a" }, { slug: "b" })).toBe(true);
  });

  it("does not when it echoes the draft, compared by value", () => {
    // 🔴 The must-differ case: reading only WHICH keys came back, the full
    // document echoed here would count as an edit.
    expect(editsOver(draft, { ...draft, hero: { caption: "draft" } })).toBe(
      false
    );
  });

  it("does not for a system field, which no write takes from a request", () => {
    expect(
      editsOver(draft, { id: "other", createdAt: "2020-01-01T00:00:00.000Z" })
    ).toBe(false);
    // The population: the lifecycle's own fields are among them.
    expect(LIFECYCLE_FIELDS.has("status")).toBe(true);
    expect(LIFECYCLE_FIELDS.has("updatedAt")).toBe(true);
    expect(editsOver(draft, { status: "draft", updatedAt: new Date() })).toBe(
      false
    );
  });

  it("does not for a draft value the request left alone", () => {
    expect(editsOver(draft, {})).toBe(false);
  });
});
