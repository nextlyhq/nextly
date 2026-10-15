/**
 * The memory limit store: the contract every store keeps, and its bound.
 *
 * Full of live entries, it must answer a new key as unavailable rather than
 * drop a live count to make room: dropping one would let anybody able to send
 * new keys free the count of an attacker they are covering for.
 */
import { afterEach, describe, expect, it } from "vitest";

import { setNextlyLogger } from "../../../observability/logger";
import {
  limitStoreContract,
  LimitStoreContractViolation,
} from "../limit-store-contract";
import {
  limitStoreUnavailableReason,
  type LimitStore,
  type StoredLimit,
} from "../limit-store";
import { createMemoryLimitStore } from "../memory-limit-store";

/** Every line logged while a test runs, by level. */
function captureLog() {
  const lines: { level: string; payload: Record<string, unknown> }[] = [];
  const record = (level: string) => (payload: object) =>
    lines.push({ level, payload: payload as Record<string, unknown> });
  setNextlyLogger({
    error: record("error"),
    warn: record("warn"),
    info: record("info"),
    debug: record("debug"),
  });
  return lines;
}

afterEach(() => {
  setNextlyLogger(undefined);
});

/** Write a count of one under `key`, for an hour of `clock`. */
function count(key: string) {
  return (_current: ReadonlyMap<string, StoredLimit>, now: number) => ({
    write: new Map([[key, { value: { n: 1 }, expiresAt: now + 3_600_000 }]]),
    result: undefined,
  });
}

describe("the memory store keeps the limit store contract", () => {
  // One process: both instances are the one store.
  const store = createMemoryLimitStore();
  for (const contractCase of limitStoreContract) {
    it(contractCase.name, () =>
      contractCase.run({ first: store, second: store })
    );
  }
});

describe("the contract, for a store each instance holds its own of", () => {
  // Two instances, each with its own memory store, as a site of two
  // instances on the default store has them: `shared: false` promises
  // nothing across instances, so the cases that span them hold within one.
  const first = createMemoryLimitStore();
  const second = createMemoryLimitStore();
  for (const contractCase of limitStoreContract) {
    it(contractCase.name, () => contractCase.run({ first, second }));
  }
});

describe("the contract's sweep case", () => {
  it("passes a store that bounds each sweep, with expired entries of others left for later sweeps", async () => {
    // A minimal store whose every sweep removes at most three entries.
    const entries = new Map<string, StoredLimit>();
    const bounded: LimitStore = {
      shared: false,
      update: async (keys, apply) => {
        const now = Date.now();
        const current = new Map(
          keys.flatMap(key => {
            const entry = entries.get(key);
            return entry && entry.expiresAt > now
              ? [[key, entry] as const]
              : [];
          })
        );
        const { write, result } = apply(current, now);
        for (const [key, entry] of write) {
          if (entry === null || entry.expiresAt <= now) entries.delete(key);
          else entries.set(key, entry);
        }
        return result;
      },
      read: async keys => {
        const now = Date.now();
        return new Map(
          keys.flatMap(key => {
            const entry = entries.get(key);
            return entry && entry.expiresAt > now
              ? [[key, entry] as const]
              : [];
          })
        );
      },
      sweep: async () => {
        const now = Date.now();
        let removed = 0;
        for (const [key, entry] of entries) {
          if (removed === 3) break;
          if (entry.expiresAt <= now) {
            entries.delete(key);
            removed += 1;
          }
        }
        return removed;
      },
    };
    // Two expired entries of others, ahead of the case's own.
    for (const key of ["other-a", "other-b"]) {
      entries.set(key, { value: { n: 1 }, expiresAt: Date.now() + 50 });
    }
    const sweepCase = limitStoreContract.find(contractCase =>
      contractCase.name.startsWith("a sweep removes")
    );

    await expect(
      sweepCase?.run({ first: bounded, second: bounded })
    ).resolves.toBeUndefined();
  });

  it("fails a store that reports what expired but removes none of it", async () => {
    const memory = createMemoryLimitStore();
    // Says how many entries have expired, and leaves every one in place.
    const reportsOnly: LimitStore = {
      shared: false,
      update: (keys, apply) => memory.update(keys, apply),
      read: keys => memory.read(keys),
      sweep: async () => {
        const all = await memory.read(sweptKeys);
        return sweptKeys.length - all.size;
      },
    };
    const sweptKeys: string[] = [];
    const tracking: LimitStore = {
      ...reportsOnly,
      update: (keys, apply) => {
        sweptKeys.push(...keys);
        return reportsOnly.update(keys, apply);
      },
    };
    const sweepCase = limitStoreContract.find(contractCase =>
      contractCase.name.startsWith("a sweep removes")
    );

    await expect(
      sweepCase?.run({ first: tracking, second: tracking })
    ).rejects.toBeInstanceOf(LimitStoreContractViolation);
  });
});

describe("the memory store's bound", () => {
  it("keeps every live entry when full, and answers a new key as unavailable", async () => {
    const lines = captureLog();
    const store = createMemoryLimitStore({ maxEntries: 5 });
    for (let index = 0; index < 5; index += 1) {
      await store.update([`key-${index}`], count(`key-${index}`));
    }

    const refusal = await store.update(["key-new"], count("key-new")).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(limitStoreUnavailableReason(refusal)).toBe("full");
    // Every live count is still there, the first one included.
    const kept = await store.read(
      Array.from({ length: 5 }, (_, index) => `key-${index}`)
    );
    expect(kept.size).toBe(5);
    expect((await store.read(["key-new"])).size).toBe(0);
    // Warned while it filled, before it refused, and logged the refusal.
    const kinds = lines.map(line => line.payload.kind);
    expect(kinds).toEqual(["limit-store-filling", "limit-store-full"]);
  });

  it("still updates a key it holds while full", async () => {
    const store = createMemoryLimitStore({ maxEntries: 2 });
    await store.update(["a"], count("a"));
    await store.update(["b"], count("b"));

    await expect(store.update(["a"], count("a"))).resolves.toBeUndefined();
  });

  it("removes expired entries to make room, never a live one", async () => {
    let now = 1_000_000;
    const store = createMemoryLimitStore({ maxEntries: 2, clock: () => now });
    await store.update(["short"], (_current, at) => ({
      write: new Map([["short", { value: { n: 1 }, expiresAt: at + 1000 }]]),
      result: undefined,
    }));
    await store.update(["long"], count("long"));
    now += 2000;

    await store.update(["new"], count("new"));

    expect(store.size()).toBe(2);
    expect([...(await store.read(["short", "long", "new"])).keys()]).toEqual([
      "long",
      "new",
    ]);
  });

  it("warns once while filling, and again only after it has emptied", async () => {
    const lines = captureLog();
    const store = createMemoryLimitStore({ maxEntries: 10 });
    for (let index = 0; index < 9; index += 1) {
      await store.update([`k${index}`], count(`k${index}`));
    }
    expect(lines.filter(line => line.level === "warn")).toHaveLength(1);
    expect(lines[0]?.payload).toMatchObject({
      kind: "limit-store-filling",
      store: "memory",
      live: 8,
      maxEntries: 10,
    });

    for (let index = 0; index < 9; index += 1) {
      await store.update([`k${index}`], () => ({
        write: new Map([[`k${index}`, null]]),
        result: undefined,
      }));
    }
    for (let index = 0; index < 8; index += 1) {
      await store.update([`again${index}`], count(`again${index}`));
    }
    expect(lines.filter(line => line.level === "warn")).toHaveLength(2);
  });

  it("warns again after a sweep empties it and it fills once more", async () => {
    const lines = captureLog();
    let now = 1_700_000_000_000;
    const store = createMemoryLimitStore({ maxEntries: 10, clock: () => now });
    for (let index = 0; index < 8; index += 1) {
      await store.update([`k${index}`], count(`k${index}`));
    }
    expect(lines.filter(line => line.level === "warn")).toHaveLength(1);

    // Past every entry's hour: the sweep alone empties the store. Then one
    // update fills it past the threshold again, so no update in between
    // ever shows the watch an emptied store.
    now += 3_600_001;
    expect(await store.sweep()).toBe(8);
    const again = Array.from({ length: 8 }, (_, index) => `again${index}`);
    await store.update(again, (_current, at) => ({
      write: new Map(
        again.map(key => [key, { value: { n: 1 }, expiresAt: at + 3_600_000 }])
      ),
      result: undefined,
    }));

    expect(lines.filter(line => line.level === "warn")).toHaveLength(2);
  });

  it("refuses a key holding a lone surrogate, which would encode like another, as the caller's mistake", async () => {
    const store = createMemoryLimitStore();

    await expect(
      store.update(["\ud800"], count("\ud800"))
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    await expect(store.read(["\udc00"])).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });

  it("refuses a value that has no JSON form, such as a cycle, as the caller's mistake", async () => {
    const store = createMemoryLimitStore();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;

    const refusal = await store
      .update(["cyclic"], (_current, now) => ({
        write: new Map([["cyclic", { value: cycle, expiresAt: now + 1000 }]]),
        result: undefined,
      }))
      .then(
        () => undefined,
        (error: unknown) => error
      );

    expect(refusal).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(store.size()).toBe(0);
  });

  it("refuses a value larger than 4 KB, and writes nothing", async () => {
    const store = createMemoryLimitStore();
    const refusal = await store
      .update(["big"], (_current, now) => ({
        write: new Map([
          ["big", { value: "x".repeat(4097), expiresAt: now + 1000 }],
        ]),
        result: undefined,
      }))
      .then(
        () => undefined,
        (error: unknown) => error
      );

    expect(refusal).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(store.size()).toBe(0);
  });
});
