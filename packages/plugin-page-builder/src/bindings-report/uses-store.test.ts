/**
 * The index's read for a Single's panel: one query, narrowed by what the
 * uses read and bounded, and the "filled" mark read for this format only.
 * Against each dialect's own tables by `__tests__/shown-on.integration.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";

import { BINDING_USES_FORMAT } from "./uses";
import { bindingUsesReader } from "./uses-store";

/** A database whose every select is recorded, answering `rows`. */
function recordingDb(rows: Record<string, unknown>[], option: unknown) {
  const selects: string[] = [];
  const limits: number[] = [];
  const chain = (table: string) => {
    const query = {
      where: () => query,
      orderBy: () => query,
      limit: (n: number) => {
        limits.push(n);
        return query;
      },
      all: async () => rows,
      first: async () => (table === "site_options" ? option : null),
    };
    return query;
  };
  const db = {
    table: () => new Proxy({}, { get: (_t, column) => ({ column }) }),
    select: vi.fn((definition: { name: string }) => {
      selects.push(definition.name);
      return chain(definition.name);
    }),
  };
  return { db, selects, limits };
}

vi.mock("@nextlyhq/plugin-sdk/db", () => ({
  and: (...parts: unknown[]) => ({ and: parts }),
  asc: (column: unknown) => ({ asc: column }),
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  inArray: () => ({}),
  lt: () => ({}),
  not: () => ({}),
}));

const stored = {
  documentKey: "collection:pages:1",
  kind: "collection",
  slug: "pages",
  documentId: "1",
  place: "pages",
  version: "published",
  locale: null,
  blocksField: "content",
  nodeId: "hero",
  blockType: "core/heading",
  blockName: null,
  prop: "text",
  sourceKey: "homepage",
  path: "headline",
};

describe("bindingUsesReader", () => {
  it("reads a Single's uses in one bounded query of the index", async () => {
    const { db, selects, limits } = recordingDb([stored], null);
    const uses = await bindingUsesReader(db as never).ofSingle("homepage", 50);
    expect(selects).toEqual(["binding_uses"]);
    expect(limits).toEqual([50]);
    expect(uses).toEqual([
      {
        documentKey: "collection:pages:1",
        kind: "collection",
        slug: "pages",
        documentId: "1",
        place: "pages",
        version: "published",
        blocksField: "content",
        nodeId: "hero",
        blockType: "core/heading",
        prop: "text",
        sourceKey: "homepage",
        path: "headline",
      },
    ]);
  });

  it("is filled only once the mark holds this format", async () => {
    const at = (value: unknown) =>
      bindingUsesReader(
        recordingDb([], value === undefined ? null : { value }).db as never
      ).filled();
    expect(await at(undefined)).toBe(false);
    expect(await at(String(BINDING_USES_FORMAT))).toBe(true);
    expect(await at(String(BINDING_USES_FORMAT + 1))).toBe(false);
  });
});
