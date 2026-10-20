/**
 * How the service narrows link findings for a reader across a page of
 * releases: one readability question and one field question for the whole
 * page, so a document linked from several releases gets one verdict in all of
 * them.
 *
 * The link source is replaced by one that reports the same linked author from
 * every member, so what the page answers depends only on the narrowing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearReleaseCheckSourcesForTests,
  defineReleaseCheckSource,
  registerReleaseCheckSource,
} from "../readiness/check-sources";
import { registerCoreReleaseCheckSources } from "../readiness/core-sources";
import { UNPUBLISHED_LINK_CODES } from "../readiness/unpublished-links";
import { documentRefKey } from "../releases-repository";
import {
  ReleasesService,
  type ReleasesServiceDeps,
} from "../services/releases-service";

import { READY_CHECKS } from "./helpers/ready-checks";

const AUTHOR_KEY = documentRefKey({
  scopeKind: "collection",
  scopeSlug: "authors",
  entryId: "a1",
  locale: null,
});

/** Reports, for every member, a link to the draft author `a1`. */
const SAME_AUTHOR_EVERYWHERE = defineReleaseCheckSource({
  key: "core.unpublished-links",
  severity: "soft",
  codes: UNPUBLISHED_LINK_CODES,
  check: async batch =>
    batch.map(member => ({
      memberId: member.id,
      code: "UNPUBLISHED_LINK" as const,
      detail: {
        scopeKind: "collection",
        scopeSlug: "authors",
        entryId: "a1",
        fields: ["author"],
        cause: "draft",
      },
    })),
});

beforeEach(() => {
  clearReleaseCheckSourcesForTests();
  registerCoreReleaseCheckSources();
  registerReleaseCheckSource(SAME_AUTHOR_EVERYWHERE);
});

afterEach(() => {
  clearReleaseCheckSourcesForTests();
  registerCoreReleaseCheckSources();
});

function member(id: string, releaseId: string) {
  return {
    id,
    releaseId,
    scopeKind: "collection" as const,
    scopeSlug: "posts",
    entryId: `post-${id}`,
    locale: null,
    action: "publish" as const,
    memberKey: `key-${id}`,
    singleSlot: null,
    createdBy: "author",
    createdAt: new Date("2026-01-02T00:00:00Z"),
  };
}

function pageService(readable: (key: string) => boolean) {
  const ids = ["r1", "r2", "r3"];
  const members = ids.map((releaseId, i) => member(`m${i}`, releaseId));
  const readableDocuments = vi.fn(
    async (documents: readonly { id: string }[]) =>
      new Set(documents.map(d => d.id).filter(readable))
  );
  const visibleLinkFields = vi.fn(
    async (documents: readonly { id: string }[]) =>
      new Map(documents.map(d => [d.id, new Set(["author"])]))
  );
  const deps = {
    repository: {
      findReleases: async () =>
        ids.map(id => ({
          id,
          state: "draft",
          scheduledAt: null,
          revision: 0,
        })),
      memberCountsOf: async () => new Map(ids.map(id => [id, 1])),
      listMembersInOrderOf: async () => members,
      listMembers: async () => [],
      liveAuthors: async (authors: string[]) => new Set(authors),
      findDueMembersFor: async () => new Map(),
    } as unknown as ReleasesServiceDeps["repository"],
    canManageReleases: async () => true,
    targets: {
      readDocument: async () => ({}),
      declaresLifecycle: async () => true,
    },
    canActOnDocument: async () => true,
    runDrainNow: async () => undefined,
    checks: READY_CHECKS,
    readableDocuments,
    visibleLinkFields,
  } satisfies ReleasesServiceDeps;
  return {
    svc: new ReleasesService(deps),
    ids,
    readableDocuments,
    visibleLinkFields,
  };
}

function linkCodes(
  entries: Awaited<ReturnType<ReleasesService["readinessOf"]>>
) {
  return entries.map(entry =>
    entry.checked
      ? entry.soft
          .filter(f => f.source === "core.unpublished-links")
          .map(f => [f.code, f.detail?.entryId ?? null])
      : null
  );
}

describe("readinessOf narrows a page's links in one pass", () => {
  it("asks once for the page, and names the same readable target in every release", async () => {
    const { svc, ids, readableDocuments, visibleLinkFields } = pageService(
      () => true
    );
    const entries = await svc.readinessOf(ids, { userId: "reader" });
    expect(readableDocuments).toHaveBeenCalledTimes(1);
    expect(visibleLinkFields).toHaveBeenCalledTimes(1);
    expect(linkCodes(entries)).toEqual([
      [["UNPUBLISHED_LINK", "a1"]],
      [["UNPUBLISHED_LINK", "a1"]],
      [["UNPUBLISHED_LINK", "a1"]],
    ]);
  });

  it("counts the same unreadable target in every release", async () => {
    const { svc, ids, readableDocuments } = pageService(
      key => key !== AUTHOR_KEY
    );
    const entries = await svc.readinessOf(ids, { userId: "reader" });
    expect(readableDocuments).toHaveBeenCalledTimes(1);
    expect(linkCodes(entries)).toEqual([
      [["UNPUBLISHED_LINKS_HIDDEN", null]],
      [["UNPUBLISHED_LINKS_HIDDEN", null]],
      [["UNPUBLISHED_LINKS_HIDDEN", null]],
    ]);
  });
});
