/**
 * What a published page's list query becomes, and what it may never ask for.
 * The mapping is pure, so every refusal is checked before anything is read.
 */
import { describe, expect, it, vi } from "vitest";

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

  it("selects the id with the fields asked for, and populates one level", () => {
    const args = toPublicFind({
      collection: "posts",
      select: ["title"],
      populate: ["author"],
    });
    expect(args.select).toEqual({ id: true, title: true, author: true });
    expect(args.depth).toBe(1);
    expect(toPublicFind({ collection: "posts" }).depth).toBe(0);
  });
});

describe("createPublicReader", () => {
  it("reads through find with the mapped arguments and answers items and total", async () => {
    const find = vi.fn(async () => ({
      items: [{ id: "1" }],
      meta: { total: 7 },
    }));
    const count = vi.fn(async () => ({ total: 3 }));
    const reader = createPublicReader(
      { find, count } as unknown as Parameters<typeof createPublicReader>[0],
      { locale: "en" }
    );
    await expect(reader.find({ collection: "posts" })).resolves.toEqual({
      items: [{ id: "1" }],
      total: 7,
    });
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "published",
        overrideAccess: false,
        locale: "en",
      })
    );
    await expect(reader.count({ collection: "posts" })).resolves.toBe(3);
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({ status: "published", overrideAccess: false })
    );
  });

  it("offers the two reads and nothing else", () => {
    const reader = createPublicReader({
      find: vi.fn(),
      count: vi.fn(),
    } as unknown as Parameters<typeof createPublicReader>[0]);
    expect(Object.keys(reader).sort()).toEqual(["count", "find"]);
    expect(Object.isFrozen(reader)).toBe(true);
  });
});
