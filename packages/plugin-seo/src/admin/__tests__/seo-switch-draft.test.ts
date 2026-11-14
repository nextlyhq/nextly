/**
 * The Content types tab's SEO switches as the settings draft holds them: read
 * from what is stored, switched off and on again without a change left
 * behind, saved as the list of types that are off, moved onto settings saved
 * elsewhere meanwhile, and said under the Save button in plain words.
 */
import { describe, expect, it } from "vitest";

import {
  changesOf,
  draftOf,
  isSeoOn,
  rebasedDraft,
  switchChangesText,
  withSeoOn,
} from "../settings-draft";

const stored = {
  id: "s1",
  _rev: "3",
  siteName: "Acme",
  typesWithSeoOff: ["authors"],
};

describe("the SEO switch in the settings draft", () => {
  it("reads the types that are off, and every other type as on", () => {
    const draft = draftOf(stored);
    expect(draft.typesWithSeoOff).toEqual(["authors"]);
    expect(isSeoOn(draft, "authors")).toBe(false);
    expect(isSeoOn(draft, "posts")).toBe(true);
    // Nothing stored yet: every type is on.
    expect(draftOf({ id: "s1" }).typesWithSeoOff).toEqual([]);
  });

  it("saves a switch-off as the list of types that are off, and nothing once it is back on", () => {
    const off = withSeoOn(draftOf(stored), "posts", false);
    expect(changesOf(stored, off)).toEqual({
      typesWithSeoOff: ["authors", "posts"],
      _rev: "3",
    });
    expect(changesOf(stored, withSeoOn(off, "posts", true))).toBeNull();
    expect(
      changesOf(stored, withSeoOn(draftOf(stored), "authors", true))
    ).toEqual({ typesWithSeoOff: [], _rev: "3" });
  });

  it("keeps a switch made here when another type was switched elsewhere meanwhile", () => {
    const before = draftOf(stored);
    const draft = withSeoOn(before, "posts", false);
    const after = draftOf({ ...stored, typesWithSeoOff: ["authors", "tags"] });
    expect(
      [...rebasedDraft(draft, before, after).typesWithSeoOff].sort()
    ).toEqual(["authors", "posts", "tags"]);
  });

  it("says each switch waiting to be saved by the type's name", () => {
    const labels = new Map([
      ["authors", "Authors"],
      ["posts", "Posts"],
    ]);
    const before = draftOf(stored);
    expect(switchChangesText(before, before, labels)).toBeNull();
    const off = withSeoOn(before, "posts", false);
    expect(switchChangesText(before, off, labels)).toBe(
      "1 change: SEO off for Posts"
    );
    const both = withSeoOn(off, "authors", true);
    expect(switchChangesText(before, both, labels)).toBe(
      "2 changes: SEO on for Authors, SEO off for Posts"
    );
  });
});
