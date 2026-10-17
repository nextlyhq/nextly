/**
 * Members, a release and reads for the readiness unit tests.
 *
 * The reads default to a release with nothing wrong: every author live and
 * permitted, every document there and valid, nothing else scheduled. A case
 * replaces the one read it is about.
 */
import type {
  ReleaseMemberRow,
  ReleaseRow,
} from "../../../releases-repository";
import { documentRefKey } from "../../../releases-repository";
import type { ReleaseCheckReads } from "../../check-sources";

export function release(over: Partial<ReleaseRow> = {}): ReleaseRow {
  return {
    id: "r1",
    title: "Launch",
    description: null,
    scheduledAt: null,
    timezone: null,
    state: "draft",
    kind: "release",
    publishedAt: null,
    createdBy: "owner",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    revision: 0,
    ...over,
  };
}

export function member(
  id: string,
  over: Partial<ReleaseMemberRow> = {}
): ReleaseMemberRow {
  return {
    id,
    releaseId: "r1",
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId: `entry-${id}`,
    locale: null,
    action: "publish",
    memberKey: `key-${id}`,
    singleSlot: null,
    createdBy: "author",
    createdAt: new Date("2026-01-02T00:00:00Z"),
    ...over,
  };
}

export function reads(
  over: Partial<ReleaseCheckReads> = {}
): ReleaseCheckReads {
  return {
    liveAuthors: async ids => new Set(ids),
    actingAs: async id => ({ id, roles: [] }),
    mayPerform: async () => true,
    existing: async refs => new Set(refs.map(documentRefKey)),
    publishProblems: async () => [],
    heldDraftLocales: async () => [],
    scheduledMemberships: async () => new Map(),
    ...over,
  };
}
