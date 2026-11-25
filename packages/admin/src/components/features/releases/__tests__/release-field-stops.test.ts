/**
 * How a release's field stop and a release write refused for a moment are worded. The plausible
 * broken versions: the field left out, a stop on a document the reader cannot open named, the
 * server's sentence about a collection's state shown as if it were about the editor's input.
 */
import { describe, expect, it } from "vitest";

import type { ReleaseStopsView } from "@admin/types/releases";

import { fieldStopsLine } from "../release-blockers";
import { releaseErrorMessage } from "../release-error";

function stop(
  over: Partial<ReleaseStopsView["items"][number]> = {}
): ReleaseStopsView["items"][number] {
  return {
    memberId: "m1",
    reason: "FIELD_REMOVED",
    field: "subtitle",
    action: "publish",
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId: "p1",
    ...over,
  };
}

describe("fieldStopsLine", () => {
  it("names the field, what the Builder did to it and what settles it, for each reason", () => {
    expect(fieldStopsLine({ items: [stop()], hidden: 0 })).toBe(
      "The field “subtitle” of posts was removed in the Builder. Start dev or save posts in the Builder, then run the release again."
    );
    expect(
      fieldStopsLine({ items: [stop({ reason: "FIELD_CHANGED" })], hidden: 0 })
    ).toContain("had its type or storage changed in the Builder");
  });

  it("counts the other stops, the ones the reader cannot open among them, and names none of those", () => {
    const line = fieldStopsLine({
      items: [stop(), stop({ memberId: "m2", field: "summary" })],
      hidden: 1,
    });
    expect(line).toMatch(/^The field “subtitle” of posts/);
    expect(line).toContain("(2 more documents too.)");
    expect(line).not.toContain("summary");
    expect(fieldStopsLine({ items: [], hidden: 1 })).toBe(
      "A field changed in the Builder stopped a document you can't open. Run the release again once the Builder save is settled."
    );
  });

  it("says nothing for a release no field stopped, and names no field where the refusal named none", () => {
    expect(fieldStopsLine(undefined)).toBeNull();
    expect(fieldStopsLine({ items: [], hidden: 0 })).toBeNull();
    expect(
      fieldStopsLine({ items: [stop({ field: null })], hidden: 0 })
    ).toMatch(/^A field of posts was removed/);
  });
});

describe("releaseErrorMessage", () => {
  it("words a collection being changed in our own sentence, a passing state, not the input", () => {
    expect(
      releaseErrorMessage(
        { code: "COLLECTION_BEING_CHANGED", message: "internal wording" },
        "Could not schedule."
      )
    ).toBe(
      "A collection in this release is being changed in the Builder. Try again in a moment."
    );
  });

  it("keeps the caller's own wording for a code it has not met, a prototype key included", () => {
    expect(
      releaseErrorMessage(
        { code: "toString", message: "x" },
        "Could not schedule."
      )
    ).toBe("Could not schedule.");
  });
});
