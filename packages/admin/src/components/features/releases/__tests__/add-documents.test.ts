/**
 * The Add documents picker's two judgements: which listed document may be
 * picked for the chosen action, and which linked documents an add offers
 * next.
 *
 * @module components/features/releases/__tests__/add-documents.test
 */
import { describe, expect, it } from "vitest";

import type { AddedReleaseMember } from "@admin/types/releases";

import {
  documentKey,
  linkedOffer,
  membersToAdd,
  pickRefusal,
  type PickerDocument,
} from "../add-documents";

const post: PickerDocument = {
  scopeKind: "collection",
  scopeSlug: "posts",
  entryId: "p1",
  title: "Hello",
  scopeLabel: "Posts",
  status: "draft",
};

const only =
  (...granted: string[]) =>
  (permission: string) =>
    granted.includes(permission);

describe("which document may be picked", () => {
  it("lets a reader who may publish but not unpublish pick it to go live only", () => {
    const context = {
      can: only("publish-posts"),
      inRelease: new Set<string>(),
    };
    expect(pickRefusal(post, "publish", context)).toBeNull();
    expect(pickRefusal(post, "unpublish", context)).toBe(
      "You do not have permission to unpublish Posts."
    );
  });

  it("lets a reader who may unpublish but not publish pick it to come down only", () => {
    const context = {
      can: only("unpublish-posts"),
      inRelease: new Set<string>(),
    };
    expect(pickRefusal(post, "unpublish", context)).toBeNull();
    expect(pickRefusal(post, "publish", context)).toBe(
      "You do not have permission to publish Posts."
    );
  });

  it("holds a document already in the release, whatever the reader may do", () => {
    expect(
      pickRefusal(post, "publish", {
        can: only("publish-posts", "unpublish-posts"),
        inRelease: new Set([documentKey(post)]),
      })
    ).toBe("Already in this release.");
  });

  it("sends each picked document with the chosen action", () => {
    expect(membersToAdd([post], "unpublish")).toEqual([
      {
        scopeKind: "collection",
        scopeSlug: "posts",
        entryId: "p1",
        action: "unpublish",
      },
    ]);
  });
});

/** A member as an add answers it, with the given links. */
function added(
  entryId: string,
  action: "publish" | "unpublish",
  links: Array<{ scopeSlug: string; entryId: string }>,
  counts: Partial<{
    hiddenCount: number;
    inHiddenFields: number;
    deleted: number;
  }> = {}
): AddedReleaseMember {
  return {
    id: `m-${entryId}`,
    releaseId: "r1",
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId,
    locale: null,
    action,
    createdBy: "u1",
    createdAt: "2026-11-02T00:00:00.000Z",
    unpublishedLinks: {
      links: links.map(link => ({
        scopeKind: "collection",
        fields: ["author"],
        ...link,
      })),
      hiddenCount: counts.hiddenCount ?? 0,
      inHiddenFields: counts.inHiddenFields ?? 0,
      deletedLinks: counts.deleted
        ? [{ field: "category", count: counts.deleted }]
        : [],
    },
  };
}

describe("what an add offers next", () => {
  it("offers each linked document once, and none already in the release or just added", () => {
    const offer = linkedOffer(
      [
        added("p1", "publish", [
          { scopeSlug: "authors", entryId: "a1" },
          { scopeSlug: "categories", entryId: "c1" },
          { scopeSlug: "posts", entryId: "p2" },
        ]),
        added("p2", "publish", [
          { scopeSlug: "authors", entryId: "a1" },
          { scopeSlug: "authors", entryId: "a2" },
        ]),
      ],
      new Set(["categories:c1"])
    );
    expect(offer.links.map(documentKey)).toEqual(["authors:a1", "authors:a2"]);
  });

  it("offers nothing for documents coming down, links or counts", () => {
    const offer = linkedOffer(
      [
        added("p1", "unpublish", [{ scopeSlug: "authors", entryId: "a1" }], {
          hiddenCount: 2,
          deleted: 1,
        }),
      ],
      new Set()
    );
    expect(offer).toEqual({
      links: [],
      hiddenCount: 0,
      inHiddenFields: 0,
      deletedCount: 0,
    });
  });

  it("adds up what it can only count, across the documents going live", () => {
    const offer = linkedOffer(
      [
        added("p1", "publish", [], { hiddenCount: 1, deleted: 2 }),
        added("p2", "publish", [], { hiddenCount: 2, inHiddenFields: 1 }),
      ],
      new Set()
    );
    expect(offer).toMatchObject({
      hiddenCount: 3,
      inHiddenFields: 1,
      deletedCount: 2,
    });
  });
});
