// @vitest-environment jsdom

/**
 * The open document's bindings to fix on one canvas: the rows of its field in
 * the default language, kept as one list while the report and the field are
 * the same, so what reads them is not handed a new list on every render.
 *
 * @module bindings-report/page-rows.test
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { documentKeyOf } from "../../host-rewrite/contract";

const KEY = documentKeyOf({ kind: "collection", slug: "pages", id: "p1" });

const row = (prop: string, extra: Record<string, unknown> = {}) => ({
  nodeId: "n1",
  prop,
  blockLabel: "Heading",
  propLabel: prop,
  ...extra,
});

// One report, as the query keeps it between renders.
const REPORT = {
  data: {
    items: [
      {
        documentKey: KEY,
        kind: "collection",
        slug: "pages",
        documentId: "p1",
        place: "pages/p1",
        title: "Home",
        collectionLabel: "Pages",
        checkedAt: "2026-11-19T00:00:00.000Z",
        rows: [
          row("text"),
          row("other", { blocksField: "sidebar" }),
          row("translated", { inAnotherLanguage: true }),
        ],
      },
    ],
  },
  pending: false,
};

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useDocumentIdentity: () => ({
    kind: "collection",
    slug: "pages",
    documentId: "p1",
  }),
}));

vi.mock("./client", () => ({
  useBindingsToFix: () => REPORT,
}));

const { usePageBindingsToFix } = await import("./page-rows");

afterEach(cleanup);

describe("usePageBindingsToFix", () => {
  it("keeps the field's rows in the default language", () => {
    const { result } = renderHook(() => usePageBindingsToFix("content"));
    expect(result.current.rows.map(each => each.prop)).toEqual(["text"]);
  });

  it("hands back the same list while the report and the field are the same", () => {
    const { result, rerender } = renderHook(
      ({ field }: { field: string }) => usePageBindingsToFix(field),
      { initialProps: { field: "content" } }
    );
    const first = result.current.rows;
    rerender({ field: "content" });
    expect(result.current.rows).toBe(first);
    // Another field is another list.
    rerender({ field: "sidebar" });
    expect(result.current.rows.map(each => each.prop)).toEqual([
      "text",
      "other",
    ]);
  });
});
