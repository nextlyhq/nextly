/**
 * One parser reads a read's sort for both the guard that judges which fields
 * may be sorted on and the ORDER BY that sorts, so the two always see the same
 * keys. Paging by offset is validated here too, before any query is built.
 */
import { sql } from "drizzle-orm";
import { integer, PgDialect, pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { assertReadOffset, parseSortKeys, sortsById } from "../filter-shape";
import { orderBySortKeys } from "../sort-order";

const posts = pgTable("posts", {
  id: text("id").primaryKey(),
  rank: integer("rank"),
  grp: integer("grp").notNull(),
});

/** The ORDER BY a read would issue, rendered, or `null` for none. */
function orderFor(
  sort: string | string[] | undefined,
  offset?: number,
  localized?: string
): string | null {
  const parts = orderBySortKeys({
    keys: parseSortKeys(sort),
    ordered: sort !== undefined || offset !== undefined,
    id: posts.id,
    resolve: field => {
      if (field === localized) {
        return { expr: sql`(select v from loc)`, nullable: true };
      }
      const column = (posts as unknown as Record<string, typeof posts.rank>)[
        field
      ];
      return column ? { expr: column, nullable: !column.notNull } : undefined;
    },
  });
  if (parts.length === 0) return null;
  return new PgDialect().sqlToQuery(sql.join(parts, sql`, `)).sql;
}

describe("parseSortKeys", () => {
  it("reads one key, ascending or descending", () => {
    expect(parseSortKeys("title")).toEqual([{ field: "title", desc: false }]);
    expect(parseSortKeys("-createdAt")).toEqual([
      { field: "createdAt", desc: true },
    ]);
  });

  it("splits a comma string, as REST's ?sort=-featured,createdAt sends it", () => {
    expect(parseSortKeys("-featured,createdAt")).toEqual([
      { field: "featured", desc: true },
      { field: "createdAt", desc: false },
    ]);
  });

  it("reads an array in order, and splits commas inside its items", () => {
    expect(parseSortKeys(["-featured", "rank,title"])).toEqual([
      { field: "featured", desc: true },
      { field: "rank", desc: false },
      { field: "title", desc: false },
    ]);
  });

  it("trims whitespace and drops empty keys", () => {
    expect(parseSortKeys(" -featured , ,createdAt ,")).toEqual([
      { field: "featured", desc: true },
      { field: "createdAt", desc: false },
    ]);
    expect(parseSortKeys(["", " ", "-"])).toEqual([]);
  });

  it("keeps the first of a repeated field, whichever direction the later one says", () => {
    expect(parseSortKeys(["rank", "-title", "-rank"])).toEqual([
      { field: "rank", desc: false },
      { field: "title", desc: true },
    ]);
  });

  it("reads nothing from an absent sort or an empty array", () => {
    expect(parseSortKeys(undefined)).toEqual([]);
    expect(parseSortKeys([])).toEqual([]);
  });
});

describe("sortsById", () => {
  it("is true only when a key names the id, in either direction", () => {
    expect(sortsById(parseSortKeys("rank,-id"))).toBe(true);
    expect(sortsById(parseSortKeys("id"))).toBe(true);
    expect(sortsById(parseSortKeys("rank,ident"))).toBe(false);
  });
});

describe("assertReadOffset", () => {
  it("accepts a whole number from zero, or no offset", () => {
    expect(() => assertReadOffset(undefined, undefined)).not.toThrow();
    expect(() => assertReadOffset(0, undefined)).not.toThrow();
    expect(() => assertReadOffset(7, undefined)).not.toThrow();
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1e20])(
    "refuses %s",
    value => {
      expect(() => assertReadOffset(value, undefined)).toThrow(/offset/);
    }
  );

  it("refuses an offset together with a page", () => {
    expect(() => assertReadOffset(5, 2)).toThrow(/offset.*page|page.*offset/);
  });
});

describe("orderBySortKeys", () => {
  it("issues no ORDER BY for a read with no sort and no offset", () => {
    expect(orderFor(undefined)).toBeNull();
  });

  it("orders by the id alone for an offset, or an empty list of keys", () => {
    expect(orderFor(undefined, 5)).toBe('"posts"."id" asc');
    expect(orderFor([])).toBe('"posts"."id" asc');
  });

  it("sorts each key in turn and breaks ties by the id, last", () => {
    expect(orderFor(["grp", "-rank"])).toBe(
      '"posts"."grp" asc, "posts"."rank" is null, "posts"."rank" desc, "posts"."id" asc'
    );
  });

  it("puts empty values last only where a column can hold one", () => {
    // NOT NULL: no leading key, so an index on it still serves the sort.
    expect(orderFor("grp")).toBe('"posts"."grp" asc, "posts"."id" asc');
    expect(orderFor("-rank")).toBe(
      '"posts"."rank" is null, "posts"."rank" desc, "posts"."id" asc'
    );
  });

  it("treats a localized key as nullable, since a missing translation reads as NULL", () => {
    expect(orderFor("title", undefined, "title")).toBe(
      '(select v from loc) is null, (select v from loc) asc, "posts"."id" asc'
    );
  });

  it("adds no second id key when the read sorts by the id itself", () => {
    expect(orderFor(["grp", "-id"])).toBe(
      '"posts"."grp" asc, "posts"."id" desc'
    );
  });

  it("drops a key it cannot resolve and carries on with the others and the id", () => {
    expect(orderFor(["missing", "grp"])).toBe(
      '"posts"."grp" asc, "posts"."id" asc'
    );
  });
});
