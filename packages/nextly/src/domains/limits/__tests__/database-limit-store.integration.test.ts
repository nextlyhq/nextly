/**
 * The database limit store on every dialect, through two instances on one
 * database: the contract every store keeps, its bound against one key at a
 * time and against a burst, the removal of a rotated-out secret's entries,
 * expiry on the database's clock, the sweep, and its own transactions.
 */
import { randomUUID } from "node:crypto";

import { and, count, eq, notLike } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createAdapter } from "../../../database/factory";
import { setNextlyLogger } from "../../../observability/logger";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  LIMIT_STORE_COUNTER_PREFIX,
  limitStoreTables,
} from "../../../schemas/limit-store";
import {
  createDatabaseLimitStore,
  type DatabaseLimitStore,
} from "../database-limit-store";
import {
  limitStoreUnavailableReason,
  type LimitStore,
  type StoredLimit,
} from "../limit-store";
import { limitStoreContract } from "../limit-store-contract";

type TestAdapter = Awaited<ReturnType<typeof createAdapter>>;

/** A generation no other test uses, so each test counts against its own bound. */
const freshGeneration = () => randomUUID().replaceAll("-", "").slice(0, 16);

/** Write a count of one under `key`, for an hour. */
function count1(key: string) {
  return (_current: ReadonlyMap<string, StoredLimit>, now: number) => ({
    write: new Map([[key, { value: { n: 1 }, expiresAt: now + 3_600_000 }]]),
    result: undefined,
  });
}

/** What `promise` rejected with, or undefined when it resolved. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

/** A promise and the function that settles it, to hold a flow at one point. */
function gate(): { wait: Promise<void>; open: () => void } {
  let settle: () => void = () => undefined;
  const wait = new Promise<void>(resolve => {
    settle = resolve;
  });
  return { wait, open: () => settle() };
}

/** Wait `ms` of real time. */
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Every line logged while a test runs. */
function captureLog() {
  const lines: Record<string, unknown>[] = [];
  const record = (payload: object) =>
    lines.push(payload as Record<string, unknown>);
  setNextlyLogger({ error: record, warn: record, info: record, debug: record });
  return lines;
}

afterEach(() => {
  setNextlyLogger(undefined);
});

describeEachDialect("the database limit store", dialect => {
  let current: TestNextly;
  /** The second instance's connection to the same database. */
  let other: TestAdapter;
  const opened: DatabaseLimitStore[] = [];

  beforeAll(async () => {
    current = await createTestNextly({ dialect });
    if (dialect === "sqlite") {
      // Two instances on one SQLite file are two processes, which the file's
      // lock serializes. Two connections in ONE process cannot stand in for
      // them: better-sqlite3 waits for a locked file synchronously, blocking
      // the event loop the holding transaction needs to finish, so each waits
      // out the other's busy timeout. Both stores share the instance's one
      // connection instead, whose transaction queue serializes them as the
      // file lock does across processes.
      other = current.adapter;
    } else {
      // The database the instance above was given, for a second instance.
      const url = process.env.DATABASE_URL;
      if (url === undefined)
        throw new Error("no database for a second instance");
      other = await createAdapter({ type: dialect, url });
    }
  });

  afterAll(async () => {
    await Promise.all(opened.map(store => store.close()));
    if (other !== current.adapter) await other.disconnect();
    await current.destroy();
  });

  /** A store on `adapter`, sweeping only when told to. */
  function open(
    adapter: TestAdapter,
    generation: string,
    maxEntries?: number,
    sweepIntervalMs: number | false = false
  ): DatabaseLimitStore {
    const store = createDatabaseLimitStore({
      adapter,
      generation,
      maxEntries,
      sweepIntervalMs,
    });
    opened.push(store);
    return store;
  }

  /** Entry rows of `generation` in the table, expired or not. */
  async function rowsOf(generation: string): Promise<number> {
    const table = limitStoreTables(dialect).nextlyLimitStore;
    const db = current.adapter.getDrizzle<{
      select(fields: object): {
        from(table: unknown): {
          where(c: unknown): Promise<{ rows: number }[]>;
        };
      };
    }>();
    const [row] = await db
      .select({ rows: count() })
      .from(table)
      .where(
        and(
          eq(table.generation, generation),
          notLike(table.id, `${LIMIT_STORE_COUNTER_PREFIX}%`)
        )
      );
    return Number(row?.rows ?? 0);
  }

  /** Whether `generation`'s counter row is still there. */
  async function counterOf(generation: string): Promise<boolean> {
    const table = limitStoreTables(dialect).nextlyLimitStore;
    const db = current.adapter.getDrizzle<{
      select(fields: object): {
        from(table: unknown): {
          where(c: unknown): Promise<{ rows: number }[]>;
        };
      };
    }>();
    const [row] = await db
      .select({ rows: count() })
      .from(table)
      .where(eq(table.id, `${LIMIT_STORE_COUNTER_PREFIX}${generation}`));
    return Number(row?.rows ?? 0) > 0;
  }

  describe("keeps the limit store contract", () => {
    const generation = freshGeneration();
    let first: LimitStore;
    let second: LimitStore;
    beforeAll(() => {
      first = open(current.adapter, generation);
      second = open(other, generation);
    });
    for (const contractCase of limitStoreContract) {
      it(contractCase.name, async () => {
        const lines = captureLog();
        await contractCase.run({ first, second });
        // Retried quietly, a deadlock would pass the case; none may happen.
        expect(
          lines.filter(line => line.kind === "limit-store-conflict-retried")
        ).toEqual([]);
      });
    }
  });

  it("holds live entries to its bound: a live count stays, the next new key is unavailable, and it warned first", async () => {
    const lines = captureLog();
    const generation = freshGeneration();
    const store = open(current.adapter, generation, 5);
    const keys = Array.from({ length: 5 }, (_, index) => `bound-${index}`);
    for (const key of keys) await store.update([key], count1(key));

    const refusal = await rejectionOf(
      store.update(["bound-new"], count1("bound-new"))
    );

    expect(limitStoreUnavailableReason(refusal)).toBe("full");
    expect((await store.read(keys)).size).toBe(5);
    expect(lines.map(line => line.kind)).toEqual([
      "limit-store-filling",
      "limit-store-full",
    ]);
  });

  it("holds the bound against a burst of new keys on two instances", async () => {
    const generation = freshGeneration();
    const first = open(current.adapter, generation, 10);
    const second = open(other, generation, 10);
    const keys = Array.from({ length: 30 }, (_, index) => `burst-${index}`);

    const outcomes = await Promise.allSettled(
      keys.map((key, index) =>
        (index % 2 === 0 ? first : second).update([key], count1(key))
      )
    );

    const admitted = outcomes.filter(outcome => outcome.status === "fulfilled");
    const refused = outcomes.filter(
      outcome =>
        outcome.status === "rejected" &&
        limitStoreUnavailableReason(outcome.reason) === "full"
    );
    expect(admitted).toHaveLength(10);
    expect(refused).toHaveLength(20);
    expect((await first.read(keys)).size).toBe(10);
    expect(await rowsOf(generation)).toBe(10);
  });

  it("keeps a rotated-out secret's live entries out of the new count, and removes them once they expire", async () => {
    const before = freshGeneration();
    const old = open(current.adapter, before, 3);
    for (const key of ["old-a", "old-b", "old-c"]) {
      await old.update([key], (_current, now) => ({
        write: new Map([[key, { value: { n: 1 }, expiresAt: now + 300 }]]),
        result: undefined,
      }));
    }
    expect(
      limitStoreUnavailableReason(
        await rejectionOf(old.update(["old-d"], count1("old-d")))
      )
    ).toBe("full");

    // An instance restarted under the rotated secret, while the earlier one
    // may still be running: its entries count apart, and stay while live.
    const rotated = open(other, freshGeneration(), 3);
    for (const key of ["new-a", "new-b", "new-c"]) {
      await expect(rotated.update([key], count1(key))).resolves.toBeUndefined();
    }
    // A sweep while they are live leaves them.
    await rotated.sweep();
    expect(await rowsOf(before)).toBe(3);

    await pause(500);
    await rotated.sweep();

    expect(await rowsOf(before)).toBe(0);
    expect(await counterOf(before)).toBe(false);
  });

  it("settles close only once a sweep under way has finished", async () => {
    const store = open(current.adapter, freshGeneration());
    let swept = false;
    const sweeping = store.sweep().then(() => {
      swept = true;
    });

    await store.close();

    expect(swept).toBe(true);
    await sweeping;
  });

  it("gives a burst after expiry the room a sweep frees, rather than refusing it", async () => {
    const generation = freshGeneration();
    const store = open(current.adapter, generation, 3);
    for (const key of ["lapsing-a", "lapsing-b", "lapsing-c"]) {
      await store.update([key], (_current, now) => ({
        write: new Map([[key, { value: { n: 1 }, expiresAt: now + 100 }]]),
        result: undefined,
      }));
    }
    await pause(300);

    const outcomes = await Promise.allSettled(
      Array.from({ length: 6 }, (_, index) =>
        store.update([`burst-after-${index}`], count1(`burst-after-${index}`))
      )
    );

    // The three lapsed entries make room for three; the rest find it full.
    expect(
      outcomes.filter(outcome => outcome.status === "fulfilled")
    ).toHaveLength(3);
  });

  it("writes nothing on a first read, which may be made inside the caller's transaction", async () => {
    const generation = freshGeneration();
    const store = open(current.adapter, generation);

    await current.adapter.transaction(() => store.read(["quiet"]));

    expect(await counterOf(generation)).toBe(false);
  });

  it("keeps two generations' entries for one key apart during a rolling rotation", async () => {
    const earlier = open(current.adapter, freshGeneration());
    const later = open(other, freshGeneration());
    const key = "same-key-both-cohorts";
    const increment = (
      current: ReadonlyMap<string, StoredLimit>,
      now: number
    ) => ({
      write: new Map([
        [
          key,
          {
            value: {
              n:
                ((current.get(key)?.value as { n?: number } | undefined)?.n ??
                  0) + 1,
            },
            expiresAt: now + 3_600_000,
          },
        ],
      ]),
      result: undefined,
    });

    await earlier.update([key], increment);
    await later.update([key], increment);
    await later.update([key], increment);

    // Each cohort still reads its own count, and neither overwrote the other.
    expect((await earlier.read([key])).get(key)?.value).toEqual({ n: 1 });
    expect((await later.read([key])).get(key)?.value).toEqual({ n: 2 });
  });

  it("never sweeps again once closed", async () => {
    const generation = freshGeneration();
    const store = open(current.adapter, generation, undefined, 100);
    await store.close();
    for (const key of ["closed-a", "closed-b"]) {
      await store.update([key], (_current, now) => ({
        write: new Map([[key, { value: { n: 1 }, expiresAt: now + 100 }]]),
        result: undefined,
      }));
    }

    await pause(800);

    expect(await rowsOf(generation)).toBe(2);
  });

  it("reads expiry on the database's clock, never the caller's", async () => {
    const store = open(current.adapter, freshGeneration());
    await store.update(["skew"], (_current, now) => ({
      write: new Map([["skew", { value: { n: 1 }, expiresAt: now + 200 }]]),
      result: undefined,
    }));
    await pause(400);

    // The caller's clock an hour behind the database's.
    const behind = Date.now() - 3_600_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(behind);
    try {
      expect((await store.read(["skew"])).size).toBe(0);
    } finally {
      clock.mockRestore();
    }
  });

  it("sweeps expired entries away on its own", async () => {
    const generation = freshGeneration();
    const store = open(current.adapter, generation, undefined, 100);
    for (const key of ["swept-a", "swept-b"]) {
      await store.update([key], (_current, now) => ({
        write: new Map([[key, { value: { n: 1 }, expiresAt: now + 100 }]]),
        result: undefined,
      }));
    }
    expect(await rowsOf(generation)).toBe(2);

    await pause(800);

    expect(await rowsOf(generation)).toBe(0);
  });

  it("refuses an update made inside the caller's own transaction", async () => {
    const store = open(current.adapter, freshGeneration());

    const refusal = await current.adapter.transaction(() =>
      rejectionOf(store.update(["in-tx"], count1("in-tx")))
    );

    expect(refusal).toMatchObject({ code: "INTERNAL_ERROR" });
    expect((await store.read(["in-tx"])).size).toBe(0);
  });

  if (dialect === "sqlite") {
    it("keeps a count made while another flow's transaction is open and then rolls back", async () => {
      const store = open(current.adapter, freshGeneration());
      await store.read(["warm"]);
      const started = gate();
      const held = gate();

      const rolledBack = current.adapter
        .transaction(async () => {
          started.open();
          await held.wait;
          throw new Error("roll the other flow's work back");
        })
        .catch(() => undefined);
      await started.wait;
      const counting = store.update(["kept"], count1("kept"));
      held.open();
      await counting;
      await rolledBack;

      expect((await store.read(["kept"])).size).toBe(1);
    });
  }
});
