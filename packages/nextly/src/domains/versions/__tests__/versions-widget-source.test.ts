/**
 * `system:versions` — what it asks, and who it asks it for.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const countPendingEdits = vi.fn();
const recentPendingEdits = vi.fn();
const has = vi.fn();
const allowlist = vi.fn();

vi.mock("../../../di/container", () => ({
  container: {
    has: (name: string) => has(name) as boolean,
    get: () => ({ countPendingEdits, recentPendingEdits }),
  },
}));
vi.mock("../../../services/lib/readable-slug-allowlist", () => ({
  readableSlugAllowlist: (id: string | undefined) => allowlist(id) as unknown,
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
  allowlist.mockResolvedValue(["posts"]);
  clearSources();
  clearSystemResolvers();
  registerVersionsWidgetSource();
});

describe("who the numbers are for", () => {
  it("bounds the COUNT to the collections this caller may read", async () => {
    // 🔴 The access decision lives here, unlike `system:releases`, because
    // `VersionsService` has no authorization of its own -- none of its methods
    // takes an actor. A resolver that simply called it would answer an
    // install-wide number to a reader entitled to part of it.
    await executeWidgetQuery(
      { source: VERSIONS_SOURCE_ID, op: "count" },
      caller
    );

    expect(allowlist).toHaveBeenCalledWith("user-1");
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

  it("passes an EMPTY allowlist through, rather than reading it as no filter", async () => {
    // 🔴 The three answers stay distinct. `[]` means "no readable collections"
    // and must reach the repository as `[]`; reading it as "no filter" is one
    // `?.length` away and hands every document to a caller granted none.
    allowlist.mockResolvedValue([]);
    await executeWidgetQuery(
      { source: VERSIONS_SOURCE_ID, op: "count" },
      caller
    );

    expect(countPendingEdits).toHaveBeenCalledWith([]);
  });

  it("passes undefined through for a caller with no filter at all", async () => {
    // The control: a super admin resolves to `undefined`, which must NOT become
    // `[]` on the way -- that would answer zero for the one caller who may see
    // everything.
    allowlist.mockResolvedValue(undefined);
    await executeWidgetQuery(
      { source: VERSIONS_SOURCE_ID, op: "count" },
      caller
    );

    expect(countPendingEdits).toHaveBeenCalledWith(undefined);
  });

  it("resolves the allowlist ONCE per query", async () => {
    // Two resolutions of one caller's permissions are two chances to disagree,
    // and each is a database read.
    await executeWidgetQuery(
      { source: VERSIONS_SOURCE_ID, op: "list" },
      caller
    );
    expect(allowlist).toHaveBeenCalledTimes(1);
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
