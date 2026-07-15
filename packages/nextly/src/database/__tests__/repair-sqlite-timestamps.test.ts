/**
 * The one-time repair for timestamps SQLite stored as text.
 *
 * The assertions worth having are about what it does *not* touch. It rewrites
 * one shape of value in one kind of column, and everything else — integers
 * already correct, nulls meaning "never set", text that is not a timestamp —
 * has to come through untouched, because a wrong guess here silently destroys
 * data that the repair is supposed to be saving.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

import { repairSqliteTimestamps } from "../repair-sqlite-timestamps";

/**
 * A stand-in for the adapter that answers the three shapes of query the
 * repair issues, and records the writes.
 */
function createAdapter(
  schema: Record<string, { name: string; type: string }[]>,
  textCounts: Record<string, number> = {}
) {
  const updates: { sql: string; params: unknown[] }[] = [];

  const executeQuery = vi.fn((sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM sqlite_master")) {
      return Promise.resolve(Object.keys(schema).map(name => ({ name })));
    }
    if (sql.startsWith("PRAGMA table_info")) {
      const table = /table_info\("(.+)"\)/.exec(sql)?.[1] ?? "";
      return Promise.resolve(schema[table] ?? []);
    }
    if (sql.includes("COUNT(*)")) {
      const table = /FROM "([^"]+)"/.exec(sql)?.[1] ?? "";
      const column = /typeof\("([^"]+)"\)/.exec(sql)?.[1] ?? "";
      return Promise.resolve([{ n: textCounts[`${table}.${column}`] ?? 0 }]);
    }
    if (sql.trim().startsWith("UPDATE")) {
      updates.push({ sql, params });
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  });

  return { adapter: { executeQuery } as never, updates, executeQuery };
}

const TS = { name: "created_at", type: "integer" };
const TEXT_COL = { name: "title", type: "text" };

describe("repairSqliteTimestamps", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rewrites text timestamps in an integer column", async () => {
    const { adapter, updates } = createAdapter(
      { dc_posts: [TS] },
      { "dc_posts.created_at": 5 }
    );

    const result = await repairSqliteTimestamps(adapter);

    expect(result.repaired).toBe(5);
    expect(result.columns).toEqual(["dc_posts.created_at"]);
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain("strftime");
  });

  // The columns come from the database rather than a list, because a user's
  // own date field is as affected as the system ones and would be missed.
  it("repairs a user date field, not just the system columns", async () => {
    const { adapter, updates } = createAdapter(
      { dc_posts: [TS, { name: "published_at", type: "integer" }] },
      { "dc_posts.created_at": 2, "dc_posts.published_at": 3 }
    );

    const result = await repairSqliteTimestamps(adapter);

    expect(result.repaired).toBe(5);
    expect(result.columns).toEqual([
      "dc_posts.created_at",
      "dc_posts.published_at",
    ]);
    expect(updates).toHaveLength(2);
  });

  it("visits every table", async () => {
    const { adapter } = createAdapter(
      { dc_posts: [TS], dc_categories: [TS] },
      { "dc_posts.created_at": 1, "dc_categories.created_at": 4 }
    );

    const result = await repairSqliteTimestamps(adapter);

    expect(result.repaired).toBe(5);
    expect(result.columns).toEqual([
      "dc_posts.created_at",
      "dc_categories.created_at",
    ]);
  });

  // A repaired column holds integers, which the typeof guard skips — so a
  // second run has nothing to do. This is what makes the boot hook safe.
  it("writes nothing when there is nothing to repair", async () => {
    const { adapter, updates } = createAdapter({ dc_posts: [TS] }, {});

    const result = await repairSqliteTimestamps(adapter);

    expect(result.repaired).toBe(0);
    expect(result.columns).toEqual([]);
    expect(updates).toHaveLength(0);
  });

  it("leaves text columns alone", async () => {
    const { adapter, updates } = createAdapter(
      { dc_posts: [TEXT_COL] },
      { "dc_posts.title": 99 }
    );

    const result = await repairSqliteTimestamps(adapter);

    expect(result.repaired).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("skips sqlite's own tables", async () => {
    const { adapter, executeQuery } = createAdapter({ dc_posts: [TS] }, {});
    await repairSqliteTimestamps(adapter);

    const listing = executeQuery.mock.calls.find(([sql]) =>
      String(sql).includes("sqlite_master")
    );
    expect(String(listing?.[0])).toContain("name NOT LIKE 'sqlite_%'");
  });

  // strftime returns NULL for anything it cannot parse, and NULL is how the
  // column says "never set". Without the shape guard the repair would convert
  // unrelated text into a missing date.
  it("only touches values shaped like the timestamps the old writer wrote", async () => {
    const { adapter, updates } = createAdapter(
      { dc_posts: [TS] },
      { "dc_posts.created_at": 1 }
    );

    await repairSqliteTimestamps(adapter);

    expect(updates[0].sql).toContain("GLOB");
    expect(updates[0].params[0]).toBe(
      "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*"
    );
  });

  it("quotes identifiers", async () => {
    const { adapter, updates } = createAdapter(
      { "dc_odd name": [TS] },
      { "dc_odd name.created_at": 1 }
    );

    await repairSqliteTimestamps(adapter);

    expect(updates[0].sql).toContain('"dc_odd name"');
  });
});
