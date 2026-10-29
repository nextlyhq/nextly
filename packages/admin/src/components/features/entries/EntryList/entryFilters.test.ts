import { RESERVED_TOP_LEVEL_KEYS } from "nextly/reserved-filter-keys";
import { describe, expect, it } from "vitest";

import { buildEntryWhereFilter } from "./entryFilters";

describe("buildEntryWhereFilter", () => {
  it("returns undefined when no filters are active", () => {
    const where = buildEntryWhereFilter({
      whereParam: null,
      status: "all",
      createdFrom: "",
      createdTo: "",
      updatedFrom: "",
      updatedTo: "",
    });

    expect(where).toBeUndefined();
  });

  it("builds status + created/updated date filters with day boundaries", () => {
    const where = buildEntryWhereFilter({
      status: "published",
      createdFrom: "2026-04-01",
      createdTo: "2026-04-03",
      updatedFrom: "2026-04-02",
      updatedTo: "2026-04-04",
    }) as { and: Array<Record<string, unknown>> };

    expect(where.and).toEqual(
      expect.arrayContaining([
        { status: { equals: "published" } },
        {
          createdAt: {
            greater_than_equal: "2026-04-01T00:00:00.000Z",
            less_than_equal: "2026-04-03T23:59:59.999Z",
          },
        },
        {
          updatedAt: {
            greater_than_equal: "2026-04-02T00:00:00.000Z",
            less_than_equal: "2026-04-04T23:59:59.999Z",
          },
        },
      ])
    );
  });

  it("merges URL where with UI filters using and", () => {
    const where = buildEntryWhereFilter({
      whereParam: JSON.stringify({ author: { equals: "user-1" } }),
      status: "draft",
      createdFrom: "2026-04-03",
    }) as { and: Array<Record<string, unknown>> };

    expect(where.and).toEqual(
      expect.arrayContaining([
        { author: { equals: "user-1" } },
        { status: { equals: "draft" } },
        {
          createdAt: {
            greater_than_equal: "2026-04-03T00:00:00.000Z",
          },
        },
      ])
    );
  });

  it("attaches the language filter as a top-level _translated key (never nested in and)", () => {
    // Only the language filter → it is the whole where object.
    const only = buildEntryWhereFilter({
      status: "all",
      translated: { locale: "de", state: "missing" },
    });
    expect(only).toEqual({ _translated: { locale: "de", state: "missing" } });

    // Combined with a status filter → _translated stays TOP-LEVEL alongside the status filter.
    const combined = buildEntryWhereFilter({
      status: "published",
      translated: { locale: "de", state: "translated" },
    }) as Record<string, unknown>;
    expect(combined._translated).toEqual({ locale: "de", state: "translated" });
    // The status filter is preserved (top-level object with both keys = implicit AND).
    expect(combined.status).toEqual({ equals: "published" });
  });

  it.each([
    ["_pendingChange", { _pendingChange: true }],
    [
      "_inRelease with a bound",
      { _inRelease: { scheduledBefore: "2026-10-28T09:00:00Z" } },
    ],
    ["_inRelease open", { _inRelease: true }],
  ])(
    "keeps a linked %s at the top level when the list adds its own filters",
    (_name, linked) => {
      // A dashboard count links with this key alone in `?where=`. The server
      // refuses it inside `and`, so the status and date filters must sit
      // beside it rather than wrap it.
      const where = buildEntryWhereFilter({
        whereParam: JSON.stringify(linked),
        status: "draft",
        createdFrom: "2026-04-03",
      }) as Record<string, unknown>;

      expect(where).toEqual({
        ...linked,
        and: [
          { status: { equals: "draft" } },
          { createdAt: { greater_than_equal: "2026-04-03T00:00:00.000Z" } },
        ],
      });
    }
  );

  it("keeps a linked key at the top level beside the rest of the linked filter", () => {
    const where = buildEntryWhereFilter({
      whereParam: JSON.stringify({
        _pendingChange: true,
        author: { equals: "user-1" },
      }),
      status: "draft",
    }) as Record<string, unknown>;

    expect(where).toEqual({
      _pendingChange: true,
      and: [{ author: { equals: "user-1" } }, { status: { equals: "draft" } }],
    });
  });

  it.each(RESERVED_TOP_LEVEL_KEYS)(
    "keeps every key the server reserves, %s among them, at the top level",
    key => {
      const where = buildEntryWhereFilter({
        whereParam: JSON.stringify({ [key]: true }),
        status: "draft",
      }) as Record<string, unknown>;
      expect(where[key]).toBe(true);
      expect(where.and).toBeUndefined();
    }
  );

  it("keeps a linked __proto__ key as a key, for the server to refuse", () => {
    // Assigned rather than defined, it set the object's prototype and the
    // condition vanished, so the list asked for every entry instead.
    const where = buildEntryWhereFilter({
      whereParam: '{"__proto__":{"equals":"x"}}',
      status: "draft",
    });
    expect(JSON.stringify(where)).toBe(
      '{"and":[{"__proto__":{"equals":"x"}},{"status":{"equals":"draft"}}]}'
    );
  });

  it("returns a linked key alone as the whole filter", () => {
    expect(
      buildEntryWhereFilter({ whereParam: '{"_pendingChange":true}' })
    ).toEqual({ _pendingChange: true });
  });

  it("omits _translated when no language filter is active", () => {
    const where = buildEntryWhereFilter({ status: "all", translated: null });
    expect(where).toBeUndefined();
  });

  it("sends no language filter, the list's own or a link's, for a user who may not read every language's state", () => {
    // The server refuses the whole list for such a filter, so a filter chosen
    // before access was lost, or carried by a link, is dropped instead.
    const where = buildEntryWhereFilter({
      whereParam:
        '{"_translated":{"locale":"fr","state":"missing"},"title":{"equals":"A"}}',
      status: "draft",
      translated: { locale: "de", state: "missing" },
      readsTranslationState: false,
    });
    expect(where).not.toHaveProperty("_translated");
    expect(where).toEqual({
      and: [{ title: { equals: "A" } }, { status: { equals: "draft" } }],
    });
  });
});
