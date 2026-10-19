/**
 * Which fields a version changed, and the order a reader meets them in.
 *
 * Two properties a plausible slip breaks: a field the reader may not read must
 * never be claimed as changed, and the order must lead with changes the form
 * does not lay out (the title, drawn in the header) before following the
 * form's own order, so moving through changes never jumps back up the page.
 */
import { describe, expect, it } from "vitest";

import type { FieldDiff, VersionDiff } from "@admin/services/versionApi";

import { changeOrder, diffForPair, versionChangesOf } from "../version-changes";

const text = (name: string, status: FieldDiff["status"]): FieldDiff => ({
  kind: "text",
  name,
  label: name,
  type: "text",
  status,
  segments: [{ op: 0, text: "x" }],
});

const diffOf = (fields: FieldDiff[], incomplete?: boolean): VersionDiff => ({
  from: 3,
  to: 4,
  locale: null,
  hasChanges: true,
  ...(incomplete ? { incomplete } : {}),
  fields,
});

describe("versionChangesOf", () => {
  it("keeps the changed fields, and counts every field compared", () => {
    const changes = versionChangesOf(
      diffOf([
        text("title", "changed"),
        text("excerpt", "unchanged"),
        text("body", "added"),
        text("note", "removed"),
      ])
    );

    expect([...changes.byField.keys()]).toEqual(["title", "body", "note"]);
    expect(changes.total).toBe(4);
    expect(changes.incomplete).toBe(false);
  });

  it("never claims a field the reader may not read as changed", () => {
    const changes = versionChangesOf(
      diffOf(
        [
          text("title", "changed"),
          {
            kind: "hidden",
            name: "secret",
            label: "Secret",
            type: "text",
            status: "unchanged",
            reason: "no-access",
          },
        ],
        true
      )
    );

    expect([...changes.byField.keys()]).toEqual(["title"]);
    expect(changes.incomplete).toBe(true);
  });
});

describe("changeOrder", () => {
  it("leads with changes outside the form, then follows the form's order", () => {
    // The diff lists body before excerpt; the form lays excerpt out first.
    const changes = versionChangesOf(
      diffOf([
        text("body", "changed"),
        text("title", "changed"),
        text("excerpt", "changed"),
        text("slug", "unchanged"),
      ])
    );

    expect(changeOrder(changes, ["excerpt", "slug", "body"])).toEqual([
      "title",
      "excerpt",
      "body",
    ]);
  });
});

describe("diffForPair", () => {
  it("keeps a comparison only for the pair it was read for", () => {
    // A query keeps the previous pair's result on screen while the next
    // loads; marking this version from it would mark the wrong changes.
    const previous = diffOf([text("title", "changed")]);

    expect(diffForPair(previous, 3, 4)).toBe(previous);
    expect(diffForPair(previous, 2, 4)).toBeUndefined();
    expect(diffForPair(previous, 3, 5)).toBeUndefined();
    expect(diffForPair(undefined, 3, 4)).toBeUndefined();
  });
});
