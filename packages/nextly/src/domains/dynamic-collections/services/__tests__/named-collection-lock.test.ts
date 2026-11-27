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
    const { tx, statements, registry } = mysqlHold();

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
    expect(lockNamesIn(statements, "GET_LOCK")).toEqual([expected]);
    // Released once the rows have been read, each name once, in reverse, in one statement.
    expect(lockNamesIn(statements, "RELEASE_LOCK")).toEqual([
      [...expected].reverse(),
    ]);
  });

  // The share side every MySQL entry write takes: one statement to take the names, one to read
  // the registry row, one to release them. The database's name is read once per adapter.
  it("costs a write three statements once the database's name is known", async () => {
    const { tx, statements, registry } = mysqlHold();

    await registry.holdCollectionsIn(tx, ["posts"], "share");
    const first = statements.length + vi.mocked(tx.select).mock.calls.length;
    statements.length = 0;
    vi.mocked(tx.select).mockClear();
    await registry.holdCollectionsIn(tx, ["posts"], "share");
    const later = statements.length + vi.mocked(tx.select).mock.calls.length;

    expect(first).toBe(4);
    expect(later).toBe(3);
    expect(statements.map(query => query.sql)).not.toContainEqual(
      expect.stringContaining("DATABASE()")
    );
  });

  // A write made again waits only for what its earlier tries left of its one wait, in whole seconds
  // and never less than it has; with none left it takes a free name and waits for no other. Given a
  // wait, the second name is waited for only as long as the first left; left out, each on its own.
  it.each([
    { waitMs: undefined, seconds: 30, leftToTheSecond: 0 },
    { waitMs: 12_400, seconds: 13, leftToTheSecond: 1 },
    { waitMs: 0, seconds: 0, leftToTheSecond: 1 },
  ])(
    "waits $seconds seconds where it is given $waitMs milliseconds",
    async ({ waitMs, seconds, leftToTheSecond }) => {
      const { tx, statements, registry } = mysqlHold();

      await registry.holdCollectionsIn(
        tx,
        ["posts"],
        "share",
        waitMs === undefined ? undefined : { waitMs }
      );

      const taken = statements.filter(query => query.sql.includes("GET_LOCK"));
      expect(taken).toHaveLength(1);
      // Each name is followed by its wait, in the one statement that takes both.
      expect(
        taken[0].params.flatMap((param, index) =>
          isLockName(param) ? [taken[0].params[index + 1]] : []
        )
      ).toEqual([seconds, seconds]);
      // The time gone since the statement began, taken from the wait of every name but the first.
      expect(taken[0].sql.split("SYSDATE(6)")).toHaveLength(
        leftToTheSecond + 1
      );
    }
  );

  it("refuses as COLLECTION_BEING_CHANGED when a name is not got in time, releasing the ones it got", async () => {
    // The first of the two names got, the second not.
    const { tx, statements, registry } = mysqlHold({ taken: 1 });

    await expect(
      registry.holdCollectionsIn(tx, ["posts"], "update")
    ).rejects.toMatchObject({ code: "COLLECTION_BEING_CHANGED" });

    expect(lockNamesIn(statements, "RELEASE_LOCK")).toEqual([
      [oldReleaseName("posts")],
    ]);
    expect(tx.select).not.toHaveBeenCalled();
  });

  it("releases every name when the take fails part way", async () => {
    const { tx, statements, registry } = mysqlHold({ takeFails: true });

    await expect(
      registry.holdCollectionsIn(tx, ["posts"], "update")
    ).rejects.toThrow("connection lost while waiting");

    expect(lockNamesIn(statements, "RELEASE_LOCK")).toEqual([
      [namedCollectionLockName("site_a", "posts"), oldReleaseName("posts")],
    ]);
  });
});

/**
 * A MySQL registry service on a stand-in transaction that records each statement: its database is
 * `site_a`, the registry holds `posts` and `authors`, and the take of the names answers `taken`
 * (every name by default), or fails when `takeFails`.
 */
function mysqlHold(options: { taken?: number; takeFails?: boolean } = {}): {
  tx: TransactionContext;
  statements: { sql: string; params: unknown[] }[];
  registry: DynamicCollectionRegistryService;
} {
  const dialect = new MySqlDialect();
  const statements: { sql: string; params: unknown[] }[] = [];
  const tx = {
    queryStatement: vi.fn(async (statement: SQL) => {
      const query = dialect.sqlToQuery(statement);
      statements.push(query);
      if (query.sql.includes("DATABASE()")) return [{ name: "site_a" }];
      if (query.sql.includes("GET_LOCK")) {
        if (options.takeFails === true) {
          throw new Error("connection lost while waiting");
        }
        const names = query.params.filter(isLockName).length;
        return [{ taken: options.taken ?? names }];
      }
      return [{}];
    }),
    select: vi.fn(async () => [
      { slug: "posts", id: "c1" },
      { slug: "authors", id: "c2" },
    ]),
  } as unknown as TransactionContext;
  // A new adapter each time, so each case reads the database's name afresh.
  const adapter = {
    getCapabilities: () => ({ dialect: "mysql" }),
  } as never;
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as never;
  return {
    tx,
    statements,
    registry: new DynamicCollectionRegistryService(adapter, logger),
  };
}

function isLockName(param: unknown): param is string {
  return typeof param === "string" && param.startsWith("nextly:collection:");
}

/** The lock names each statement calling `fn` names, in the order it names them. */
function lockNamesIn(
  statements: readonly { sql: string; params: unknown[] }[],
  fn: "GET_LOCK" | "RELEASE_LOCK"
): string[][] {
  return statements
    .filter(query => query.sql.includes(fn))
    .map(query => query.params.filter(isLockName));
}
