/**
 * How a release's page groups its documents, and what it calls each one.
 *
 * @module components/features/releases/__tests__/release-documents.test
 */
import { describe, expect, it } from "vitest";

import type { ReleaseMember } from "@admin/types/releases";

import {
  documentLabel,
  documentStatusLine,
  groupReleaseDocuments,
} from "../release-documents";

function member(id: string, scopeSlug: string): ReleaseMember {
  return {
    id,
    releaseId: "r1",
    scopeKind: "collection",
    scopeSlug,
    entryId: `${id}-entry`,
    locale: null,
    action: "publish",
    createdBy: "u1",
    createdAt: "2026-10-20T09:00:00Z",
  };
}

const names = (slug: string) =>
  slug === "posts" ? { singular: "Post", plural: "Posts" } : undefined;

describe("groupReleaseDocuments", () => {
  it("groups by collection, in the order the release first took one from each", () => {
    const groups = groupReleaseDocuments({
      members: [
        member("m1", "posts"),
        member("m2", "pages"),
        member("m3", "posts"),
      ],
      scopeNamesOf: names,
    });
    expect(groups.map(g => [g.heading, g.members.map(m => m.id)])).toEqual([
      ["Posts", ["m1", "m3"]],
      ["Pages", ["m2"]],
    ]);
  });

  it("counts hidden documents in their collection's group, or a group of their own", () => {
    const groups = groupReleaseDocuments({
      members: [member("m1", "posts")],
      hidden: [
        {
          scopeKind: "collection",
          scopeSlug: "posts",
          count: 2,
          labels: { singular: "Post", plural: "Posts" },
        },
        {
          scopeKind: "collection",
          scopeSlug: "secret-notes",
          count: 1,
          labels: { singular: "Secret note", plural: "Secret notes" },
        },
      ],
      hiddenProblems: [
        {
          scopeKind: "collection",
          scopeSlug: "posts",
          count: 2,
          hard: 1,
          soft: 0,
        },
      ],
      scopeNamesOf: names,
    });
    expect(groups).toMatchObject([
      {
        heading: "Posts",
        total: 3,
        hiddenLine:
          "2 documents can't be shown (deleted, or you can't view them)",
        hiddenNeedFix: 1,
      },
      {
        heading: "Secret notes",
        total: 1,
        members: [],
        hiddenLine: "1 document can't be shown (deleted, or you can't view it)",
      },
    ]);
  });
});

describe("documentLabel and documentStatusLine", () => {
  const info = {
    title: "Launch post",
    status: "draft" as const,
    everPublished: false,
    updatedAt: null,
  };

  it("names a document by its title, and says so when it has none", () => {
    const state = { pending: false, failed: false, singular: "Post" };
    expect(documentLabel(info, state)).toEqual({
      text: "Launch post",
      muted: false,
    });
    expect(documentLabel({ ...info, title: null }, state)).toEqual({
      text: "Untitled",
      muted: true,
    });
    expect(documentLabel(undefined, state).text).toBe("Deleted document");
    expect(documentLabel(undefined, { ...state, pending: true }).text).toBe(
      "Loading…"
    );
  });

  it("says where a document stands now", () => {
    expect(documentStatusLine(info)).toBe("Draft, never published");
    expect(documentStatusLine({ ...info, everPublished: true })).toBe(
      "Draft, not published now"
    );
    expect(documentStatusLine({ ...info, status: "published" })).toBe(
      "Published"
    );
    expect(documentStatusLine({ ...info, status: null })).toBeNull();
  });
});
