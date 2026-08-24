/**
 * What the `pages` collection is made of, and what it deliberately is not.
 *
 * The absences here are the point, so each is paired with a positive control on
 * the same read: an assertion that a field is missing is satisfied just as well
 * by a collection with no fields at all.
 */
import { describe, expect, it } from "vitest";

import { pageBuilder } from "../plugin";

import { pagesCollection } from "./pages";

/**
 * The custom-CSS field and its permission were removed rather than fixed.
 *
 * Nothing rendered what the field stored and nothing sanitised it, while a
 * permission sat in front of it implying otherwise. These pin the removal,
 * because the failure mode of reinstating it is silent: the field would store
 * author-written CSS again and still reach no page, and the permission would
 * reappear in the admin's matrix as though it protected something.
 */
describe("pages carries no custom CSS surface", () => {
  const fieldNames = () =>
    (pagesCollection().fields as { name?: string }[]).map(f => f.name);

  it("declares no customCss field", () => {
    // The control: the collection does have fields, so the absence below is
    // about this one rather than about an empty list.
    expect(fieldNames()).toContain("content");
    expect(fieldNames()).not.toContain("customCss");
  });

  it("declares no permission, now that no rule reads one", () => {
    // A permission nothing consults grants nothing when held and prevents
    // nothing when withheld, while still being offered to an administrator to
    // assign.
    const declared = pageBuilder().contributes?.permissions ?? [];
    expect(declared).toHaveLength(0);
  });
});

/**
 * How an entry is edited is decided by the FIELD, not per entry.
 *
 * Asserted on the collection rather than through the admin, because what this
 * guards is structural: the retired switch stored a UI preference as a column
 * and left a second content field beside it. Both are visible here, and neither
 * is something an admin-rendering test would have reported.
 */
describe("pages is built from blocks", () => {
  const fieldsOf = () =>
    pagesCollection().fields as { name?: string; type?: string }[];

  it("carries a blocks field for the page body", () => {
    // The positive control for the two absences below: each of them is
    // satisfied by a collection with no fields at all, and this is the
    // assertion that separates those cases.
    const content = fieldsOf().find(f => f.name === "content");
    expect(content?.type).toBe("blocks");
  });

  it("stores no editor-mode preference", () => {
    // `editorMode` was a real column, so it travelled in API responses and
    // exports and could be written by anything holding the entry.
    expect(fieldsOf().map(f => f.name)).not.toContain("editorMode");
  });

  it("offers no second content field to diverge from the blocks one", () => {
    // Both arms of the retired choice persisted at once — what hid one was
    // `admin.condition`, which reaches the admin form and nothing else — so an
    // entry could hold a block document AND rich text with one of them unread.
    expect(fieldsOf().map(f => f.name)).not.toContain("body");
  });
});

describe("where a page previews", () => {
  // Declared only when the host passes a path, and the reason is an interaction
  // between two behaviours: minting a preview link REFUSES when a collection
  // declares no preview URL. Without a declaration an editor is told a developer
  // must configure one; with a defaulted declaration the mint succeeds and the
  // reviewer gets a 404 that looks like an expired link. A default would
  // therefore make an installation that has mounted no preview route strictly
  // worse off than declaring nothing.
  it("declares no preview until the host supplies a path", () => {
    expect(pagesCollection().admin?.preview).toBeUndefined();
  });

  it("declares one once the host supplies a path", () => {
    const preview = pagesCollection("/{slug}").admin?.preview;

    expect(typeof preview?.url).toBe("function");
  });

  it("serves a host that mounted its pages at the root", () => {
    const url = pagesCollection("/{slug}").admin?.preview?.url;

    expect(url?.({ slug: "about" })).toBe("/about");
  });

  it("serves a host that mounted its pages under a prefix", () => {
    const url = pagesCollection("/blocks/{slug}").admin?.preview?.url;

    expect(url?.({ slug: "about" })).toBe("/blocks/about");
  });

  // An entry without a slug yet is not previewable, and becomes so once it has
  // one. `null` is how the resolver is told that rather than building a URL with
  // a hole in it.
  it("declines an entry whose slug is not filled in yet", () => {
    const url = pagesCollection("/{slug}").admin?.preview?.url;

    expect(url?.({})).toBeNull();
  });

  it("escapes a slug that would otherwise change the path", () => {
    const url = pagesCollection("/{slug}").admin?.preview?.url;

    expect(url?.({ slug: "a/b" })).toBe("/a%2Fb");
  });
});
