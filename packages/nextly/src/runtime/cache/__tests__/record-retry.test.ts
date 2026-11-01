/**
 * Tag expiries the ledger refused are retried until it takes them: by one
 * timer that backs off to 30 s, and by the next cached read where a timer may
 * never fire. Said once when retries begin and once when they succeed, never
 * retried for a missing table, and no timer outlives a withdrawn ledger.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setNextlyLogger } from "../../../observability/logger";
import { takePendingExpiries } from "../../../revalidation/expiry-handoff";
import {
  installTagExpiryLedger,
  withdrawTagExpiryLedger,
} from "../ledger-wiring";
import {
  FIRST_RETRY_DELAY_MS,
  holdFailedRecord,
  MAX_RETRY_DELAY_MS,
} from "../record-retry";
import type { TagExpiryLedger } from "../tag-expiry-ledger";
import { publishTagExpiryLedger } from "../tag-expiry-view";
import useCacheHandler from "../use-cache-handler";

const warn = vi.fn();
const info = vi.fn();

/** A ledger whose record answers as `answer` says, counting each attempt. */
function ledgerThat(answer: () => "ok" | "refuse" | "no-table") {
  const record = vi.fn(async (tags: readonly string[]) => {
    const now = answer();
    if (now === "refuse") throw new Error("connection reset");
    if (now === "no-table") return false as const;
    return new Map(tags.map(tag => [tag, Date.now()] as const));
  });
  const ledger: TagExpiryLedger = {
    record,
    expiriesOf: async () => ({ expired: new Map() }),
    prune: async () => 0,
  };
  publishTagExpiryLedger(ledger);
  return record;
}

beforeEach(() => {
  for (const key of [
    "__nextly_tag_expiry_view",
    "__nextly_expiry_handoff",
    "__nextly_expiry_fallback",
    "__nextly_expiry_for_request",
    "__nextly_record_retry",
    "__nextly_tag_ledger_withdrawn",
  ]) {
    delete (globalThis as Record<string, unknown>)[key];
  }
  vi.useFakeTimers();
  warn.mockReset();
  info.mockReset();
  const ignore = () => undefined;
  setNextlyLogger({ warn, info, error: ignore, debug: ignore });
});
afterEach(() => {
  withdrawTagExpiryLedger();
  vi.useRealTimers();
  setNextlyLogger(undefined);
});

describe("a record the ledger refused", () => {
  it("is retried by a timer until it is taken, said once each way, and leaves no timer behind", async () => {
    let refusing = true;
    const record = ledgerThat(() => (refusing ? "refuse" : "ok"));
    holdFailedRecord(["posts"]);
    holdFailedRecord(["pages"]);
    expect(vi.getTimerCount()).toBe(1);

    refusing = false;
    await vi.advanceTimersByTimeAsync(FIRST_RETRY_DELAY_MS);

    expect(record).toHaveBeenCalledTimes(1);
    expect([...record.mock.calls[0][0]].sort()).toEqual(["pages", "posts"]);
    expect(takePendingExpiries()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({
      kind: "cache-tag-record-retrying",
    });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toMatchObject({
      kind: "cache-tag-record-recovered",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits twice as long after each failure, never longer than 30 s, and says so only once", async () => {
    const record = ledgerThat(() => "refuse");
    holdFailedRecord(["posts"]);

    // Waits of 1, 2, 4, 8, 16, then 30 and 30 s.
    const waits = [1, 2, 4, 8, 16, 30, 30].map(s => s * 1_000);
    for (const [i, wait] of waits.entries()) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(record).toHaveBeenCalledTimes(i);
      await vi.advanceTimersByTimeAsync(1);
      expect(record).toHaveBeenCalledTimes(i + 1);
    }
    expect(Math.max(...waits)).toBe(MAX_RETRY_DELAY_MS);
    // The ledger's own warning that it could not record is said once too.
    expect(
      warn.mock.calls.filter(
        ([entry]) => entry.kind === "cache-tag-record-retrying"
      )
    ).toHaveLength(1);
    expect(info).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    // The tags are still kept, for the next flush as well.
    expect(takePendingExpiries()).toEqual(["posts"]);
  });

  it("stops retrying once the ledger has no table: no instance reads expiries until it does", async () => {
    const record = ledgerThat(() => "no-table");
    holdFailedRecord(["posts"]);

    await vi.advanceTimersByTimeAsync(FIRST_RETRY_DELAY_MS);
    await vi.advanceTimersByTimeAsync(10 * MAX_RETRY_DELAY_MS);

    expect(record).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(takePendingExpiries()).toEqual(["posts"]);
  });

  it("is retried by the next cached read where the timer never fired, but not before its wait is up", async () => {
    let refusing = true;
    const record = ledgerThat(() => (refusing ? "refuse" : "ok"));
    holdFailedRecord(["posts"]);
    refusing = false;

    // A read straight away waits for the backoff, as the timer would.
    await useCacheHandler.refreshTags();
    expect(record).not.toHaveBeenCalled();

    // A frozen function: the clock moves on, the timer does not run.
    vi.setSystemTime(Date.now() + FIRST_RETRY_DELAY_MS);
    await useCacheHandler.refreshTags();

    expect(record).toHaveBeenCalledTimes(1);
    expect(takePendingExpiries()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still retries a later refusal after a retry found its tags already taken by a flush", async () => {
    let refusing = true;
    const record = ledgerThat(() => (refusing ? "refuse" : "ok"));
    holdFailedRecord(["posts"]);
    // The next flush drains the kept tags before the timer fires.
    expect(takePendingExpiries()).toEqual(["posts"]);
    await vi.advanceTimersByTimeAsync(FIRST_RETRY_DELAY_MS);
    expect(record).not.toHaveBeenCalled();

    holdFailedRecord(["pages"]);
    refusing = false;
    await vi.advanceTimersByTimeAsync(FIRST_RETRY_DELAY_MS);

    expect(record).toHaveBeenCalledTimes(1);
    expect([...record.mock.calls[0][0]]).toEqual(["pages"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps retrying a refusal that came in while a retry was recording", async () => {
    let release: () => void = () => undefined;
    const calls: string[][] = [];
    const ledger: TagExpiryLedger = {
      record: async tags => {
        calls.push([...tags]);
        if (calls.length === 1) {
          await new Promise<void>(resolve => {
            release = resolve;
          });
        }
        return new Map(tags.map(tag => [tag, Date.now()] as const));
      },
      expiriesOf: async () => ({ expired: new Map() }),
      prune: async () => 0,
    };
    publishTagExpiryLedger(ledger);
    holdFailedRecord(["posts"]);
    await vi.advanceTimersByTimeAsync(FIRST_RETRY_DELAY_MS);
    expect(calls).toEqual([["posts"]]);

    // Refused while the retry of "posts" is still recording.
    holdFailedRecord(["pages"]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(FIRST_RETRY_DELAY_MS);

    expect(calls).toEqual([["posts"], ["pages"]]);
    expect(takePendingExpiries()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("takes up the kept tags again when the next ledger is installed", async () => {
    const adapter = {
      getCapabilities: () => ({ dialect: "sqlite" as const }),
      tableExists: async () => true,
      getDrizzle: () => {
        throw new Error("connection reset");
      },
    } as never;
    installTagExpiryLedger(adapter);
    holdFailedRecord(["posts"]);
    withdrawTagExpiryLedger();
    expect(vi.getTimerCount()).toBe(0);

    installTagExpiryLedger(adapter);

    expect(vi.getTimerCount()).toBe(1);
    expect(takePendingExpiries()).toEqual(["posts"]);
  });

  it("keeps the tags an attempt was recording when the ledger is withdrawn, and retries them into the next", async () => {
    let failOld: () => void = () => undefined;
    const old: TagExpiryLedger = {
      record: () =>
        new Promise((_resolve, reject) => {
          failOld = () => reject(new Error("connection reset"));
        }),
      expiriesOf: async () => ({ expired: new Map() }),
      prune: async () => 0,
    };
    publishTagExpiryLedger(old);
    holdFailedRecord(["posts"]);
    await vi.advanceTimersByTimeAsync(FIRST_RETRY_DELAY_MS);

    // Withdrawn while the old ledger is still recording "posts".
    withdrawTagExpiryLedger();
    const adapter = {
      getCapabilities: () => ({ dialect: "sqlite" as const }),
      tableExists: async () => true,
      getDrizzle: () => {
        throw new Error("connection reset");
      },
    } as never;
    installTagExpiryLedger(adapter);
    const record = ledgerThat(() => "ok");

    // The new ledger's retry runs while the old attempt still waits.
    await vi.advanceTimersByTimeAsync(FIRST_RETRY_DELAY_MS);
    expect(record).toHaveBeenCalledTimes(1);
    expect([...record.mock.calls[0][0]]).toEqual(["posts"]);

    // The old attempt fails late, and keeps or arms nothing again.
    failOld();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(takePendingExpiries()).toEqual([]);
  });

  it("does not let a waiting timer retry again straight after a read retried in its place", async () => {
    const record = ledgerThat(() => "refuse");
    holdFailedRecord(["posts"]);
    // A frozen function thaws: the clock is past the wait, the timer not run.
    vi.setSystemTime(Date.now() + FIRST_RETRY_DELAY_MS);
    await useCacheHandler.refreshTags();
    expect(record).toHaveBeenCalledTimes(1);

    // The next try waits the doubled backoff, not the overdue timer.
    await vi.advanceTimersByTimeAsync(2 * FIRST_RETRY_DELAY_MS - 1);
    expect(record).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(record).toHaveBeenCalledTimes(2);
  });

  it("leaves no timer once the ledger is withdrawn, and keeps the tags for the next one", async () => {
    const adapter = {
      getCapabilities: () => ({ dialect: "sqlite" as const }),
      tableExists: async () => true,
      getDrizzle: () => {
        throw new Error("connection reset");
      },
    } as never;
    installTagExpiryLedger(adapter);
    holdFailedRecord(["posts"]);
    expect(vi.getTimerCount()).toBe(1);

    withdrawTagExpiryLedger();

    expect(vi.getTimerCount()).toBe(0);
    expect(takePendingExpiries()).toEqual(["posts"]);
  });
});
