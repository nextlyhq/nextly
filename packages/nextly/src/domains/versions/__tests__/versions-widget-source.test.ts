/**
 * `system:versions` — what it asks, and who it asks it for.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const countPendingEdits = vi.fn();
const recentPendingEdits = vi.fn();
const has = vi.fn();
const readable = vi.fn();
const registeredSlugs = vi.fn();

vi.mock("../../../di/container", () => ({
  container: {
    has: (name: string) => has(name) as boolean,
    get: () => ({ countPendingEdits, recentPendingEdits }),
  },
}));
// `readAccessCaller` is kept REAL and only the decision is replaced, so what
// these tests assert is the caller shape the source actually derives —
// substituting the conversion too would let the source pass anything and still
// satisfy an expectation written from the same wrong idea.
vi.mock("../../../auth/entity-read-access", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../auth/entity-read-access")
  >()),
  readableEntities: (slugs: readonly string[], caller: unknown) =>
    readable(slugs, caller) as unknown,
}));
vi.mock("../../../services/lib/registered-content-slugs", () => ({
  registeredContentSlugs: () => registeredSlugs() as unknown,
}));

import { executeWidgetQuery } from "../../widgets/execute";
import { clearSources } from "../../widgets/sources";
import { clearSystemResolvers } from "../../widgets/system-sources";
import {
  VERSIONS_SOURCE_ID,
  registerVersionsWidgetSource,
} from "../versions-widget-source";

const caller = { user: { id: "user-1", roles: ["editor"] } };

const row = {
  id: "v1",
  scopeKind: "collection",
  scopeSlug: "posts",
  entryId: "e1",
  locale: "en",
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  versionNo: null,
  status: "draft",
  isAutosave: false,
  label: null,
  sourceVersionNo: null,
  createdBy: "someone-else",
  createdAt: new Date("2020-01-01T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  has.mockReturnValue(true);
  countPendingEdits.mockResolvedValue(14);
  recentPendingEdits.mockResolvedValue([row]);
  readable.mockResolvedValue(new Set(["posts"]));
  registeredSlugs.mockResolvedValue(["posts", "secrets"]);
  clearSources();
  clearSystemResolvers();
  registerVersionsWidgetSource();
});

describe("who the numbers are for", () => {
  it("bounds the COUNT to the entities this caller may read", async () => {
    // 🔴 The access decision lives here, unlike `system:releases`, because
    // `VersionsService` has no authorization of its own -- none of its methods
    // takes an actor. A resolver that simply called it would answer an
    // install-wide number to a reader entitled to part of it.
    await executeWidgetQuery(
      { source: VERSIONS_SOURCE_ID, op: "count" },
      caller
    );

    expect(readable).toHaveBeenCalledWith(
      ["posts", "secrets"],
      expect.objectContaining({ userId: "user-1" })
    );
    expect(countPendingEdits).toHaveBeenCalledWith(["posts"]);
  });

  it("bounds the LIST the same way", async () => {
    await executeWidgetQuery(
      { source: VERSIONS_SOURCE_ID, op: "list" },
      caller
    );

    expect(recentPendingEdits).toHaveBeenCalledWith(
      expect.objectContaining({ readableSlugs: ["posts"] })
    );
  });

  it("judges an API KEY on its OWN stamped scope, not its owner's roles", async () => {
    // 🔴 The separating case. Resolving the OWNER's role-derived slugs hands a
    // narrowly scoped key everything its minter can read -- and a key minted by
    // a super admin the whole install, since that bypass belongs to the session
    // path. The whole caller has to reach the decision, not just an id.
    await executeWidgetQuery(
      { source: VERSIONS_SOURCE_ID, op: "count" },
      {
        user: { id: "owner-1", roles: ["super-admin"] },
        authenticatedScope: {
          actorType: "apiKey" as const,
          permissions: ["read-posts"],
        },
      }
    );

    expect(readable).toHaveBeenCalledWith(["posts", "secrets"], {
      userId: "owner-1",
      authMethod: "api-key",
      permissions: ["read-posts"],
      roles: ["super-admin"],
    });
  });

  it("answers a caller who may read nothing with an EMPTY list, not everything", async () => {
    // 🔴 There is no value meaning "no filter" any more: the answer is always
    // enumerated, so nothing readable arrives as `[]` and the service reads it
    // as exactly nothing.
    readable.mockResolvedValue(new Set());
    await executeWidgetQuery(
      { source: VERSIONS_SOURCE_ID, op: "count" },
      caller
    );

    expect(countPendingEdits).toHaveBeenCalledWith([]);
  });

  it("asks the access layer ONCE per query", async () => {
    // Two resolutions of one caller's permissions are two chances to disagree,
    // and each is a round of database reads.
    await executeWidgetQuery(
      { source: VERSIONS_SOURCE_ID, op: "list" },
      caller
    );
    expect(readable).toHaveBeenCalledTimes(1);
  });
});

describe("what it answers with", () => {
  it("publishes only its declared fields, never the snapshot", async () => {
    // 🔴 A version row's snapshot IS the document's unpublished content. The
    // source's field list is the allowlist a query is checked against, so a row
    // returned whole would hand every reader the draft body of every document.
    const result = await executeWidgetQuery(
      { source: VERSIONS_SOURCE_ID, op: "list" },
      caller
    );
    const [item] = (result as { items: Record<string, unknown>[] }).items;
    expect(Object.keys(item).sort()).toEqual([
      "entryId",
      "locale",
      "scopeSlug",
      "updatedAt",
    ]);
  });

  it("describes the fields in the order the QUERY asked for them", async () => {
    // 🔴 The table archetype draws its columns straight off this array, so
    // rebuilding it in declaration order renders the reverse of what the
    // widget's author wrote -- with nothing anywhere reporting a disagreement.
    const result = await executeWidgetQuery(
      {
        source: VERSIONS_SOURCE_ID,
        op: "list",
        select: ["updatedAt", "scopeSlug"],
      },
      caller
    );

    expect(
      (result as { fields: { name: string }[] }).fields.map(f => f.name)
    ).toEqual(["updatedAt", "scopeSlug"]);
  });

  it("collapses a repeated selection into one column", async () => {
    // A legal selection whose projection is one value; two descriptors would
    // have a table draw two columns for it.
    const result = await executeWidgetQuery(
      {
        source: VERSIONS_SOURCE_ID,
        op: "list",
        select: ["scopeSlug", "scopeSlug"],
      },
      caller
    );

    expect(
      (result as { fields: { name: string }[] }).fields.map(f => f.name)
    ).toEqual(["scopeSlug"]);
  });

  it("refuses a field it cannot honour, rather than dropping it", async () => {
    await expect(
      executeWidgetQuery(
        { source: VERSIONS_SOURCE_ID, op: "list", status: "draft" },
        caller
      )
    ).rejects.toThrow(/unavailable source or unsupported op/);
    expect(recentPendingEdits).not.toHaveBeenCalled();
  });
});
