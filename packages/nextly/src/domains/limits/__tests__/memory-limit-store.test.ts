/**
 * The memory limit store: the contract every store keeps, and its bound.
 *
 * Full of live entries, it must answer a new key as unavailable rather than
 * drop a live count to make room: dropping one would let anybody able to send
 * new keys free the count of an attacker they are covering for.
 */
import { afterEach, describe, expect, it } from "vitest";

import { setNextlyLogger } from "../../../observability/logger";
import { limitStoreContract } from "../limit-store-contract";
import { limitStoreUnavailableReason, type StoredLimit } from "../limit-store";
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
