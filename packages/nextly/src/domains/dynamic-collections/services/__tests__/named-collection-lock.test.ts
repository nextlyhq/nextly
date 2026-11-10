/**
 * A collection's named lock on MySQL is named for the database as well as the
 * slug. MySQL's named locks belong to the server, so a name built from the
 * slug alone would make two Nextly databases on one server wait on each
 * other's deletes and writes of the same slug.
 *
 * The separating property is that one slug in two databases takes two names,
 * and that the hold asks the connection which database it is in: a name
 * hashed from the slug alone passes every other assertion here.
 *
 * The old name, a hash of the slug alone, is taken too, first and in the
 * order the release before took it, so a hold on either release waits for
 * the other's. A hold taking only the new name, or taking the names in
 * another order, fails the last two cases.
 */
import { createHash } from "node:crypto";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { loadDialectTables } from "../../../../database/dialect-tables";
import {
  DynamicCollectionRegistryService,
  legacyCollectionLockName,
  namedCollectionLockName,
  namedCollectionLockNames,
} from "../dynamic-collection-registry-service";

/** The name the release before this one gave a slug's lock, written out. */
function oldReleaseName(slug: string): string {
  return `nextly:collection:${createHash("sha256").update(slug).digest("hex").slice(0, 40)}`;
}

// The hold reads the registry table of the service's dialect, and the unit
// setup loads only the run's own dialect.
beforeAll(async () => {
  await loadDialectTables("mysql");
});

describe("a collection's named lock", () => {
  it("is named apart for one slug in two databases", () => {
    expect(namedCollectionLockName("site_a", "posts")).not.toBe(
      namedCollectionLockName("site_b", "posts")
    );
  });

  it("is named the same for one slug in one database, within MySQL's 64 characters", () => {
    const name = namedCollectionLockName("site_a", "posts");
    expect(namedCollectionLockName("site_a", "posts")).toBe(name);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name.startsWith("nextly:collection:")).toBe(true);
  });

  it("never runs a database and a slug together into another pair", () => {
    expect(namedCollectionLockName("ab", "c")).not.toBe(
      namedCollectionLockName("a", "bc")
    );
  });

  it("is named for no database where the connection has none selected", () => {
    expect(namedCollectionLockName(null, "posts")).toBe(
      namedCollectionLockName("", "posts")
    );
    expect(namedCollectionLockName(null, "posts")).not.toBe(
      namedCollectionLockName("site_a", "posts")
    );
  });

  it("keeps the name the release before gave it, for instances not yet updated", () => {
    expect(legacyCollectionLockName("posts")).toBe(oldReleaseName("posts"));
    expect(legacyCollectionLockName("posts")).not.toBe(
      namedCollectionLockName("site_a", "posts")
    );
  });

  it("is taken under both names, the old ones first in slug order", () => {
    expect(
      namedCollectionLockNames("site_a", ["posts", "authors", "posts"])
    ).toEqual([
      oldReleaseName("authors"),
      oldReleaseName("posts"),
      namedCollectionLockName("site_a", "authors"),
      namedCollectionLockName("site_a", "posts"),
    ]);
  });

  it("is taken on the transaction's connection under both names, and released under both in reverse", async () => {
    const dialect = new MySqlDialect();
    const statements: { sql: string; params: unknown[] }[] = [];
    const tx = {
      queryStatement: vi.fn(async (statement: SQL) => {
        const query = dialect.sqlToQuery(statement);
        statements.push(query);
        if (query.sql.includes("DATABASE()")) return [{ name: "site_a" }];
        if (query.sql.includes("GET_LOCK")) return [{ locked: 1 }];
        return [{}];
      }),
      select: vi.fn(async () => [
        { slug: "posts", id: "c1" },
        { slug: "authors", id: "c2" },
      ]),
    } as unknown as TransactionContext;
    const adapter = {
      getCapabilities: () => ({ dialect: "mysql" }),
    } as never;
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as never;
    const registry = new DynamicCollectionRegistryService(adapter, logger);

    const held = await registry.holdCollectionsIn(
      tx,
      ["posts", "authors"],
      "share"
    );

    expect([...held.existing].sort()).toEqual(["authors", "posts"]);
    const expected = [
      oldReleaseName("authors"),
      oldReleaseName("posts"),
      namedCollectionLockName("site_a", "authors"),
      namedCollectionLockName("site_a", "posts"),
    ];
    const taken = statements
      .filter(query => query.sql.includes("GET_LOCK"))
      .map(query => query.params[0]);
    expect(taken).toEqual(expected);
    // Released once the rows have been read, each name once, in reverse.
    const released = statements
      .filter(query => query.sql.includes("RELEASE_LOCK"))
      .map(query => query.params[0]);
    expect(released).toEqual([...expected].reverse());
  });
});
