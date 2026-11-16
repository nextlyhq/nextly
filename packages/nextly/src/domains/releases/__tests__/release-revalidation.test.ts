/**
 * The tags a release's schedule change must flush.
 *
 * @module domains/releases/__tests__/release-revalidation.test
 */
import { describe, expect, it } from "vitest";

import { releaseRevalidationIntent } from "../release-revalidation";
import type { ReleaseMemberRow } from "../releases-repository";

let seq = 0;
function member(over: Partial<ReleaseMemberRow> = {}): ReleaseMemberRow {
  seq += 1;
  return {
    id: `m${seq}`,
    releaseId: "r1",
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId: "e1",
    locale: null,
    action: "publish",
    memberKey: `k${seq}`,
    singleSlot: null,
    createdBy: "author",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...over,
  };
}

describe("releaseRevalidationIntent", () => {
  it("names the collection AND the entry", () => {
    // A listing is cached under the collection tag and a detail page under the
    // entry tag, and a scheduled publish changes what both return — it adds a
    // row to the listing as surely as it changes the document.
    const intent = releaseRevalidationIntent([member()]);

    expect(intent?.tags.sort()).toEqual(
      ["nextly:posts", "nextly:posts:id:e1"].sort()
    );
  });

  it("names a Single by its own tag", () => {
    const intent = releaseRevalidationIntent([
      member({ scopeKind: "single", scopeSlug: "homepage" }),
    ]);

    expect(intent?.tags).toEqual(["nextly:single:homepage"]);
  });

  it("deduplicates across members of one document", () => {
    // A localized document contributes one member per language, and they share
    // a collection tag. A caller issuing the same tag repeatedly is harmless
    // but noisy, and the duplication would grow with the release.
    const intent = releaseRevalidationIntent([
      member({ locale: "en" }),
      member({ locale: "de" }),
    ]);

    expect(intent?.tags.sort()).toEqual(
      ["nextly:posts", "nextly:posts:id:e1"].sort()
    );
  });

  it("is null for a release with no members", () => {
    // Not an empty intent: a revalidation naming nothing is something some
    // backends log as an error, and there is genuinely nothing to flush.
    expect(releaseRevalidationIntent([])).toBeNull();
  });
});

/*
 * A release is one more way to write a document, so its flush follows the same
 * `revalidate` config every other write does: an opted-out collection or Single
 * is skipped exactly, and extra tags are flushed with the rest.
 */
describe("releaseRevalidationIntent, with each scope's revalidate config", () => {
  const configs: Record<string, { disable?: boolean; tags?: string[] }> = {
    "collection:posts": { tags: ["navigation"] },
    "collection:drafts": { disable: true },
    "single:homepage": { tags: ["home-hero"] },
    "single:footer": { disable: true },
  };
  const configFor = (kind: "collection" | "single", slug: string) =>
    configs[`${kind}:${slug}`];

  it("skips exactly the members whose collection or Single opts out", () => {
    const intent = releaseRevalidationIntent(
      [
        member({ scopeSlug: "posts", entryId: "e1" }),
        member({ scopeSlug: "drafts", entryId: "e2" }),
        member({ scopeKind: "single", scopeSlug: "homepage" }),
        member({ scopeKind: "single", scopeSlug: "footer" }),
      ],
      configFor
    );
    expect(intent?.tags.sort()).toEqual(
      [
        "home-hero",
        "navigation",
        "nextly:posts",
        "nextly:posts:id:e1",
        "nextly:single:homepage",
      ].sort()
    );
  });

  it("is null when every member opts out", () => {
    expect(
      releaseRevalidationIntent(
        [
          member({ scopeSlug: "drafts" }),
          member({ scopeKind: "single", scopeSlug: "footer" }),
        ],
        configFor
      )
    ).toBeNull();
  });

  it("asks a page member's config as a collection entry's", () => {
    const asked: string[] = [];
    releaseRevalidationIntent(
      [member({ scopeKind: "page", scopeSlug: "pages" })],
      (kind, slug) => {
        asked.push(`${kind}:${slug}`);
        return undefined;
      }
    );
    expect(asked).toEqual(["collection:pages"]);
  });
});
