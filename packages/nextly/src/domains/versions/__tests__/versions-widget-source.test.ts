/**
 * `system:versions` — what it asks, and who it asks it for.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const pendingEditRows = vi.fn();
const has = vi.fn();
const readable = vi.fn();
const registeredSlugs = vi.fn();
const visible = vi.fn();

vi.mock("../../../di/container", () => ({
  container: {
    has: (name: string) => has(name) as boolean,
    get: () => ({ pendingEditRows }),
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
  pendingEditRows.mockResolvedValue([row]);
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
    expect(pendingEditRows).toHaveBeenCalledWith(
      expect.objectContaining({ readableSlugs: ["posts"] })
    );
  });

  it("bounds the LIST the same way", async () => {
    await executeWidgetQuery(
      { source: VERSIONS_SOURCE_ID, op: "list" },
      caller
    );

    expect(pendingEditRows).toHaveBeenCalledWith(
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

    expect(pendingEditRows).toHaveBeenCalledWith(
      expect.objectContaining({ readableSlugs: [] })
    );
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

  /*
   * Three tests stood here, and the behaviour they described is GONE.
   *
   * They required an exact count at a document quota, an exact count once every
   * candidate had been met, and a refusal past the bound. All three belonged to
   * a design that promised an exact number over a set the database cannot
   * filter — and every mechanism that tried to keep that promise past a bound
   * produced a wrong answer instead: a quota could not tell "exactly this many"
   * from "more than this many", and a shortcut on documents already met
   * conflated SEEING a document with DECIDING it, since authorization is per
   * language. The count says `atLeast` now, so there is no quota to sit on and
   * no refusal to provoke.
   */

  it("counts every visible document when the rows run out", async () => {
    // Exhaustion is the ROWS running out and nothing else. The count walks by
    // identity, which is stable: a working-draft update rewrites the snapshot
    // and the instant, never the id, so the enumeration cannot be outrun by the
    // rows it is enumerating.
    const many = Array.from({ length: 250 }, (_, index) => ({
      ...row,
      entryId: `e${index}`,
      id: `v${index}`,
    }));
    let served = 0;
    pendingEditRows.mockImplementation(({ limit }: { limit: number }) => {
      const page = many.slice(served, served + limit);
      served += page.length;
      return Promise.resolve(page);
    });
    visible.mockImplementation((page: unknown) => Promise.resolve(page));

    await expect(
      executeWidgetQuery({ source: VERSIONS_SOURCE_ID, op: "count" }, caller)
    ).resolves.toEqual({ op: "count", total: 250 });
  });

  it("counts by IDENTITY, not by recency", async () => {
    // 🔴 A count enumerates; it does not rank. `updatedAt` advances every time
    // somebody types, so a draft not yet read can move AHEAD of a recency cursor
    // and be excluded from every later page — a guaranteed miss for the rest of
    // the walk, which makes the total silently too small.
    await executeWidgetQuery(
      { source: VERSIONS_SOURCE_ID, op: "count" },
      caller
    );

    expect(pendingEditRows).toHaveBeenCalledWith(
      expect.objectContaining({ order: "identity" })
    );
  });

  it("says AT LEAST when the row budget binds, rather than refusing", async () => {
    let issued = 0;
    pendingEditRows.mockImplementation(({ limit }: { limit: number }) =>
      Promise.resolve(
        Array.from({ length: limit }, () => ({
          ...row,
          entryId: `e${issued++}`,
          id: `v${issued}`,
        }))
      )
    );
    visible.mockImplementation((page: unknown) => Promise.resolve(page));

    const result = await executeWidgetQuery(
      { source: VERSIONS_SOURCE_ID, op: "count" },
      caller
    );

    expect(result).toMatchObject({ op: "count", atLeast: true });
    // The floor is what the walk actually saw.
    expect((result as { total: number }).total).toBe(2000);
  });

  it("does not mark a whole count as a floor", async () => {
    // The control: `atLeast` must be absent when the rows ran out, or every
    // card renders `N+` forever and the flag stops meaning anything.
    const result = await executeWidgetQuery(
      { source: VERSIONS_SOURCE_ID, op: "count" },
      caller
    );

    expect(result).not.toHaveProperty("atLeast");
  });

  it("authorizes each LOCALE row, then keeps the newest one that survives", async () => {
    // 🔴 The ordering property, and the reason the collapse moved out of the
    // read. A document is one thing to publish across every language it is
    // drafted in, but a localized Single is authorized PER language -- so
    // collapsing before the decision offers the filter each document's newest
    // locale alone. Where that one is denied and an older one is readable, the
    // document disappears from a card its reader is entitled to see.
    const newer = { ...row, locale: "fr", updatedAt: new Date("2026-02-01") };
    const older = { ...row, locale: "en", updatedAt: new Date("2026-01-01") };
    pendingEditRows.mockResolvedValue([newer, older]);
    // The newest locale is refused; the older one survives.
    visible.mockResolvedValue([older]);

    const result = await executeWidgetQuery(
      { source: VERSIONS_SOURCE_ID, op: "list", limit: 5 },
      caller
    );

    // BOTH locale rows must reach the decision -- handing it one is the defect.
    expect(visible).toHaveBeenCalledWith([newer, older], caller);
    const items = (result as unknown as { items: { locale: string }[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.locale).toBe("en");
  });

  it("reads another page when the first cannot fill the card", async () => {
    // Rows, not documents, are what a page holds: a document contributes one
    // row per locale and a row a rule hides contributes nothing, so a page can
    // yield fewer documents than it has rows. Answering from one page would
    // report the end of the feed rather than the end of that page.
    pendingEditRows
      .mockResolvedValueOnce(Array.from({ length: 100 }, () => row))
      .mockResolvedValueOnce([row]);
    visible.mockResolvedValueOnce([]).mockResolvedValueOnce([row]);

    await executeWidgetQuery(
      { source: VERSIONS_SOURCE_ID, op: "list", limit: 5 },
      caller
    );

    expect(pendingEditRows).toHaveBeenCalledTimes(2);
    // The second read continues from the LAST ROW of the first rather than from
    // a count of rows already seen, so a row that moved cannot shift the window.
    expect(pendingEditRows).toHaveBeenLastCalledWith(
      expect.objectContaining({
        after: { updatedAt: row.updatedAt, id: row.id },
      })
    );
  });

  it("stops at the end of the table rather than paging past it", async () => {
    // 🔴 The control that makes the test above mean something. A SHORT page is
    // the end of the rows, so a card that could not be filled from it is
    // genuinely short -- paging on would re-ask an exhausted table on every
    // dashboard load.
    pendingEditRows.mockResolvedValue([row]);
    visible.mockResolvedValue([]);

    await executeWidgetQuery(
      { source: VERSIONS_SOURCE_ID, op: "list", limit: 5 },
      caller
    );

    expect(pendingEditRows).toHaveBeenCalledTimes(1);
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
    expect(pendingEditRows).not.toHaveBeenCalled();
  });
});
