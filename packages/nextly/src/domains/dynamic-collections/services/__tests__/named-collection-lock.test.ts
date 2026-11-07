/**
 * A collection's named lock on MySQL is named for the database as well as the
 * slug. MySQL's named locks belong to the server, so a name built from the
 * slug alone would make two Nextly databases on one server wait on each
 * other's deletes and writes of the same slug.
 *
 * The separating property is that one slug in two databases takes two names,
 * and that the hold asks the connection which database it is in: a name
 * hashed from the slug alone passes every other assertion here.
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it, vi } from "vitest";

import {
  DynamicCollectionRegistryService,
  namedCollectionLockName,
} from "../dynamic-collection-registry-service";

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

  it("is taken under the name of the database the transaction's connection is in", async () => {
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
      select: vi.fn(async () => [{ slug: "posts", id: "c1" }]),
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

    const held = await registry.holdCollectionsIn(tx, ["posts"], "share");

    expect(held.existing).toEqual(["posts"]);
    const taken = statements.find(query => query.sql.includes("GET_LOCK"));
    expect(taken?.params[0]).toBe(namedCollectionLockName("site_a", "posts"));
    // Released under the same name, once the row has been read.
    const released = statements.find(query =>
      query.sql.includes("RELEASE_LOCK")
    );
    expect(released?.params[0]).toBe(
      namedCollectionLockName("site_a", "posts")
    );
  });
});
