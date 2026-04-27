// Tests for the async mutex.
import { describe, expect, it } from "vitest";

import { createAsyncLock } from "./async-lock.js";

describe("async-lock", () => {
  it("serializes concurrent acquires in FIFO order", async () => {
    const lock = createAsyncLock();
    const order: string[] = [];

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    const p1 = lock.acquire(async () => {
      order.push("start-1");
      await sleep(50);
      order.push("end-1");
    });
    const p2 = lock.acquire(async () => {
      order.push("start-2");
      await sleep(10);
      order.push("end-2");
    });
    const p3 = lock.acquire(async () => {
      order.push("start-3");
      order.push("end-3");
    });

    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([
      "start-1",
      "end-1",
      "start-2",
      "end-2",
      "start-3",
      "end-3",
    ]);
  });

  it("a failing acquire does not poison the queue for the next caller", async () => {
    const lock = createAsyncLock();
    const p1 = lock.acquire(async () => {
      throw new Error("boom");
    });
    const p2 = lock.acquire(async () => "ok");

    await expect(p1).rejects.toThrow("boom");
    await expect(p2).resolves.toBe("ok");
  });

  it("returns the resolved value from the acquired fn", async () => {
    const lock = createAsyncLock();
    const result = await lock.acquire(async () => 42);
    expect(result).toBe(42);
  });
});
