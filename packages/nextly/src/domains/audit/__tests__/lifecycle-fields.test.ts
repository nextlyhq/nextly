/**
 * Whether a publish edits what it promotes, as it states `requestEdits`: a
 * field a person writes, sent with a value the draft does not hold.
 */
import { describe, expect, it } from "vitest";

import { asIdSet } from "../../versions/shared-publish-base";
import { editsOver, LIFECYCLE_FIELDS } from "../lifecycle-fields";

const draft = {
  id: "page-1",
  createdAt: "2026-10-01T00:00:00.000Z",
  title: "pending",
  status: "published",
  hero: { caption: "draft" },
};

/** Whether `caller`, written over the draft, edits it, on a collection. */
const edits = (
  caller: Record<string, unknown>,
  base: Record<string, unknown> = draft
) =>
  editsOver({
    entity: "collection",
    draft: base,
    promoted: { ...base, ...caller },
  });

describe("whether a publish edits what it promotes", () => {
  it("does when it sends a field a person writes with a value the draft does not hold", () => {
    expect(edits({ status: "published", title: "new" })).toBe(true);
    expect(edits({ hero: { caption: "new" } })).toBe(true);
    // A title and a slug are system columns until an author declares their
    // own, and a person writes them either way.
    expect(edits({ slug: "b" }, { ...draft, slug: "a" })).toBe(true);
  });

  it("does not when it echoes the draft, compared by value", () => {
    // 🔴 The must-differ case: reading only WHICH keys came back, the full
    // document echoed here would count as an edit.
    expect(edits({ ...draft, hero: { caption: "draft" } })).toBe(false);
  });

  it("does not for a system field, which no write takes from a request", () => {
    expect(edits({ id: "other", createdAt: "2020-01-01T00:00:00.000Z" })).toBe(
      false
    );
    // The population: the lifecycle's own fields are among them.
    expect(LIFECYCLE_FIELDS.has("status")).toBe(true);
    expect(LIFECYCLE_FIELDS.has("updatedAt")).toBe(true);
    expect(edits({ status: "draft", updatedAt: new Date() })).toBe(false);
  });

  it("does not for a draft value the request left alone", () => {
    expect(edits({})).toBe(false);
  });

  it("reads createdBy as a system field on a collection only", () => {
    const owned = { ...draft, createdBy: "ana" };
    expect(edits({ createdBy: "ben" }, owned)).toBe(false);
    // 🔴 A Single has no createdBy column, so a field of that name is the
    // author's own, and a new value for it is an edit.
    expect(
      editsOver({
        entity: "single",
        draft: owned,
        promoted: { ...owned, createdBy: "ben" },
      })
    ).toBe(true);
  });

  it("takes a date sent as a Date for the ISO string the draft keeps", () => {
    const dated = { ...draft, launch: "2026-11-01T09:00:00.000Z" };
    // 🔴 Compared as sent, a Date and its own ISO string differ.
    expect(edits({ launch: new Date("2026-11-01T09:00:00.000Z") }, dated)).toBe(
      false
    );
    // The must-differ half: another instant is an edit.
    expect(edits({ launch: new Date("2026-11-02T09:00:00.000Z") }, dated)).toBe(
      true
    );
  });

  it("compares a field named in the views through its view: a junction's ids as a set", () => {
    const linked = { ...draft, tags: ["a", "b"] };
    const promote = (tags: string[]) =>
      editsOver({
        entity: "collection",
        draft: linked,
        promoted: { ...linked, tags },
        views: new Map([["tags", asIdSet]]),
      });
    // 🔴 A junction keeps no order: the same ids in another order are no edit.
    expect(promote(["b", "a"])).toBe(false);
    expect(promote(["a", "c"])).toBe(true);
    // The control: without the view, order counts.
    expect(edits({ tags: ["b", "a"] }, linked)).toBe(true);
  });
});
