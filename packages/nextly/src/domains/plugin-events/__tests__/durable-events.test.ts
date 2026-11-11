/**
 * What recording a durable event refuses before it writes anything: a name
 * the plugin did not declare durable, and a payload that is not a JSON object
 * or is larger than the cap. The adapter here records every use, so a refusal
 * that reached the database shows; recording itself is exercised on every
 * dialect in `durable-events.integration.test.ts`.
 *
 * @module domains/plugin-events/__tests__/durable-events.test
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import type { PluginTransaction } from "../../../plugins/database/plugin-database";
import { linkPluginTransaction } from "../../../plugins/database/plugin-transaction-link";
import {
  createDurableEventRecorder,
  durableEventNames,
  MAX_DURABLE_PAYLOAD_BYTES,
  type DurableEventsAdapter,
} from "../durable-events";

const OWNER = "@test/orders";

/** A recorder for OWNER whose adapter records every use. */
function recorder() {
  const uses: string[] = [];
  const adapter: DurableEventsAdapter = {
    transaction: async () => {
      uses.push("transaction");
      throw new Error("a refused event reached the database");
    },
    afterCommit: async () => {
      uses.push("afterCommit");
    },
  };
  return {
    uses,
    events: createDurableEventRecorder({
      owner: OWNER,
      durable: durableEventNames([
        { name: "test-orders.paid", durable: true },
        { name: "test-orders.viewed" },
      ]),
      adapter: () => adapter,
    }),
  };
}

async function refusal(promise: Promise<unknown>): Promise<NextlyError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(NextlyError);
  return error as NextlyError;
}

describe("recording a durable event", () => {
  it("knows only the events the plugin declared durable", () => {
    expect([
      ...durableEventNames([
        { name: "test-orders.paid", durable: true },
        { name: "test-orders.viewed" },
        { name: "test-orders.cancelled", durable: false },
      ]),
    ]).toEqual(["test-orders.paid"]);
    expect([...durableEventNames(undefined)]).toEqual([]);
  });

  it("refuses an event not declared durable, before writing", async () => {
    const { events, uses } = recorder();
    // Declared, but not durable; another plugin's; and one nobody declared.
    for (const name of [
      "test-orders.viewed",
      "acme-billing.charged",
      "test-orders.unknown",
    ]) {
      const error = await refusal(events.record(name, { id: "o-1" }));
      expect(error.code).toBe("INVALID_INPUT");
      expect(error.publicMessage).toContain(name);
    }
    expect(uses).toEqual([]);
  });

  it("refuses a payload that is not a JSON object, or is too large", async () => {
    const { events, uses } = recorder();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const notObjects: unknown[] = [null, "paid", 42, ["o-1"]];
    for (const payload of [
      ...notObjects,
      cycle,
      { amount: BigInt(10) },
      { note: "x".repeat(MAX_DURABLE_PAYLOAD_BYTES) },
      // An object whose own JSON is not an object: what is stored is what
      // JSON.stringify gives, so that is what is judged.
      { toJSON: () => "scalar" },
      { toJSON: () => [1, 2] },
      { toJSON: () => undefined },
    ]) {
      const error = await refusal(
        events.record("test-orders.paid", payload as Record<string, unknown>)
      );
      expect(error.code).toBe("INVALID_INPUT");
    }
    expect(uses).toEqual([]);
  });

  it("measures the cap in bytes, as stored, not in characters", async () => {
    const { events, uses } = recorder();
    // Each "é" is one character and two bytes of UTF-8: a note of half the
    // cap in characters is the whole cap in bytes, and over it once wrapped.
    const error = await refusal(
      events.record("test-orders.paid", {
        note: "é".repeat(MAX_DURABLE_PAYLOAD_BYTES / 2),
      })
    );
    expect(error.code).toBe("INVALID_INPUT");
    expect(uses).toEqual([]);
  });

  it("holds the commit's effect while its write is still tracked, so a transaction that ends as the write lands still runs it", async () => {
    // A plugin transaction whose handle closes the moment its last tracked
    // statement settles, as one does when its callback returned without
    // awaiting the emit: nothing may be asked of it after that.
    let open = true;
    const held: Array<() => unknown> = [];
    const handle = {} as PluginTransaction;
    const tx = {
      insert: async () => undefined,
    } as unknown as TransactionContext;
    linkPluginTransaction(
      handle,
      tx,
      {
        assertOpen: () => {
          if (!open) throw new Error("plugin-transaction-finished");
        },
        track: <R>(work: PromiseLike<R>) =>
          Promise.resolve(work).finally(() => {
            open = false;
          }),
        started: () => 0,
        quiet: () => true,
        quiesce: async () => {},
        fail: () => {},
      },
      effect => held.push(effect)
    );
    const offer = vi.fn();
    const events = createDurableEventRecorder({
      owner: OWNER,
      durable: durableEventNames([{ name: "test-orders.paid", durable: true }]),
      // Not used: the event is written on the handle.
      adapter: () => ({
        transaction: () => Promise.reject(new Error("used the adapter")),
        afterCommit: () => Promise.reject(new Error("used the adapter")),
      }),
      kick: () => ({ offer }),
    });

    await expect(
      events.record("test-orders.paid", { order: "o-1" }, { tx: handle })
    ).resolves.toMatchObject({ id: expect.any(String) });
    expect(held).toHaveLength(1);
    expect(offer).not.toHaveBeenCalled();
    held[0]?.();
    expect(offer).toHaveBeenCalledTimes(1);
  });
});
