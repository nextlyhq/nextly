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
  readable: Record<string, readonly string[]>,
  /** Singles the caller may not read. */
  unreadableSingles: ReadonlySet<string> = new Set()
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
    componentStore: () => "components",
    defaultLocale: () => "en",
    readableSingles: async (_ctx, slugs) =>
      new Set([...slugs].filter(slug => !unreadableSingles.has(slug))),
  });
}

async function answer(
  route: ReturnType<typeof bindingsToFixRoute>,
  query = "",
  ctx: unknown = {}
): Promise<{
  items: { documentKey: string; rows: Record<string, unknown>[] }[];
  meta: Record<string, unknown>;
}> {
  const response = await route.handler(
    new Request(`http://admin.test/bindings-to-fix${query}`),
    ctx as PluginRouteContext
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

  it("names a bound Single by its label, and by its slug when the registry can't say", async () => {
    const bound: StoredDocumentReport = {
      ...stored("a", "pages", ["content"]),
      rows: [
        {
          ...row("content"),
          binding: { source: "single", sourceKey: "contact", path: "slogan" },
        },
      ],
    };
    const route = routeOver([bound], { a: ["content"] });
    const asked: unknown[] = [];
    const labelled = await answer(route, "", {
      services: {
        singles: {
          list: async (query: unknown) => {
            asked.push(query);
            return { data: [{ slug: "contact", label: "Contact details" }] };
          },
        },
      },
    });
    expect(asked).toEqual([{ slugAllowlist: ["contact"], limit: 1 }]);
    expect(labelled.items[0]?.rows[0]).toMatchObject({
      sourceLabel: "Contact details",
    });
    const unread = await answer(route, "", {
      services: {
        singles: {
          list: async () => {
            throw new Error("registry unavailable");
          },
        },
      },
    });
    expect(unread.items[0]?.rows[0]).not.toHaveProperty("sourceLabel");
  });

  it("keeps the slug of a bound Single the caller may not read, whatever the registry says", async () => {
    const bound: StoredDocumentReport = {
      ...stored("a", "pages", ["content"]),
      rows: [
        {
          ...row("content"),
          binding: { source: "single", sourceKey: "contact", path: "slogan" },
        },
      ],
    };
    const route = routeOver([bound], { a: ["content"] }, new Set(["contact"]));
    const asked: unknown[] = [];
    const { items } = await answer(route, "", {
      services: {
        singles: {
          list: async (query: unknown) => {
            asked.push(query);
            return { data: [{ slug: "contact", label: "Contact details" }] };
          },
        },
      },
    });
    expect(items[0]?.rows[0]).not.toHaveProperty("sourceLabel");
    // Not even asked of the registry.
    expect(asked).toEqual([]);
  });

  it("sends a Layout region's binding to its component, and marks one in another language", async () => {
    const entry: StoredDocumentReport = {
      ...stored("a", "pages", ["content"]),
      rows: [
        { ...row("layout"), layout: "l1", component: "c9" },
        { ...row("content"), locale: "fr" },
        { ...row("content"), locale: "en" },
      ],
    };
    const { items } = await answer(
      routeOver([entry], { a: ["content", "layout"] })
    );
    const [region, french, english] = items[0]?.rows ?? [];
    expect(region).toMatchObject({ opens: { slug: "components", id: "c9" } });
    expect(french).toMatchObject({ inAnotherLanguage: true });
    expect(english).not.toHaveProperty("inAnotherLanguage");
    expect(english).not.toHaveProperty("opens");
  });
});
