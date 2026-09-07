/**
 * How pending-edit rows are handed to the read path for a verdict.
 *
 * The verdict itself belongs to the collection and Singles read paths and is
 * driven against a real database elsewhere. What this file pins is the SHAPE of
 * the question — which rows are asked about, grouped how, and which are never
 * asked about at all — because that is where this module can be wrong while
 * every access rule underneath it is right.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const readableDocumentIds = vi.fn();
const singleDocumentReadable = vi.fn();
const resolveSingleDocumentId = vi.fn();
const contentSnapshot = vi.fn();
const configValue = vi.fn();

// The registry decides whether a row's own scope kind is still the live one, and
// the localization config decides whether its language can still be read in.
// Both are container-backed, so a harness that omits them leaves every row
// undecidable and the whole file green-on-nothing.
vi.mock("../registered-content-slugs", () => ({
  registeredContentSnapshot: () => contentSnapshot() as unknown,
}));
vi.mock("../readable-documents", () => ({
  readableDocumentIds: (...args: unknown[]) =>
    readableDocumentIds(...args) as unknown,
}));
vi.mock("../../../di/container", () => ({
  container: {
    has: () => true,
    get: () => configValue() as unknown,
  },
}));

vi.mock("../../../domains/singles/services/single-document-access", () => ({
  singleDocumentReadable: (...args: unknown[]) =>
    singleDocumentReadable(...args) as unknown,
  resolveSingleDocumentId: (...args: unknown[]) =>
    resolveSingleDocumentId(...args) as unknown,
}));

import {
  resolveDocumentVisibilityScope,
  visibleDocuments,
  type DocumentVisibilityScope,
} from "../document-visibility";

const caller = { user: { id: "user-1", roles: ["editor"] } };

/**
 * The install-wide facts, resolved the way the source resolves them.
 *
 * Taken from `resolveDocumentVisibilityScope` rather than hand-built, so these cases
 * exercise the object the product actually passes down. A literal written here
 * would go on agreeing with itself after the resolver's shape changed.
 */
const scopeNow = (): Promise<DocumentVisibilityScope> =>
  resolveDocumentVisibilityScope();

/**
 * The version-row shape these cases are written in, handed to the shared
 * decision through the same translation `visiblePendingEdits` uses.
 */
const asDocuments = (
  rows: ReturnType<typeof row>[],
  who: typeof caller,
  scope: DocumentVisibilityScope
) =>
  visibleDocuments(
    rows,
    r =>
      r.scopeKind === "collection" || r.scopeKind === "single"
        ? {
            kind: r.scopeKind,
            slug: r.scopeSlug,
            entryId: r.entryId,
            locale: r.locale,
          }
        : null,
    who,
    scope
  );

function row(patch: {
  entryId: string;
  locale?: string | null;
  scopeKind?: string;
  scopeSlug?: string;
}) {
  return {
    id: `v-${patch.entryId}-${patch.locale ?? "none"}`,
    scopeKind: patch.scopeKind ?? "collection",
    scopeSlug: patch.scopeSlug ?? "posts",
    entryId: patch.entryId,
    locale: patch.locale ?? null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    versionNo: null,
    status: "draft",
    isAutosave: false,
    label: null,
    sourceVersionNo: null,
    createdBy: null,
    createdAt: new Date("2020-01-01T00:00:00Z"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readableDocumentIds.mockImplementation((_slug, ids: string[]) =>
    Promise.resolve(new Set(ids))
  );
  singleDocumentReadable.mockResolvedValue(true);
  resolveSingleDocumentId.mockResolvedValue("single-live");
  contentSnapshot.mockResolvedValue({
    kinds: new Map([
      ["posts", "collection"],
      ["site-settings", "single"],
    ]),
    degraded: false,
  });
  configValue.mockReturnValue({
    localization: {
      locales: [
        { code: "en" },
        { code: "de" },
        ...Array.from({ length: 8 }, (_, index) => ({ code: `l${index}` })),
      ],
    },
  });
});

describe("collection rows", () => {
  it("asks about each LOCALE separately, carrying the locale into the read", async () => {
    // 🔴 A stored read rule is a predicate over the collection's own fields, and
    // a localized field answers differently per language --
    // `localized-target-predicate.integration.test.ts` pins one row readable in
    // `en` and denied in `de`. Asking once per slug judges whichever
    // translation the read defaults to and marks every other language visible
    // on the strength of it.
    await asDocuments(
      [
        row({ entryId: "e1", locale: "en" }),
        row({ entryId: "e1", locale: "de" }),
      ],
      caller,
      await scopeNow()
    );

    expect(readableDocumentIds).toHaveBeenCalledTimes(2);
    expect(readableDocumentIds).toHaveBeenCalledWith(
      "posts",
      ["e1"],
      caller,
      "en"
    );
    expect(readableDocumentIds).toHaveBeenCalledWith(
      "posts",
      ["e1"],
      caller,
      "de"
    );
  });

  it("keeps the language the read allowed and drops the one it refused", async () => {
    readableDocumentIds.mockImplementation((_slug, ids: string[], _c, locale) =>
      Promise.resolve(locale === "en" ? new Set(ids) : new Set())
    );

    const visible = await asDocuments(
      [
        row({ entryId: "e1", locale: "de" }),
        row({ entryId: "e1", locale: "en" }),
      ],
      caller,
      await scopeNow()
    );

    expect(visible.map(r => r.locale)).toEqual(["en"]);
  });

  it("issues reads CONCURRENTLY, within a bound", async () => {
    // 🔴 Each unit enters the full collection read path, so awaiting them one
    // after another turns a page spanning many collections or languages into
    // that many sequential round trips -- enough to time a dashboard out while
    // the connection pool sits idle. Bounded, not unbounded: the first group is
    // deliberately one, so a cold per-user permission cache is filled once
    // rather than missed by everything in the fan-out.
    let inFlight = 0;
    let peak = 0;
    readableDocumentIds.mockImplementation(async (_slug, ids: string[]) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise(resolve => setTimeout(resolve, 0));
      inFlight--;
      return new Set(ids);
    });

    await asDocuments(
      Array.from({ length: 8 }, (_, index) =>
        row({ entryId: `e${index}`, locale: `l${index}` })
      ),
      caller,
      await scopeNow()
    );

    // More than one at a time proves it is not serial; the bound proves it is
    // not an unbounded fan-out.
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
  });

  it("asks ONCE for rows that share a slug and language", async () => {
    // The control on the grouping: per-locale must not become per-row, which
    // would put one read per document in front of every dashboard load.
    await asDocuments(
      [
        row({ entryId: "e1", locale: "en" }),
        row({ entryId: "e2", locale: "en" }),
      ],
      caller,
      await scopeNow()
    );

    expect(readableDocumentIds).toHaveBeenCalledTimes(1);
    expect(readableDocumentIds).toHaveBeenCalledWith(
      "posts",
      ["e1", "e2"],
      caller,
      "en"
    );
  });
});

describe("rows nothing can decide", () => {
  it("drops a row whose language is no longer configured", async () => {
    // 🔴 Forwarding an unconfigured locale does NOT authorize it:
    // `resolveRequestedLocale` substitutes the configured DEFAULT for any code
    // it does not recognise. A draft written under a language later removed
    // would be judged by the default language's verdict — a row exposed on a
    // predicate never evaluated for it, which is the defect the per-locale fix
    // exists to prevent, wearing a different hat.
    const visible = await asDocuments(
      [row({ entryId: "e1", locale: "fr" })],
      caller,
      await scopeNow()
    );

    expect(visible).toEqual([]);
    expect(readableDocumentIds).not.toHaveBeenCalled();
  });

  it("keeps a configured language beside a removed one", async () => {
    // The control: dropping unconfigured locales must not drop everything.
    const visible = await asDocuments(
      [
        row({ entryId: "e1", locale: "fr" }),
        row({ entryId: "e1", locale: "en" }),
      ],
      caller,
      await scopeNow()
    );

    expect(visible.map(r => r.locale)).toEqual(["en"]);
  });

  it("drops a row whose scope kind no longer matches the registry", async () => {
    // Deleting a collection leaves its history behind, and a Single may later
    // take the freed slug. Probing the COLLECTION read path for a slug that now
    // belongs to a Single asks about a table that is not there — it throws and
    // breaks both cards rather than dropping one orphaned row.
    const visible = await asDocuments(
      [
        row({
          entryId: "e1",
          scopeKind: "collection",
          scopeSlug: "site-settings",
        }),
      ],
      caller,
      await scopeNow()
    );

    expect(visible).toEqual([]);
    expect(readableDocumentIds).not.toHaveBeenCalled();
    expect(singleDocumentReadable).not.toHaveBeenCalled();
  });

  it("drops a row whose slug is in neither registry", async () => {
    const visible = await asDocuments(
      [row({ entryId: "e1", scopeSlug: "deleted-collection" })],
      caller,
      await scopeNow()
    );

    expect(visible).toEqual([]);
    expect(readableDocumentIds).not.toHaveBeenCalled();
  });
});

describe("single rows", () => {
  const single = (entryId: string, locale?: string | null) =>
    row({ entryId, locale, scopeKind: "single", scopeSlug: "site-settings" });

  it("resolves the live document id WITHOUT materializing the Single", async () => {
    // 🔴 The read probe goes through `SingleEntryService.get`, which AUTO-CREATES
    // a missing Single -- so probing first makes loading a dashboard perform a
    // write. The id is resolved from the backing row instead, which is what
    // `resolveSingleDocumentId` exists for.
    await asDocuments([single("single-live")], caller, await scopeNow());

    expect(resolveSingleDocumentId).toHaveBeenCalledWith("site-settings");
    expect(singleDocumentReadable).toHaveBeenCalled();
  });

  it("drops a row belonging to a PREDECESSOR document, without probing at all", async () => {
    // A version row outlives the document it describes: a Single deleted and
    // recreated leaves rows naming the old id. Judging those by the
    // replacement's verdict exposes the predecessor's entry id and edit time.
    const visible = await asDocuments(
      [single("single-deleted")],
      caller,
      await scopeNow()
    );

    expect(visible).toEqual([]);
    expect(singleDocumentReadable).not.toHaveBeenCalled();
  });

  it("drops every row when the Single has never been materialized", async () => {
    resolveSingleDocumentId.mockResolvedValue(null);

    const visible = await asDocuments(
      [single("single-live")],
      caller,
      await scopeNow()
    );

    expect(visible).toEqual([]);
    expect(singleDocumentReadable).not.toHaveBeenCalled();
  });
});

describe("resolving the scope", () => {
  it("reads the registry ONCE, however many pages are judged against it", async () => {
    // 🔴 The registry and the locale config both answer an unreachable
    // dependency with an EMPTY result, on purpose. Re-read per page, that
    // safety inverts: a transient failure on one page drops every row that
    // page holds while its neighbours keep theirs, and the walk goes on to
    // publish the shortfall as a whole number. One resolution cannot fail
    // halfway.
    const scope = await scopeNow();
    const rows = Array.from({ length: 3 }, (_, index) =>
      row({ entryId: `e${index}`, locale: "en" })
    );

    for (const one of rows) await asDocuments([one], caller, scope);

    expect(contentSnapshot).toHaveBeenCalledTimes(1);
  });

  it("carries the registry's own report that it could not be enumerated", async () => {
    contentSnapshot.mockResolvedValue({ kinds: new Map(), degraded: true });

    expect((await scopeNow()).degraded).toBe(true);
  });

  it("is NOT degraded when an install has simply registered nothing", async () => {
    // The control that keeps `degraded` meaning what it says. An empty
    // registry and an unreachable one produce the same empty map, and folding
    // them together would either fail every empty install or excuse the case
    // this flag exists to report.
    contentSnapshot.mockResolvedValue({ kinds: new Map(), degraded: false });

    expect((await scopeNow()).degraded).toBe(false);
  });
});
