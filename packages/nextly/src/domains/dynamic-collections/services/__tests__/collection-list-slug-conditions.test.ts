/**
 * The slug conditions the collections list puts on its query, rendered as SQL
 * by each dialect's own query builder.
 *
 * Rendered rather than inspected, because the property is the statement the
 * database receives: an empty list must reach no dialect as `IN ()` or
 * `NOT IN ()`, whose meaning differs between them, and a denylist must reach
 * every dialect as a `not in` on the slug column.
 */
import { and } from "drizzle-orm";
import { QueryBuilder as MySqlQueryBuilder } from "drizzle-orm/mysql-core";
import { QueryBuilder as PgQueryBuilder } from "drizzle-orm/pg-core";
import { QueryBuilder as SQLiteQueryBuilder } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { dynamicCollectionsMysql } from "../../../../schemas/dynamic-collections/mysql";
import { dynamicCollectionsPg } from "../../../../schemas/dynamic-collections/postgres";
import { dynamicCollectionsSqlite } from "../../../../schemas/dynamic-collections/sqlite";
import {
  collectionSlugConditions,
  type CollectionSlugLists,
} from "../dynamic-collection-registry-service";

/** The statement each dialect renders for a count over these slug lists. */
const DIALECTS: Array<{
  name: string;
  render: (lists: CollectionSlugLists) => { sql: string; params: unknown[] };
}> = [
  {
    name: "PostgreSQL",
    render: lists =>
      new PgQueryBuilder()
        .select({ id: dynamicCollectionsPg.id })
        .from(dynamicCollectionsPg)
        .where(
          and(...collectionSlugConditions(dynamicCollectionsPg.slug, lists))
        )
        .toSQL(),
  },
  {
    name: "MySQL",
    render: lists =>
      new MySqlQueryBuilder()
        .select({ id: dynamicCollectionsMysql.id })
        .from(dynamicCollectionsMysql)
        .where(
          and(...collectionSlugConditions(dynamicCollectionsMysql.slug, lists))
        )
        .toSQL(),
  },
  {
    name: "SQLite",
    render: lists =>
      new SQLiteQueryBuilder()
        .select({ id: dynamicCollectionsSqlite.id })
        .from(dynamicCollectionsSqlite)
        .where(
          and(...collectionSlugConditions(dynamicCollectionsSqlite.slug, lists))
        )
        .toSQL(),
  },
];

describe.each(DIALECTS)("collection slug conditions on $name", ({ render }) => {
  it("renders a denylist as a `not in` over the slug, with each slug a parameter", () => {
    const { sql, params } = render({ slugDenylist: ["pages", "forms"] });

    expect(sql.toLowerCase()).toMatch(/slug.{0,3} not in \(/);
    expect(params).toEqual(["pages", "forms"]);
  });

  it("puts no slug condition on the query for an empty denylist", () => {
    const { sql, params } = render({ slugDenylist: [] });

    expect(sql.toLowerCase()).not.toContain(" in ");
    expect(sql.toLowerCase()).not.toContain("where");
    expect(params).toEqual([]);
  });

  it("ANDs an allowlist and a denylist, so the denylist only narrows", () => {
    const { sql, params } = render({
      slugAllowlist: ["posts", "pages"],
      slugDenylist: ["pages"],
    });

    expect(sql.toLowerCase()).toMatch(
      /slug.{0,3} in \(.*\) and .*slug.{0,3} not in \(/
    );
    expect(params).toEqual(["posts", "pages", "pages"]);
  });
});

describe("collection slug conditions for an empty allowlist", () => {
  it("is refused, because an empty allowlist is answered before any query", () => {
    // The registry short-circuits `[]` to no rows and a zero total; a
    // condition for it would be `IN ()`, which no dialect should be handed.
    expect(() =>
      collectionSlugConditions(dynamicCollectionsSqlite.slug, {
        slugAllowlist: [],
      })
    ).toThrow();
  });
});
