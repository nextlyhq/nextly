/**
 * The report's route, as one caller may read it: a document they may not
 * read is left out, so are the rows of a blocks field their field rules hide,
 * each tab's count is of every place, and the documents page a hundred at a
 * time.
 */
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import type { ReadableDocument } from "./readable";
import { bindingsToFixRoute } from "./route";
import type { BindingReportRow } from "./rows";
import type { BindingReportStore, StoredDocumentReport } from "./store";

const row = (blocksField: string): BindingReportRow => ({
  nodeId: "h",
  blockType: "core/heading",
  prop: "text",
  binding: { source: "entry", path: "headline" },
  codes: ["binding-field-missing"],
  shows: { kind: "fallback", value: "Untitled" },
  blocksField,
});

const stored = (
  id: string,
  place: string,
  fields: string[]
): StoredDocumentReport => ({
  documentKey: `collection:pages:${id}`,
  kind: "collection",
  slug: "pages",
  documentId: id,
  place,
  rows: fields.map(row),
  checkedAt: new Date("2026-11-07T10:00:00Z"),
});

function routeOver(
  entries: StoredDocumentReport[],
  readable: Record<string, readonly string[]>
) {
  const store = {
    list: async () => entries,
    get: async (key: string) =>
      entries.find(entry => entry.documentKey === key),
    fullCheck: async () => ({
      checked: "v1",
      completedAt: new Date("2026-11-07T09:00:00Z"),
      checking: null,
      cursor: null,
      startedAt: null,
    }),
  } as unknown as BindingReportStore;
  return bindingsToFixRoute({
    store: () => store,
    readable: async () =>
      new Map<string, ReadableDocument>(
        Object.entries(readable).map(([id, fields]) => [
          `collection:pages:${id}`,
          {
            title: `Page ${id}`,
            fields: new Set(fields),
            collectionLabel: "Pages",
          },
        ])
      ),
    refresh: () => undefined,
  });
}

async function answer(
  route: ReturnType<typeof bindingsToFixRoute>,
  query = ""
): Promise<{
  items: { documentKey: string; rows: unknown[] }[];
  meta: Record<string, unknown>;
}> {
  const response = await route.handler(
    new Request(`http://admin.test/bindings-to-fix${query}`),
    {} as PluginRouteContext
  );
  return (await response.json()) as never;
}

describe("the bindings to fix route", () => {
  it("lists only what the caller may read, down to the blocks field", async () => {
    const route = routeOver(
      [
        stored("a", "pages", ["content", "secret"]),
        stored("b", "pages", ["content"]),
        // Its one field is hidden from the caller: the document is left out.
        stored("c", "patterns", ["secret"]),
      ],
      { a: ["content"], c: [] }
    );
    const { items, meta } = await answer(route);
    expect(items.map(item => [item.documentKey, item.rows.length])).toEqual([
      ["collection:pages:a", 1],
    ]);
    expect(meta).toMatchObject({
      total: 1,
      bindings: 1,
      byPlace: { pages: 1 },
      checkedAt: "2026-11-07T09:00:00.000Z",
      checking: false,
    });
  });

  it("counts every place whatever place is asked for, and pages a hundred at a time", async () => {
    const many = Array.from({ length: 150 }, (_unused, index) =>
      stored(String(index), index < 120 ? "pages" : "components", ["content"])
    );
    const route = routeOver(
      many,
      Object.fromEntries(
        many.map(entry => [entry.documentId ?? "", ["content"]])
      )
    );
    const first = await answer(route, "?place=pages");
    expect(first.items).toHaveLength(100);
    expect(first.meta).toMatchObject({
      total: 120,
      totalPages: 2,
      hasNext: true,
      byPlace: { pages: 120, components: 30 },
    });
    const second = await answer(route, "?place=pages&page=2");
    expect(second.items).toHaveLength(20);
    expect(second.meta).toMatchObject({ hasNext: false, hasPrev: true });
  });
});
