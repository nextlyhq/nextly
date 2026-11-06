/**
 * The cache tag expiry ledger on every dialect: a recorded tag is read back by
 * key with the database's time, an expiry again moves its one row forward, a
 * lookup of many tags is answered in batches, and a prune removes only rows
 * older than its age, keeping one whose tag expired again meanwhile.
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
  TAG_EXPIRY_GRACE_MS,
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
      update(table: unknown): {
        set(values: Record<string, unknown>): PromiseLike<unknown>;
      };
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

  it("reads a recorded tag back by key, with when it expired on the database's clock", async () => {
    const before = await ledger.expiriesOf(["posts"]);
    expect(before?.expired.size).toBe(0);

    const stored = await ledger.record(["posts", "posts:hello", "posts"]);
    expect([...(stored || new Map()).keys()].sort()).toEqual([
      "posts",
      "posts:hello",
    ]);
    const after = await ledger.expiriesOf(["posts", "posts:hello", "never"]);

    expect([...(after?.expired.keys() ?? [])].sort()).toEqual([
      "posts",
      "posts:hello",
    ]);
    expect(Number.isFinite(after?.now)).toBe(true);
    // Graced: a recorded expiry stands up to TAG_EXPIRY_GRACE_MS past the
    // database's time, and what the record resolved is what was stored.
    expect(after?.expired.get("posts")).toBeLessThanOrEqual(
      (after?.now ?? -1) + TAG_EXPIRY_GRACE_MS
    );
    expect(after?.expired.get("posts")).toBe(stored ? stored.get("posts") : -1);
    expect(await rowCount()).toBe(2);
  });

  it("moves a tag's one row forward when it expires again, and reads its current row", async () => {
    await ledger.record(["posts"]);
    const first =
      (await ledger.expiriesOf(["posts"]))?.expired.get("posts") ?? 0;
    await pause(30);
    await ledger.record(["posts"]);
    const second =
      (await ledger.expiriesOf(["posts"]))?.expired.get("posts") ?? 0;

    expect(second).toBeGreaterThan(first);
    expect(await rowCount()).toBe(1);
  });

  it("records an expiry past the database's time, by the grace", async () => {
    await ledger.record(["posts"]);
    const read = await ledger.expiriesOf(["posts"]);
    const stored = read?.expired.get("posts") ?? 0;
    const now = read?.now ?? Infinity;

    // Read straight after the record, within the grace: an ungraced row would
    // already be at or before the database's time.
    expect(stored).toBeGreaterThan(now);
    expect(stored).toBeLessThanOrEqual(now + TAG_EXPIRY_GRACE_MS);
  });

  it("never moves a row back, whatever time a record would store", async () => {
    await ledger.record(["posts"]);
    // A row already later than any record now would store: a racing writer's,
    // or one written while the database's clock ran ahead.
    const later =
      ((await ledger.expiriesOf(["posts"]))?.now ?? 0) + 60 * 60 * 1000;
    await db().update(table()).set({ expiredAt: later });

    const stored = await ledger.record(["posts"]);

    expect((await ledger.expiriesOf(["posts"]))?.expired.get("posts")).toBe(
      later
    );
    // What the record resolves is the time it wrote, not the later row's, so
    // its writer does not take that row as its own.
    expect(stored ? stored.get("posts") : Infinity).toBeLessThan(later);
  });

  it("resolves the time it wrote, not a racing writer's later one", async () => {
    // Another writer records the same tag straight after this record's write,
    // before it resolves.
    const adapter = current.adapter;
    const racing = createTagExpiryLedger({
      getCapabilities: () => adapter.getCapabilities(),
      tableExists: name => adapter.tableExists(name),
      getDrizzle: (() => {
        const real = adapter.getDrizzle<Record<string, unknown>>();
        type Upsert = (args: unknown) => Promise<unknown>;
        return new Proxy(real, {
          get(target, key, receiver) {
            if (key !== "insert") return Reflect.get(target, key, receiver);
            return (into: unknown) => ({
              values: (rows: unknown[]) => {
                const values = (
                  target.insert as (t: unknown) => {
                    values(r: unknown[]): Record<string, Upsert>;
                  }
                )(into).values(rows);
                const thenRace =
                  (method: string): Upsert =>
                  async args => {
                    const result = await values[method](args);
                    await pause(5);
                    await ledger.record(["posts"]);
                    return result;
                  };
                return {
                  onConflictDoUpdate: thenRace("onConflictDoUpdate"),
                  onDuplicateKeyUpdate: thenRace("onDuplicateKeyUpdate"),
                };
              },
            });
          },
        });
      }) as never,
    });

    const mine = (await racing.record(["posts"])) || new Map();
    const row = (await ledger.expiriesOf(["posts"]))?.expired.get("posts");

    expect(row).toBeGreaterThan(mine.get("posts") ?? Infinity);
  });

  it("answers a lookup of more tags than one statement asks for", async () => {
    const tags = Array.from({ length: 1200 }, (_, i) => `tag-${i}`);
    await ledger.record(tags);
    const found = await ledger.expiriesOf(tags);
    expect(found?.expired.size).toBe(1200);
  });

  it("keeps a row whose tag expired again after the prune found it", async () => {
    await ledger.record(["old-a", "old-b"]);
    // A recorded row stands TAG_EXPIRY_GRACE_MS ahead, so this makes it 1.5 s old.
    await pause(TAG_EXPIRY_GRACE_MS + 1500);
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
    expect([
      ...((await ledger.expiriesOf(["old-a", "old-b"]))?.expired.keys() ?? []),
    ]).toEqual(["old-a"]);
  });

  it("keeps a tag of the longest length Next.js assigns", async () => {
    const longest = "t".repeat(256);
    await ledger.record([longest]);
    expect((await ledger.expiriesOf([longest]))?.expired.has(longest)).toBe(
      true
    );
  });

  it("prunes only the rows older than its age, on the database's clock", async () => {
    await ledger.record(["old-a", "old-b"]);
    // A recorded row stands TAG_EXPIRY_GRACE_MS ahead, so this makes it 1.5 s old.
    await pause(TAG_EXPIRY_GRACE_MS + 1500);
    await ledger.record(["new"]);

    // The old rows are 1.5 s old; the new one is not yet past the database's time.
    expect(await ledger.prune(750)).toBe(2);
    expect([
      ...((
        await ledger.expiriesOf(["old-a", "old-b", "new"])
      )?.expired.keys() ?? []),
    ]).toEqual(["new"]);
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
