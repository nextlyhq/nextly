/**
 * How the service narrows link findings for a reader, with its link reads
 * injected and their answers scripted:
 * - a page of releases is narrowed in one pass, so a document linked from
 *   several releases gets one verdict in all of them;
 * - what a reader may see of a document's links is judged on the very
 *   document the links were read from, read once;
 * - the link check a call runs is the service's own, whatever is registered
 *   while the call is under way;
 * - every count is of links, a deleted finding by its count (the same from
 *   a document the reader may not read is `narrowLinkFindings`' own case,
 *   since the release's member narrowing then withholds the member whole).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearReleaseCheckSourcesForTests,
  defineReleaseCheckSource,
  registerReleaseCheckSource,
} from "../readiness/check-sources";
import { registerCoreReleaseCheckSources } from "../readiness/core-sources";
import {
  UNPUBLISHED_LINK_CODES,
  type ReleaseLinkReads,
  type ScannedLinks,
} from "../readiness/unpublished-links";
import { documentRefKey } from "../releases-repository";
import {
  ReleasesService,
  type ReleaseDocument,
  type ReleasesServiceDeps,
} from "../services/releases-service";

import { READY_CHECKS } from "./helpers/ready-checks";

const AUTHOR_KEY = documentRefKey({
  scopeKind: "collection",
  scopeSlug: "authors",
  entryId: "a1",
  locale: null,
});

beforeEach(() => {
  clearReleaseCheckSourcesForTests();
  registerCoreReleaseCheckSources();
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

/**
 * Link reads where every post links to the draft author `a1` through the
 * field keyed `k:author`, or, for `deleted`, to five deleted authors.
 */
function linkReads(over: { deleted?: boolean } = {}): ReleaseLinkReads & {
  linksOf: ReturnType<typeof vi.fn>;
  snapshots: Map<string, object>;
} {
  const snapshots = new Map<string, object>();
  return {
    snapshots,
    linksOf: vi.fn(async (_scope: unknown, ids: readonly string[]) => {
      const scanned = new Map<string, ScannedLinks>();
      for (const id of ids) {
        const snapshot = { read: id };
        snapshots.set(id, snapshot);
        const targets = over.deleted ? ["g1", "g2", "g3", "g4", "g5"] : ["a1"];
        scanned.set(id, {
          links: targets.map(entryId => ({
            field: "author",
            fieldKey: "k:author",
            collection: "authors",
            entryId,
          })),
          snapshot,
        });
      }
      return scanned;
    }),
    publishedOf: async (_collection: string, ids: readonly string[]) =>
      new Map(over.deleted ? [] : ids.map(id => [id, false])),
  };
}

function pageService(
  readable: (key: string) => boolean,
  reads: ReleaseLinkReads = linkReads(),
  fieldsVisible: ReadonlySet<string> = new Set(["k:author"])
) {
  const ids = ["r1", "r2", "r3"];
  const members = ids.map((releaseId, i) => member(`m${i}`, releaseId));
  const readableMembers = vi.fn(
    async (documents: readonly ReleaseDocument[]) =>
      new Set(documents.map(d => d.id).filter(readable))
  );
  const visibleLinkFields = vi.fn(
    async (scans: ReadonlyArray<{ id: string; scanned: ScannedLinks }>) =>
      new Map(scans.map(scan => [scan.id, fieldsVisible]))
  );
  const deps = {
    repository: {
      findReleases: async ({ ids: asked }: { ids: string[] }) =>
        asked.map(id => ({
          id,
          state: "draft",
          scheduledAt: null,
          revision: 0,
        })),
      memberCountsOf: async () => new Map(ids.map(id => [id, 1])),
      listMembersInOrderOf: async () => members,
      listMembers: async (releaseId: string) =>
        members.filter(m => m.releaseId === releaseId),
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
    readableMembers,
    linkReads: reads,
    visibleLinkFields,
  } satisfies ReleasesServiceDeps;
  return {
    svc: new ReleasesService(deps),
    ids,
    readableMembers,
    visibleLinkFields,
  };
}

function linkFindings(
  entries: Awaited<ReturnType<ReleasesService["readinessOf"]>>
) {
  return entries.map(entry =>
    entry.checked
      ? entry.soft
          .filter(f => f.source === "core.unpublished-links")
          .map(f => [f.code, f.detail?.entryId ?? f.detail?.count ?? null])
      : null
  );
}

describe("readinessOf narrows a page's links in one pass", () => {
  it("asks once for the page, and names the same readable target in every release", async () => {
    const { svc, ids, readableMembers, visibleLinkFields } = pageService(
      () => true
    );
    const entries = await svc.readinessOf(ids, { userId: "reader" });
    // Two questions for the whole page, whatever its size: the members, then
    // the documents they link to. A member's verdict serves as its links'
    // source, so it is never asked twice.
    expect(readableMembers).toHaveBeenCalledTimes(2);
    expect(
      readableMembers.mock.calls[1]?.[0].map(document => document.id)
    ).toEqual([AUTHOR_KEY]);
    expect(visibleLinkFields).toHaveBeenCalledTimes(1);
    expect(linkFindings(entries)).toEqual([
      [["UNPUBLISHED_LINK", "a1"]],
      [["UNPUBLISHED_LINK", "a1"]],
      [["UNPUBLISHED_LINK", "a1"]],
    ]);
  });

  it("counts the same unreadable target in every release", async () => {
    const { svc, ids } = pageService(key => key !== AUTHOR_KEY);
    const entries = await svc.readinessOf(ids, { userId: "reader" });
    expect(linkFindings(entries)).toEqual([
      [["UNPUBLISHED_LINKS_HIDDEN", "1"]],
      [["UNPUBLISHED_LINKS_HIDDEN", "1"]],
      [["UNPUBLISHED_LINKS_HIDDEN", "1"]],
    ]);
  });
});

describe("a reader's view of links is judged on the document the links came from", () => {
  it("reads each document once, and judges its fields on that same reading", async () => {
    const reads = linkReads();
    const { svc, ids, visibleLinkFields } = pageService(() => true, reads);
    await svc.readinessOf(ids, { userId: "reader" });
    // One read of the posts' scope for the page, never a second for fields.
    expect(reads.linksOf).toHaveBeenCalledTimes(3);
    const judged = visibleLinkFields.mock.calls[0]?.[0] ?? [];
    expect(judged.map(scan => scan.scanned.snapshot)).toEqual([
      reads.snapshots.get("post-m0"),
      reads.snapshots.get("post-m1"),
      reads.snapshots.get("post-m2"),
    ]);
    for (const [index, scan] of judged.entries()) {
      // The same object, not an equal one read again.
      expect(scan.scanned.snapshot).toBe(reads.snapshots.get(`post-m${index}`));
    }
  });
});

describe("a call's link check is the service's own", () => {
  it("is not replaced by a registration made while the call is under way", async () => {
    const impostor = vi.fn(async () => []);
    const reads = linkReads();
    const original = reads.linksOf.getMockImplementation() as
      | ((scope: unknown, ids: readonly string[]) => Promise<unknown>)
      | undefined;
    reads.linksOf.mockImplementation(async (...args: unknown[]) => {
      // Another registration, mid-call, under the link check's own key.
      registerReleaseCheckSource(
        defineReleaseCheckSource({
          key: "core.unpublished-links",
          severity: "soft",
          codes: UNPUBLISHED_LINK_CODES,
          check: impostor,
        })
      );
      return original?.(...(args as [unknown, readonly string[]]));
    });
    const { svc } = pageService(() => true, reads);
    const first = await svc.readiness("r1", { userId: "reader" });
    const second = await svc.readiness("r2", { userId: "reader" });
    for (const answer of [first, second]) {
      expect(
        answer.soft
          .filter(f => f.source === "core.unpublished-links")
          .map(f => [f.code, f.detail?.entryId])
      ).toEqual([["UNPUBLISHED_LINK", "a1"]]);
    }
    expect(impostor).not.toHaveBeenCalled();
  });
});

describe("every count is of links", () => {
  it("counts five deleted links in a field the reader may not view as five", async () => {
    const { svc } = pageService(
      () => true,
      linkReads({ deleted: true }),
      new Set()
    );
    const answer = await svc.readiness("r1", { userId: "reader" });
    expect(
      answer.soft
        .filter(f => f.source === "core.unpublished-links")
        .map(f => [f.code, f.detail?.count])
    ).toEqual([["UNPUBLISHED_LINK_IN_HIDDEN_FIELD", "5"]]);
  });
});
