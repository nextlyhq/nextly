/**
 * What the release page says about each problem its checks report, and the
 * way out it offers.
 *
 * @module components/features/releases/__tests__/release-problems.test
 */
import { describe, expect, it } from "vitest";

import type { ReleaseReadinessFinding } from "@admin/types/releases";

import {
  otherReleaseIds,
  problemsByMember,
  type ProblemContext,
} from "../release-problems";

const CONTEXT: ProblemContext = {
  releaseId: "r1",
  singularOf: slug => (slug === "categories" ? "Category" : slug),
  releaseTitleOf: id => (id === "r2" ? "Pricing update" : undefined),
};

function finding(
  code: string,
  detail?: ReleaseReadinessFinding["detail"],
  action: ReleaseReadinessFinding["action"] = "publish"
): ReleaseReadinessFinding {
  return {
    memberId: "m1",
    code,
    source: "core",
    action,
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId: "e1",
    ...(detail ? { detail } : {}),
  };
}

function hard(f: ReleaseReadinessFinding) {
  return problemsByMember({ hard: [f], soft: [] }, CONTEXT)("m1").hard[0];
}

function soft(f: ReleaseReadinessFinding) {
  return problemsByMember({ hard: [], soft: [f] }, CONTEXT)("m1").soft[0];
}

describe("a problem that stops the release", () => {
  it("names the required fields that are missing, and offers to fix them", () => {
    expect(
      hard(finding("REQUIRED_FIELD_MISSING", { fields: ["excerpt"] }))
    ).toEqual({ text: "Missing a required field: excerpt", remedy: "open" });
    expect(
      hard(finding("REQUIRED_FIELD_MISSING", { fields: ["excerpt", "slug"] }))
        ?.text
    ).toBe("Missing 2 required fields: excerpt and slug");
  });

  it("says which act the person who added it may no longer perform", () => {
    expect(hard(finding("AUTHOR_MAY_NOT_ACT"))).toEqual({
      text: "The person who added it may no longer publish it",
      remedy: "remove",
    });
    expect(
      hard(finding("AUTHOR_MAY_NOT_ACT", undefined, "unpublish"))?.text
    ).toBe("The person who added it may no longer unpublish it");
  });

  it("says a deleted document is gone, and offers to take it out", () => {
    expect(hard(finding("DOCUMENT_GONE"))).toEqual({
      text: "This document no longer exists",
      remedy: "remove",
    });
  });

  it("says the run's own reasons in the words the schedule dialog uses", () => {
    expect(hard(finding("AUTHOR_GONE"))?.text).toBe(
      "The person who added it has been deleted or deactivated"
    );
  });

  it("still shows a reason another feature registers, in its code's words", () => {
    expect(hard(finding("NOT_APPROVED"))).toEqual({
      text: "Not approved",
      remedy: null,
    });
  });
});

describe("a note that does not stop the release", () => {
  it("names the other release holding the document, and which one wins", () => {
    expect(
      soft(
        finding("IN_OTHER_RELEASE", {
          releaseId: "r2",
          winningReleaseId: "r2",
        })
      )
    ).toEqual({
      text: "Also in “Pricing update”: that one runs later and wins",
      remedy: null,
      otherReleaseId: "r2",
    });
    expect(
      soft(
        finding("IN_OTHER_RELEASE", { releaseId: "r3", winningReleaseId: "r1" })
      )?.text
    ).toBe(
      "Also in another scheduled release: this release runs later and wins"
    );
    expect(
      soft(
        finding("IN_OTHER_RELEASE", { releaseId: "r2", winningReleaseId: null })
      )?.text
    ).toBe("Also in “Pricing update”: whichever runs later wins");
  });

  it("says each kind of link that will not be live", () => {
    expect(
      soft(
        finding("UNPUBLISHED_LINK", {
          scopeKind: "collection",
          scopeSlug: "categories",
          entryId: "c1",
          fields: ["categories"],
          cause: "draft",
        })
      )?.text
    ).toBe("Links to a category that will not be published (categories)");
    expect(
      soft(
        finding("UNPUBLISHED_LINK", {
          scopeSlug: "categories",
          entryId: "c1",
          fields: ["categories"],
          cause: "comes-down",
        })
      )?.text
    ).toBe(
      "Links to a category that comes down before this goes live (categories)"
    );
    expect(
      soft(
        finding("UNPUBLISHED_LINK", {
          fields: ["categories"],
          cause: "deleted",
          count: "2",
        })
      )?.text
    ).toBe("2 links to deleted documents (categories)");
    expect(
      soft(finding("UNPUBLISHED_LINKS_HIDDEN", { count: "1" }))?.text
    ).toBe("1 link to documents you can't view will not be live");
    expect(
      soft(finding("UNPUBLISHED_LINK_IN_HIDDEN_FIELD", { count: "3" }))?.text
    ).toBe("3 links in fields you can't view will not be live");
  });
});

describe("problemsByMember", () => {
  it("keeps each member's problems apart, and says a repeated one once", () => {
    const problemsOf = problemsByMember(
      {
        hard: [
          finding("DOCUMENT_GONE"),
          finding("DOCUMENT_GONE"),
          { ...finding("AUTHOR_GONE"), memberId: "m2" },
        ],
        soft: [],
      },
      CONTEXT
    );
    expect(problemsOf("m1").hard).toHaveLength(1);
    expect(problemsOf("m2").hard[0]?.text).toMatch(/deactivated/);
    expect(problemsOf("m3")).toEqual({ hard: [], soft: [] });
  });

  it("lists the other releases the notes name, each once", () => {
    const note = finding("IN_OTHER_RELEASE", { releaseId: "r2" });
    expect(
      otherReleaseIds({ soft: [note, note, finding("UNPUBLISHED_LINK")] })
    ).toEqual(["r2"]);
  });
});
