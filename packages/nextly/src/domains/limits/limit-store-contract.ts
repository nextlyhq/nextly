/**
 * The limit store contract, as cases any store can be run through: the
 * memory and database stores here, and an app's own.
 *
 * Framework-free, like the rest of `nextly/testing`: each case is a name and
 * an async function that throws {@link LimitStoreContractViolation} when the
 * store breaks the contract, so a runner declares one test per case:
 *
 * ```ts
 * import { limitStoreContract } from "nextly/testing";
 *
 * for (const contractCase of limitStoreContract) {
 *   it(contractCase.name, () => contractCase.run({ first, second }));
 * }
 * ```
 *
 * `first` and `second` are the handles two instances of the site hold. For a
 * store every instance shares (`shared: true`), they reach one store; for a
 * store kept in one process, the same store twice. For a store that is not
 * shared, pass each instance's own: a case marked `acrossInstances` then runs
 * on the first alone, since such a store promises nothing across instances,
 * and what the case holds within one store is still required. Every case uses
 * keys of its own, so the cases can share one store.
 *
 * @experimental
 * @module domains/limits/limit-store-contract
 */
import { randomUUID } from "node:crypto";

import type { LimitStore, LimitUpdate, StoredLimit } from "./limit-store";

/** Two handles on one store, as two instances of a site hold it. */
export interface LimitStorePair {
  first: LimitStore;
  second: LimitStore;
}

/** One case of the contract. */
export interface LimitStoreContractCase {
  name: string;
  /**
   * Whether the case reads across the two instances. For a store with
   * `shared: false` it runs on the first handle alone.
   */
  acrossInstances: boolean;
  run(pair: LimitStorePair): Promise<void>;
}

/**
 * A store broke the contract. A report for the test runner, never thrown at
 * a request.
 */
export class LimitStoreContractViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitStoreContractViolation";
  }
}

/** Fail the case unless `holds`. */
function expectThat(holds: boolean, message: string): void {
  if (!holds) throw new LimitStoreContractViolation(message);
}

/** A key no other case, or earlier run, uses. */
function freshKey(label: string): string {
  return `contract:${randomUUID()}:${label}`;
}

/** A count kept as an entry's value. */
interface Counted {
  n: number;
}

/** The count an entry holds, 0 for none. */
function countOf(entry: StoredLimit | undefined): number {
  const value = entry?.value as Partial<Counted> | undefined;
  return typeof value?.n === "number" ? value.n : 0;
}

/**
 * An update adding one to each key's count, for a minute, answering the
 * counts it found.
 */
function increment(
  keys: readonly string[]
): (
  current: ReadonlyMap<string, StoredLimit>,
  now: number
) => LimitUpdate<number[]> {
  return (current, now) => {
    const found = keys.map(key => countOf(current.get(key)));
    const write = new Map<string, StoredLimit | null>(
      keys.map((key, index) => [
        key,
        { value: { n: (found[index] ?? 0) + 1 }, expiresAt: now + 60_000 },
      ])
    );
    return { write, result: found };
  };
}

/** Write `value` under `key`, lapsing `ttlMs` after the store's now. */
function put(
  store: LimitStore,
  key: string,
  value: unknown,
  ttlMs: number
): Promise<void> {
  return store.update([key], (_current, now) => ({
    write: new Map([[key, { value, expiresAt: now + ttlMs }]]),
    result: undefined,
  }));
}

/**
 * How many further sweeps the sweep case allows before one must find
 * nothing: room for a store that bounds each sweep's work, and for entries of
 * other cases that expire meanwhile.
 */
const SWEEPS_TO_DRAIN = 20;

/** Wait `ms` of real time. */
function pause(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Whether `promise` rejected, and with what. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error ?? new LimitStoreContractViolation("rejected with nothing");
  }
  return undefined;
}

/** Run `count` increments of `keys`, alternating between the two handles. */
function concurrently(
  pair: LimitStorePair,
  count: number,
  keys: readonly string[]
): Promise<number[][]> {
  return Promise.all(
    Array.from({ length: count }, (_, index) =>
      (index % 2 === 0 ? pair.first : pair.second).update(keys, increment(keys))
    )
  );
}

/**
 * The handles a case spanning instances runs on: as given for a store every
 * instance shares, and the first twice for one that is not.
 */
function acrossInstances(pair: LimitStorePair): LimitStorePair {
  return pair.first.shared ? pair : { first: pair.first, second: pair.first };
}

/** The cases, before each spanning instances is given the handles it runs on. */
const cases: readonly LimitStoreContractCase[] = [
  {
    name: "a new key reads as absent, and an update writes it for the other instance to read",
    acrossInstances: true,
    async run({ first, second }) {
      const key = freshKey("new");
      expectThat(
        (await first.read([key])).size === 0,
        "a new key read as present"
      );
      const found = await first.update([key], increment([key]));
      expectThat(found[0] === 0, "an update saw an entry for a new key");
      const read = await second.read([key]);
      expectThat(
        countOf(read.get(key)) === 1,
        "the other instance did not read the write"
      );
    },
  },
  {
    name: "a value comes back as written, and changing what was read changes nothing stored",
    acrossInstances: false,
    async run({ first }) {
      const key = freshKey("value");
      const value = { list: [1, "two", { three: true }], text: "é ✓" };
      await put(first, key, value, 60_000);
      const read = await first.read([key]);
      const entry = read.get(key);
      expectThat(
        JSON.stringify(entry?.value) === JSON.stringify(value),
        "the value read differs from the value written"
      );
      // Through a local, so no write goes through `?.`; an absent entry
      // still fails here, as it did.
      const written = entry?.value as { text: string };
      written.text = "changed";
      const again = await first.read([key]);
      expectThat(
        (again.get(key)?.value as { text?: string } | undefined)?.text ===
          "é ✓",
        "changing a value read changed the stored entry"
      );
    },
  },
  {
    name: "writing null deletes an entry",
    acrossInstances: true,
    async run({ first, second }) {
      const key = freshKey("delete");
      await put(first, key, { n: 1 }, 60_000);
      await second.update([key], () => ({
        write: new Map([[key, null]]),
        result: undefined,
      }));
      expectThat(
        (await first.read([key])).size === 0,
        "a deleted entry still reads"
      );
    },
  },
  {
    name: "an entry past its expiry reads as absent, to a read and to an update",
    acrossInstances: true,
    async run({ first, second }) {
      const key = freshKey("expiry");
      await put(first, key, { n: 1 }, 100);
      await pause(300);
      expectThat(
        (await second.read([key])).size === 0,
        "an expired entry still reads"
      );
      const found = await second.update([key], increment([key]));
      expectThat(found[0] === 0, "an update saw an expired entry");
    },
  },
  {
    name: "an entry written already expired is not stored",
    acrossInstances: false,
    async run({ first }) {
      const key = freshKey("written-expired");
      await first.update([key], (_current, now) => ({
        write: new Map([[key, { value: { n: 1 }, expiresAt: now - 1 }]]),
        result: undefined,
      }));
      expectThat(
        (await first.read([key])).size === 0,
        "an entry written expired reads"
      );
    },
  },
  {
    name: "an update writing a key it did not name is refused, and writes nothing",
    acrossInstances: false,
    async run({ first }) {
      const named = freshKey("named");
      const other = freshKey("not-named");
      const refusal = await rejectionOf(
        first.update([named], (_current, now) => ({
          write: new Map([
            [named, { value: { n: 1 }, expiresAt: now + 60_000 }],
            [other, { value: { n: 1 }, expiresAt: now + 60_000 }],
          ]),
          result: undefined,
        }))
      );
      expectThat(
        refusal !== undefined,
        "a write to a key not named was accepted"
      );
      expectThat(
        (await first.read([named, other])).size === 0,
        "a refused update wrote part of itself"
      );
    },
  },
  {
    name: "an update whose apply throws writes nothing and rejects with that error",
    acrossInstances: false,
    async run({ first }) {
      const key = freshKey("apply-throws");
      const thrown = new LimitStoreContractViolation("thrown by apply");
      const refusal = await rejectionOf(
        first.update([key], () => {
          throw thrown;
        })
      );
      expectThat(
        refusal === thrown,
        "the update did not reject with apply's error"
      );
      expectThat((await first.read([key])).size === 0, "a failed update wrote");
    },
  },
  {
    name: "50 updates of one new key over two instances lose none",
    acrossInstances: true,
    async run(pair) {
      const key = freshKey("burst-new");
      const seen = (await concurrently(pair, 50, [key])).map(found => found[0]);
      const counts = await pair.first.read([key]);
      expectThat(
        countOf(counts.get(key)) === 50,
        "an update of a new key was lost"
      );
      expectThat(
        new Set(seen).size === 50,
        "two updates of one key saw the same count"
      );
    },
  },
  {
    name: "50 updates of one existing key over two instances lose none",
    acrossInstances: true,
    async run(pair) {
      const key = freshKey("burst-existing");
      await pair.first.update([key], increment([key]));
      await concurrently(pair, 50, [key]);
      const counts = await pair.second.read([key]);
      expectThat(
        countOf(counts.get(key)) === 51,
        "an update of an existing key was lost"
      );
    },
  },
  {
    name: "50 updates of a pair of keys over two instances never see half of another's write",
    acrossInstances: true,
    async run(pair) {
      const keys = [freshKey("pair-a"), freshKey("pair-b")];
      const seen = await concurrently(pair, 50, keys);
      expectThat(
        seen.every(([a, b]) => a === b),
        "an update saw one key of another update's write without the other"
      );
      const counts = await pair.first.read(keys);
      expectThat(
        keys.every(key => countOf(counts.get(key)) === 50),
        "an update of a pair of keys was lost"
      );
    },
  },
  {
    name: "first updates naming the same new keys in opposite orders all complete",
    acrossInstances: true,
    async run({ first, second }) {
      for (let round = 0; round < 10; round += 1) {
        const keys = [
          freshKey(`order-${round}-a`),
          freshKey(`order-${round}-b`),
        ];
        const reversed = [...keys].reverse();
        await Promise.all([
          first.update(keys, increment(keys)),
          second.update(reversed, increment(reversed)),
        ]);
        const counts = await first.read(keys);
        expectThat(
          keys.every(key => countOf(counts.get(key)) === 2),
          "an update of keys named in another order was lost"
        );
      }
    },
  },
  {
    name: "a sweep removes expired entries and says how many went, and sweeping again comes to none",
    acrossInstances: true,
    async run({ first, second }) {
      const keys = [
        freshKey("sweep-a"),
        freshKey("sweep-b"),
        freshKey("sweep-c"),
      ];
      for (const key of keys) await put(first, key, { n: 1 }, 100);
      await pause(300);
      const removed = await second.sweep();
      expectThat(
        removed >= keys.length,
        "the sweep removed fewer entries than expired"
      );
      expectThat(
        (await first.read(keys)).size === 0,
        "a swept entry still reads"
      );
      // Removed, not only counted: a store that reported the expired entries
      // and kept them would report them on every sweep, while one that only
      // bounds each sweep's work comes to a sweep that finds nothing.
      let sweeps = 0;
      while ((await second.sweep()) > 0) {
        sweeps += 1;
        expectThat(
          sweeps < SWEEPS_TO_DRAIN,
          `${SWEEPS_TO_DRAIN} more sweeps still found expired entries the first said it removed`
        );
      }
    },
  },
];

/** The cases every limit store must pass. */
export const limitStoreContract: readonly LimitStoreContractCase[] = cases.map(
  contractCase =>
    contractCase.acrossInstances
      ? {
          ...contractCase,
          run: (pair: LimitStorePair) =>
            contractCase.run(acrossInstances(pair)),
        }
      : contractCase
);
