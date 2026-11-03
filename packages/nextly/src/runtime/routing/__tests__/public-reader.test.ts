/**
 * What a published page's list query becomes, and what it may never ask for.
 * The mapping is pure, so every refusal is checked before anything is read.
 */
import { describe, expect, it, vi } from "vitest";

// The registered schema stood in for as hiding nothing: these tests are about
// what a read is built from and how it runs, not about hidden fields, which
// `public-reader-hidden.test.ts` and the declarations' own tests cover.
vi.mock("../declared-fields", async importOriginal => ({
  ...(await importOriginal<typeof import("../declared-fields")>()),
  hiddenFieldPaths: vi.fn(async () => new Set<string>()),
}));

import {
  currentCallerScope,
  currentRequestCaller,
  runWithCallerScope,
  runWithRequestCaller,
  type RequestCaller,
} from "../../../auth/caller-scope";
import { mergeConfig } from "../../../direct-api/namespaces/helpers";
import type { AuthenticatedScope } from "../../../auth/authenticated-scope";
import {
  createPublicReader,
  toPublicFind,
  type PublicReadQuery,
} from "../public-reader";

const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return JSON.stringify(error);
  }
  return expect.unreachable("expected a refusal");
};

describe("toPublicFind", () => {
  it("fixes the boundary: published, the anonymous caller's rules, unknown sort keys refused", () => {
    const args = toPublicFind({ collection: "posts" });
    expect(args).toMatchObject({
      collection: "posts",
      status: "published",
      overrideAccess: false,
      unknownSort: "refuse",
    });
    // Present and undefined, so no default underneath can name a user.
    expect("user" in args).toBe(true);
    expect((args as { user?: unknown }).user).toBeUndefined();
  });

  it("clears every identity an instance's defaults could carry into the read", () => {
    // The Direct API spreads its defaults under each call; the merged result
    // is what the read is judged by.
    const merged = mergeConfig(
      {
        overrideAccess: true,
        user: { id: "staff" },
        actor: { actorType: "apiKey" } as unknown as AuthenticatedScope,
        fieldAccessUser: { id: "editor" },
        trusted: {} as never,
        req: {} as never,
        request: new Request("https://example.test"),
        context: { tenant: "a" },
        showHiddenFields: true,
      },
      toPublicFind({ collection: "posts" })
    );
    expect(merged).toMatchObject({
      overrideAccess: false,
      showHiddenFields: false,
    });
    for (const key of [
      "user",
      "actor",
      "fieldAccessUser",
      "trusted",
      "req",
      "request",
      "context",
    ] as const) {
      expect(merged[key], key).toBeUndefined();
    }
  });

  it.each([
    [{ select: "title" }, "select"],
    [{ filters: { field: "title" } }, "filters"],
    [
      { filters: [{ field: "title", op: "equals", value: { $ne: 1 } }] },
      "filters.0.value",
    ],
    [{ sort: 5 }, "sort"],
    [{ limit: "10" }, "limit"],
    [{ collection: 7 }, "collection"],
  ])("refuses %j as the wrong type, naming where", (bad, where) => {
    const message = refusal(() =>
      toPublicFind({
        collection: "posts",
        ...bad,
      } as unknown as PublicReadQuery)
    );
    expect(message).toContain("public-read-query-invalid");
    expect(message).toContain(where);
  });

  it.each([
    "overrideAccess",
    "status",
    "draft",
    "user",
    "req",
    "principal",
    "trusted",
    "fieldAccessUser",
    "frameworkFilter",
    "where",
    "depth",
    "context",
    "showHiddenFields",
    "populate",
  ])("refuses a query that sets %s, by name", key => {
    const query = {
      collection: "posts",
      [key]: true,
    } as unknown as PublicReadQuery;
    expect(refusal(() => toPublicFind(query))).toContain(`\\"${key}\\"`);
  });

  it("maps each operator onto core's, ANDing the rows", () => {
    const args = toPublicFind({
      collection: "posts",
      filters: [
        { field: "views", op: "gte", value: 10 },
        { field: "tag", op: "in", value: ["a", "b"] },
        { field: "cover", op: "exists", value: true },
      ],
    });
    expect(args.where).toEqual({
      and: [
        { views: { greater_than_equal: 10 } },
        { tag: { in: ["a", "b"] } },
        { cover: { exists: true } },
      ],
    });
  });

  it.each([
    [{ field: "title", op: "like", value: "x" }, "operator-unknown"],
    [{ field: "a.b", op: "equals", value: "x" }, "field-invalid"],
    [{ field: "tag", op: "in", value: "a" }, "value-invalid"],
    [{ field: "cover", op: "exists", value: "yes" }, "value-invalid"],
  ])("refuses a malformed row %j", (row, reason) => {
    expect(
      refusal(() =>
        toPublicFind({
          collection: "posts",
          filters: [
            row as PublicReadQuery["filters"] extends readonly (infer R)[]
              ? R
              : never,
          ],
        })
      )
    ).toContain(`public-read-${reason}`);
  });

  it("starts at offset + (page - 1) × limit, and never sends a page", () => {
    const args = toPublicFind({
      collection: "posts",
      offset: 10,
      page: 2,
      limit: 10,
    });
    expect(args.offset).toBe(20);
    expect("page" in args).toBe(false);
  });

  it.each([
    [{ limit: 0 }, "limit"],
    [{ limit: 101 }, "limit"],
    [{ offset: -1 }, "offset"],
    [{ page: 0 }, "page"],
  ])("refuses %j", (window, name) => {
    expect(
      refusal(() => toPublicFind({ collection: "posts", ...window }))
    ).toContain(`public-read-${name}-invalid`);
  });

  it("always sends a sort, so an unsorted list is in id order", () => {
    expect(toPublicFind({ collection: "posts" }).sort).toEqual([]);
    // A string that names no key is no sort, not a string core drops whole.
    for (const sort of ["", " ", ",", " , "]) {
      expect(toPublicFind({ collection: "posts", sort }).sort).toEqual([]);
    }
    expect(
      toPublicFind({ collection: "posts", sort: "title, -date" }).sort
    ).toEqual(["title", "-date"]);
    expect(toPublicFind({ collection: "posts", sort: ["-date"] }).sort).toEqual(
      ["-date"]
    );
  });

  it("reads in the route's language and refuses another", () => {
    expect(toPublicFind({ collection: "posts" }, { locale: "fr" }).locale).toBe(
      "fr"
    );
    expect(
      refusal(() =>
        toPublicFind({ collection: "posts", locale: "de" }, { locale: "fr" })
      )
    ).toContain("public-read-locale-mismatch");
  });

  it("selects the id with the fields asked for, and reads nothing related", () => {
    const args = toPublicFind({
      collection: "posts",
      select: ["title", "author"],
    });
    expect(args.select).toEqual({ id: true, title: true, author: true });
    expect(args.depth).toBe(0);
    expect(toPublicFind({ collection: "posts" }).depth).toBe(0);
  });

  it.each(["-", "title,-", ["title", " - "], ["title,-"]])(
    "refuses a sort key that is only a sign: %j",
    sort => {
      expect(
        refusal(() =>
          toPublicFind({ collection: "posts", sort } as PublicReadQuery)
        )
      ).toContain("public-read-sort-invalid");
    }
  );

  it.each(
    (["gt", "gte", "lt", "lte", "contains"] as const).flatMap(op =>
      [true, false].map(value => [op, value] as const)
    )
  )("refuses %s %s, and keeps a boolean for equals", (op, value) => {
    expect(
      refusal(() =>
        toPublicFind({
          collection: "posts",
          filters: [{ field: "rank", op, value }],
        })
      )
    ).toContain("public-read-value-invalid");
    expect(
      toPublicFind({
        collection: "posts",
        filters: [{ field: "featured", op: "equals", value: true }],
      }).where
    ).toEqual({ and: [{ featured: { equals: true } }] });
  });

  it("takes for contains what core's find takes: text, or a number matched as text", () => {
    for (const value of ["hel", 12]) {
      expect(
        toPublicFind({
          collection: "posts",
          filters: [{ field: "title", op: "contains", value }],
        }).where
      ).toEqual({ and: [{ title: { contains: value } }] });
    }
    expect(
      refusal(() =>
        toPublicFind({
          collection: "posts",
          filters: [{ field: "title", op: "contains", value: ["a"] }],
        })
      )
    ).toContain("public-read-value-invalid");
  });

  it("splits each sort element on commas, as core does", () => {
    expect(
      toPublicFind({ collection: "posts", sort: ["title, -date", "rank"] }).sort
    ).toEqual(["title", "-date", "rank"]);
  });

  it("refuses __proto__ as a field name", () => {
    expect(
      refusal(() =>
        toPublicFind({
          collection: "posts",
          filters: [{ field: "__proto__", op: "equals", value: 1 }],
        })
      )
    ).toContain("public-read-field-invalid");
  });

  it("refuses an empty in list, and keeps an empty not_in", () => {
    expect(
      refusal(() =>
        toPublicFind({
          collection: "posts",
          filters: [{ field: "tag", op: "in", value: [] }],
        })
      )
    ).toContain("public-read-value-invalid");
    expect(
      toPublicFind({
        collection: "posts",
        filters: [{ field: "tag", op: "not_in", value: [] }],
      }).where
    ).toEqual({ and: [{ tag: { not_in: [] } }] });
  });

  it("refuses a page and limit whose start is past any safe offset", () => {
    expect(
      refusal(() =>
        toPublicFind({
          collection: "posts",
          page: Number.MAX_SAFE_INTEGER,
          limit: 100,
        })
      )
    ).toContain("public-read-offset-invalid");
    // The control: a large page that still starts at a safe offset.
    expect(
      toPublicFind({ collection: "posts", page: 1_000_000, limit: 100 }).offset
    ).toBe(99_999_900);
  });
});

describe("createPublicReader", () => {
  it("reads through find with the mapped arguments and answers the list envelope", async () => {
    const meta = { total: 7, page: 1, limit: 10, totalPages: 1 };
    const find = vi.fn(async () => ({ items: [{ id: "1" }], meta, extra: 1 }));
    const reader = createPublicReader(
      { find } as unknown as Parameters<typeof createPublicReader>[0],
      { locale: "en" }
    );
    await expect(reader.find({ collection: "posts" })).resolves.toEqual({
      items: [{ id: "1" }],
      meta,
    });
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "published",
        overrideAccess: false,
        locale: "en",
      })
    );
  });

  it("counts with a one-row read of ids, in the query's language", async () => {
    const find = vi.fn(async () => ({
      items: [{ id: "1" }],
      meta: { total: 3 },
    }));
    const reader = createPublicReader({ find } as unknown as Parameters<
      typeof createPublicReader
    >[0]);
    await expect(
      reader.count({
        collection: "posts",
        filters: [{ field: "title", op: "contains", value: "a" }],
        locale: "fr",
      })
    ).resolves.toBe(3);
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "posts",
        where: { and: [{ title: { contains: "a" } }] },
        limit: 1,
        select: { id: true },
        locale: "fr",
        status: "published",
        overrideAccess: false,
        unknownSort: "refuse",
      })
    );
  });

  it.each(["sort", "page", "offset", "limit", "select", "populate"])(
    "refuses a count that sets %s, before reading",
    async key => {
      const find = vi.fn(async () => ({ items: [], meta: { total: 0 } }));
      const reader = createPublicReader({ find } as unknown as Parameters<
        typeof createPublicReader
      >[0]);
      await expect(
        reader.count({
          collection: "posts",
          [key]: key === "sort" ? ["title"] : 1,
        } as unknown as Parameters<typeof reader.count>[0])
      ).rejects.toThrow(new RegExp(`"${key}"`));
      expect(find).not.toHaveBeenCalled();
    }
  );

  it("reads detached from the request it runs in, so no caller's key judges it", async () => {
    const seen: unknown[] = [];
    const find = vi.fn(async () => {
      seen.push(currentCallerScope(), currentRequestCaller());
      return { items: [], meta: { total: 0 } };
    });
    const reader = createPublicReader({ find } as unknown as Parameters<
      typeof createPublicReader
    >[0]);
    const scope = { actorType: "apiKey" } as unknown as AuthenticatedScope;
    const caller = { userId: "u1" } as unknown as RequestCaller;
    await runWithRequestCaller(caller, () =>
      runWithCallerScope(scope, async () => {
        // The control: the scope is pinned where the reader is called.
        expect(currentCallerScope()).toBe(scope);
        await reader.find({ collection: "posts" });
        await reader.count({ collection: "posts" });
      })
    );
    expect(seen).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("offers the three reads and nothing else", () => {
    const reader = createPublicReader({
      find: vi.fn(),
    } as unknown as Parameters<typeof createPublicReader>[0]);
    expect(Object.keys(reader).sort()).toEqual(["count", "find", "findSingle"]);
    expect(Object.isFrozen(reader)).toBe(true);
  });
});
