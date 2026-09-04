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

vi.mock("../../../services/lib/readable-documents", () => ({
  readableDocumentIds: (...args: unknown[]) =>
    readableDocumentIds(...args) as unknown,
}));
vi.mock("../../singles/services/single-document-access", () => ({
  singleDocumentReadable: (...args: unknown[]) =>
    singleDocumentReadable(...args) as unknown,
  resolveSingleDocumentId: (...args: unknown[]) =>
    resolveSingleDocumentId(...args) as unknown,
}));

import { visiblePendingEdits } from "../pending-edit-visibility";

const caller = { user: { id: "user-1", roles: ["editor"] } };

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
  } as unknown as Parameters<typeof visiblePendingEdits>[0][number];
}

beforeEach(() => {
  vi.clearAllMocks();
  readableDocumentIds.mockImplementation((_slug, ids: string[]) =>
    Promise.resolve(new Set(ids))
  );
  singleDocumentReadable.mockResolvedValue(true);
  resolveSingleDocumentId.mockResolvedValue("single-live");
});

describe("collection rows", () => {
  it("asks about each LOCALE separately, carrying the locale into the read", async () => {
    // 🔴 A stored read rule is a predicate over the collection's own fields, and
    // a localized field answers differently per language --
    // `localized-target-predicate.integration.test.ts` pins one row readable in
    // `en` and denied in `de`. Asking once per slug judges whichever
    // translation the read defaults to and marks every other language visible
    // on the strength of it.
    await visiblePendingEdits(
      [
        row({ entryId: "e1", locale: "en" }),
        row({ entryId: "e1", locale: "de" }),
      ],
      caller
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

    const visible = await visiblePendingEdits(
      [
        row({ entryId: "e1", locale: "de" }),
        row({ entryId: "e1", locale: "en" }),
      ],
      caller
    );

    expect(visible.map(r => r.locale)).toEqual(["en"]);
  });

  it("asks ONCE for rows that share a slug and language", async () => {
    // The control on the grouping: per-locale must not become per-row, which
    // would put one read per document in front of every dashboard load.
    await visiblePendingEdits(
      [
        row({ entryId: "e1", locale: "en" }),
        row({ entryId: "e2", locale: "en" }),
      ],
      caller
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

describe("single rows", () => {
  const single = (entryId: string, locale?: string | null) =>
    row({ entryId, locale, scopeKind: "single", scopeSlug: "site-settings" });

  it("resolves the live document id WITHOUT materializing the Single", async () => {
    // 🔴 The read probe goes through `SingleEntryService.get`, which AUTO-CREATES
    // a missing Single -- so probing first makes loading a dashboard perform a
    // write. The id is resolved from the backing row instead, which is what
    // `resolveSingleDocumentId` exists for.
    await visiblePendingEdits([single("single-live")], caller);

    expect(resolveSingleDocumentId).toHaveBeenCalledWith("site-settings");
    expect(singleDocumentReadable).toHaveBeenCalled();
  });

  it("drops a row belonging to a PREDECESSOR document, without probing at all", async () => {
    // A version row outlives the document it describes: a Single deleted and
    // recreated leaves rows naming the old id. Judging those by the
    // replacement's verdict exposes the predecessor's entry id and edit time.
    const visible = await visiblePendingEdits(
      [single("single-deleted")],
      caller
    );

    expect(visible).toEqual([]);
    expect(singleDocumentReadable).not.toHaveBeenCalled();
  });

  it("drops every row when the Single has never been materialized", async () => {
    resolveSingleDocumentId.mockResolvedValue(null);

    const visible = await visiblePendingEdits([single("single-live")], caller);

    expect(visible).toEqual([]);
    expect(singleDocumentReadable).not.toHaveBeenCalled();
  });
});
