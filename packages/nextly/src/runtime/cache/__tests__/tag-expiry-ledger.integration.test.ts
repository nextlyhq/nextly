/**
 * The cache tag expiry ledger on every dialect: a recorded tag is read back
 * with the database's time, an expiry again moves its one row forward, a
 * snapshot reads only what expired after its cursor, the clock is read even
 * from an empty table, and a prune removes only rows older than its cutoff.
 */
import { count } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { cacheTagExpiriesTables } from "../../../schemas/cache-tag-expiries";
import {
  createTagExpiryLedger,
  type TagExpiryLedger,
} from "../tag-expiry-ledger";

/** Wait `ms` of real time, so the database's clock moves on. */
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describeEachDialect("the cache tag expiry ledger", dialect => {
  let current: TestNextly;
  let ledger: TagExpiryLedger;

  const table = () => cacheTagExpiriesTables(dialect).nextlyCacheTagExpiries;
  const db = () =>
    current.adapter.getDrizzle<{
      select(fields: Record<string, unknown>): {
        from(table: unknown): PromiseLike<Array<{ rows: number }>>;
      };
      delete(table: unknown): PromiseLike<unknown>;
    }>();
  const rowCount = async () =>
    Number((await db().select({ rows: count() }).from(table()))[0]?.rows);

  beforeAll(async () => {
    current = await createTestNextly({ dialect });
    ledger = createTagExpiryLedger(current.adapter);
  });
  afterAll(async () => {
    await current?.destroy();
  });
  beforeEach(async () => {
    await db().delete(table());
  });

  it("reads a recorded tag back with when it expired, on the database's clock", async () => {
    const before = await ledger.changesSince(0);
    expect(Number.isFinite(before?.now)).toBe(true);

    expect(await ledger.record(["posts", "posts:hello", "posts"])).toBe(true);
    const after = await ledger.changesSince(0);

    expect([...(after?.expired.keys() ?? [])].sort()).toEqual([
      "posts",
      "posts:hello",
    ]);
    const expiredAt = after?.expired.get("posts") ?? 0;
    expect(expiredAt).toBeGreaterThanOrEqual(before?.now ?? Infinity);
    expect(expiredAt).toBeLessThanOrEqual(after?.now ?? -Infinity);
    expect(await rowCount()).toBe(2);
  });

  it("moves a tag's one row forward when it expires again", async () => {
    await ledger.record(["posts"]);
    const first = (await ledger.changesSince(0))?.expired.get("posts") ?? 0;
    await pause(30);
    await ledger.record(["posts"]);
    const second = (await ledger.changesSince(0))?.expired.get("posts") ?? 0;

    expect(second).toBeGreaterThan(first);
    expect(await rowCount()).toBe(1);
  });

  it("reads only what expired after its cursor", async () => {
    await ledger.record(["before"]);
    await pause(30);
    const snapshot = await ledger.changesSince(0);
    await pause(30);
    await ledger.record(["after"]);

    const later = await ledger.changesSince(snapshot?.now ?? 0);
    expect([...(later?.expired.keys() ?? [])]).toEqual(["after"]);
    // The next cursor reads back over the overlap, so a row committed late
    // is seen on the following snapshot.
    expect(later?.next).toBeLessThan(later?.now ?? 0);
  });

  it("keeps a row whose tag expired again after the prune found it", async () => {
    await ledger.record(["old-a", "old-b"]);
    await pause(1500);
    // Each delete is preceded by "old-a" expiring again, as a write landing
    // between the prune's select and its delete would make it.
    const adapter = current.adapter;
    const racing = createTagExpiryLedger({
      getCapabilities: () => adapter.getCapabilities(),
      tableExists: table => adapter.tableExists(table),
      getDrizzle: (() => {
        const real = adapter.getDrizzle<Record<string, unknown>>();
        return new Proxy(real, {
          get(target, key, receiver) {
            if (key !== "delete") return Reflect.get(target, key, receiver);
            return (table: unknown) => ({
              where: async (condition: unknown) => {
                await ledger.record(["old-a"]);
                return (
                  target.delete as (t: unknown) => {
                    where(c: unknown): Promise<unknown>;
                  }
                )(table).where(condition);
              },
            });
          },
        });
      }) as never,
    });

    expect(await racing.prune(750)).toBe(1);
    expect([...((await ledger.changesSince(0))?.expired.keys() ?? [])]).toEqual(
      ["old-a"]
    );
  });

  it("keeps a tag of the longest length Next.js assigns", async () => {
    const longest = "t".repeat(256);
    await ledger.record([longest]);
    expect((await ledger.changesSince(0))?.expired.has(longest)).toBe(true);
  });

  it("prunes only the rows older than its age, on the database's clock", async () => {
    await ledger.record(["old-a", "old-b"]);
    await pause(1500);
    await ledger.record(["new"]);

    // The old rows are 1.5 s old, the new one a few milliseconds.
    expect(await ledger.prune(750)).toBe(2);
    expect([...((await ledger.changesSince(0))?.expired.keys() ?? [])]).toEqual(
      ["new"]
    );
  });
});

describe("the cache tag expiry ledger's id", () => {
  it("is the tag's SHA-256, so every tag is one fixed width", async () => {
    const { tagExpiryId } = await import("../tag-expiry-ledger");
    expect(tagExpiryId("posts")).toMatch(/^[0-9a-f]{64}$/);
    expect(tagExpiryId("t".repeat(256))).toHaveLength(64);
    expect(tagExpiryId("a")).not.toBe(tagExpiryId("b"));
  });
});
