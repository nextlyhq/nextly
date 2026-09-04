/**
 * `system:versions` — what it asks, and who it asks it for.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const countPendingEdits = vi.fn();
const recentPendingEdits = vi.fn();
const has = vi.fn();
const readable = vi.fn();
const registeredSlugs = vi.fn();
const visible = vi.fn();

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
// A PASS-THROUGH, so the assertions below stay about what this module decides:
// which collections are in reach, and what it answers with. The document-level
// filter it stands in for reaches the ordinary read path and a stored access
// rule, neither of which exists in a unit harness --
// `pending-edits-document-rules.integration.test.ts` drives the real one
// against a real database and a real owner-only rule. The final test in this
// block is what keeps the substitution honest: it asserts the rows and the
// caller actually reach this seam, so deleting the call is not a green.
vi.mock("../pending-edit-visibility", () => ({
  visiblePendingEdits: (rows: unknown, caller: unknown) =>
    visible(rows, caller) as unknown,
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
  visible.mockImplementation((rows: unknown) => Promise.resolve(rows));
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

  it("hands every candidate row, and the caller, to the document filter", async () => {
    // 🔴 Entity access is one axis short: a stored owner-only or custom read
    // rule narrows which of a collection's documents come back, and a version
    // read filtered by collection name alone reported another author's entry
    // ids and edit times. The caller has to reach that decision too -- an id
    // cannot be judged against a rule written about a key's own scope.
    await executeWidgetQuery(
      { source: VERSIONS_SOURCE_ID, op: "list" },
      caller
    );

    expect(visible).toHaveBeenCalledWith([row], caller);
  });

  it("refuses a COUNT it cannot answer exactly, rather than reporting a floor", async () => {
    // 🔴 Row rules cannot be applied in SQL -- the rule lives on the collection,
    // the candidates live in the version table, and the port has no join -- so
    // an exact count means materialising candidates, which is bounded work. Past
    // the bound the honest answers are "refuse" or "report a number that is
    // quietly too small", and a metric that under-reports is the defect this
    // module was repaired for.
    countPendingEdits.mockResolvedValue(1001);

    await expect(
      executeWidgetQuery({ source: VERSIONS_SOURCE_ID, op: "count" }, caller)
    ).rejects.toThrow();
    expect(recentPendingEdits).not.toHaveBeenCalled();
  });

  it("answers a COUNT that sits exactly ON the bound", async () => {
    // The boundary control. Comparing the FETCHED length instead of the total
    // cannot tell "exactly at the bound" from "beyond it", and would refuse a
    // set it could have answered.
    countPendingEdits.mockResolvedValue(1000);

    await expect(
      executeWidgetQuery({ source: VERSIONS_SOURCE_ID, op: "count" }, caller)
    ).resolves.toMatchObject({ op: "count" });
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
