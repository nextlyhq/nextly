/**
 * Tag expiries the ledger refused are retried until it takes them: by one
 * timer that backs off to 30 s, and by the next cached read where a timer may
 * never fire. Each refused record is said with its tags; its retries are said
 * once when they begin and once when they succeed. Never retried for a missing
 * table, and no timer outlives a withdrawn ledger.
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
  READ_RETRY_WAIT_MS,
  retryFailedRecordsAtRead,
} from "../record-retry";
import type { TagExpiryLedger } from "../tag-expiry-ledger";
import {
  expireTags,
  isEntryExpired,
  LEDGER_CALL_TIMEOUT_MS,
  localNow,
  MAX_LEDGER_CALLS_IN_FLIGHT,
  publishTagExpiryLedger,
  refreshTagExpiries,
  TAG_LOOKUP_TTL_MS,
} from "../tag-expiry-view";
import { HANDOFF_TIMEOUT_MS, handOffWithin } from "../next-cache-revalidator";
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

  it("says each refused record with its tags, a refusal during a retry too, while the retries say only when they begin", async () => {
    // The first write is refused; its retry's call is held open, and the
    // second write is refused while that retry is under way.
    let releaseRetry: (() => void) | undefined;
    const answers: (() => Promise<never>)[] = [
      async () => {
        throw new Error("connection reset");
      },
      () =>
        new Promise<never>((_resolve, reject) => {
          releaseRetry = () => reject(new Error("connection reset"));
        }),
      async () => {
        throw new Error("connection reset");
      },
    ];
    const record = vi.fn(async () => {
      const next = answers.shift();
      if (next) return next();
      throw new Error("connection reset");
    });
    publishTagExpiryLedger({
      record,
      expiriesOf: async () => ({ expired: new Map() }),
      prune: async () => 0,
    });

    if ((await expireTags(["posts"])) === "failed") holdFailedRecord(["posts"]);
    await vi.advanceTimersByTimeAsync(FIRST_RETRY_DELAY_MS);
    expect(releaseRetry, "the retry is under way").toBeDefined();
    if ((await expireTags(["pages", "home"])) === "failed") {
      holdFailedRecord(["pages", "home"]);
    }
    releaseRetry?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(record).toHaveBeenCalledTimes(3);
    const failed = warn.mock.calls
      .map(([entry]) => entry)
      .filter(entry => entry.kind === "cache-tag-record-failed");
    expect(failed.map(entry => entry.tags)).toEqual([
      ["posts"],
      ["pages", "home"],
    ]);
    expect(failed[1].message).toContain("pages, home");
    expect(
      warn.mock.calls.filter(
        ([entry]) => entry.kind === "cache-tag-record-retrying"
      )
    ).toHaveLength(1);
  });

  it("does not hold a cached read past its wait on a retry whose ledger never answers", async () => {
    let wedged = false;
    const record = vi.fn(
      (tags: readonly string[]) =>
        new Promise<Map<string, number>>((resolve, reject) => {
          if (!wedged) reject(new Error("connection reset"));
          else void tags;
        })
    );
    publishTagExpiryLedger({
      record,
      expiriesOf: async () => ({ expired: new Map() }),
      prune: async () => 0,
    });
    if ((await expireTags(["posts"])) === "failed") holdFailedRecord(["posts"]);
    // The database now takes connections and never answers, and the timer
    // has not fired, as in a frozen function: the read makes the retry.
    wedged = true;
    vi.setSystemTime(Date.now() + FIRST_RETRY_DELAY_MS);

    let served = false;
    const waiting = retryFailedRecordsAtRead();
    expect(waiting, "a retry is due").toBeDefined();
    void waiting?.then(() => {
      served = true;
    });
    await vi.advanceTimersByTimeAsync(READ_RETRY_WAIT_MS);
    expect(served, "the read goes on").toBe(true);
    expect(record).toHaveBeenCalledTimes(2);
  });

  it("gives up on a retry whose ledger never answers, starts no other record until it does, then tries again", async () => {
    let wedged = false;
    const stuck: (() => void)[] = [];
    const record = vi.fn(
      (_tags: readonly string[]) =>
        new Promise<Map<string, number>>((_resolve, reject) => {
          if (!wedged) reject(new Error("connection reset"));
          else stuck.push(() => reject(new Error("connection reset")));
        })
    );
    publishTagExpiryLedger({
      record,
      expiriesOf: async () => ({ expired: new Map() }),
      prune: async () => 0,
    });
    if ((await expireTags(["posts"])) === "failed") holdFailedRecord(["posts"]);
    wedged = true;

    await vi.advanceTimersByTimeAsync(FIRST_RETRY_DELAY_MS);
    expect(record).toHaveBeenCalledTimes(2);
    // Given up on at the ledger's bound; the next tries, and another write's
    // record, start no query while that one still runs.
    await vi.advanceTimersByTimeAsync(LEDGER_CALL_TIMEOUT_MS);
    const pages = expireTags(["pages"]);
    await vi.advanceTimersByTimeAsync(LEDGER_CALL_TIMEOUT_MS);
    expect(await pages).toBe("failed");
    holdFailedRecord(["pages"]);
    await vi.advanceTimersByTimeAsync(4 * FIRST_RETRY_DELAY_MS);
    expect(record).toHaveBeenCalledTimes(2);

    // Once it answers, the next try asks the ledger again.
    for (const release of stuck.splice(0)) release();
    await vi.advanceTimersByTimeAsync(MAX_RETRY_DELAY_MS);
    expect(record).toHaveBeenCalledTimes(3);
    expect([...record.mock.calls[2][0]].sort()).toEqual(["pages", "posts"]);
  });

  it("does not record again a refused expiry whose record landed after it was given up on", async () => {
    // The record answers a second after the ledger's bound: given up on,
    // kept for a retry, and then it lands.
    const rows = new Map<string, number>();
    const record = vi.fn(
      (tags: readonly string[]) =>
        new Promise<Map<string, number>>(resolve => {
          setTimeout(() => {
            const at = Date.now() + 1_000;
            for (const tag of tags) rows.set(tag, at);
            resolve(new Map(tags.map(tag => [tag, at] as const)));
          }, LEDGER_CALL_TIMEOUT_MS + 500);
        })
    );
    publishTagExpiryLedger({
      record,
      expiriesOf: async () => ({ expired: new Map() }),
      prune: async () => 0,
    });
    const recorded = expireTags(["posts"]);
    await vi.advanceTimersByTimeAsync(LEDGER_CALL_TIMEOUT_MS);
    expect(await recorded).toBe("failed");
    holdFailedRecord(["posts"]);

    await vi.advanceTimersByTimeAsync(FIRST_RETRY_DELAY_MS + 1);
    expect(rows.has("posts"), "the late record landed").toBe(true);
    expect(record, "and was not made again").toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[0]).toMatchObject({
      kind: "cache-tag-record-recovered",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives up on a lookup the ledger never answers, refusing what was cached before it and serving what comes after", async () => {
    publishTagExpiryLedger({
      record: async tags =>
        new Map(tags.map(tag => [tag, Date.now()] as const)),
      // The database takes connections and never answers.
      expiriesOf: () => new Promise(() => undefined),
      prune: async () => 0,
    });
    const cachedBefore = localNow();
    vi.advanceTimersByTime(5);

    let answered = false;
    void refreshTagExpiries(["posts"]).then(() => {
      answered = true;
    });
    await vi.advanceTimersByTimeAsync(LEDGER_CALL_TIMEOUT_MS);
    expect(answered, "the read is not held").toBe(true);
    // It may have been about to say the tag expired: what was cached before
    // is read afresh, and what is cached from now on is served.
    expect(isEntryExpired(["posts"], cachedBefore)).toBe(true);
    vi.advanceTimersByTime(5);
    expect(isEntryExpired(["posts"], localNow())).toBe(false);
  });

  it("keeps a ledger that never answers to one waiting query of each kind, however many writes, retries and lookups follow", async () => {
    let records = 0;
    let lookups = 0;
    const record = vi.fn(() => {
      records += 1;
      return new Promise<Map<string, number>>(() => undefined);
    });
    const expiriesOf = vi.fn(() => {
      lookups += 1;
      return new Promise<never>(() => undefined);
    });
    publishTagExpiryLedger({ record, expiriesOf, prune: async () => 0 });

    // The first record and lookup are given up on, and go on running.
    const first = expireTags(["t0"]);
    void refreshTagExpiries(["t0"]);
    await vi.advanceTimersByTimeAsync(LEDGER_CALL_TIMEOUT_MS);
    expect(await first).toBe("failed");
    holdFailedRecord(["t0"]);
    for (let i = 1; i <= 5; i += 1) {
      // Each write's record, given at most the ledger's bound.
      const recorded = expireTags([`t${i}`]);
      await vi.advanceTimersByTimeAsync(LEDGER_CALL_TIMEOUT_MS);
      if ((await recorded) === "failed") holdFailedRecord([`t${i}`]);
      void refreshTagExpiries([`t${i}`]);
      vi.advanceTimersByTime(TAG_LOOKUP_TTL_MS);
      void refreshTagExpiries(["t0"]);
      await vi.advanceTimersByTimeAsync(MAX_RETRY_DELAY_MS);
    }
    expect(records, "records the database was asked to run").toBe(1);
    expect(lookups, "lookups the database was asked to run").toBe(1);
  });

  it("does not take an earlier record's late landing for a later refused one", async () => {
    // The first write's record is given up on; a second write of the same
    // tag is refused outright; then the first record lands. It read the
    // database's time before the second write, so it covers nothing of it.
    let landFirst: (() => void) | undefined;
    const calls: string[][] = [];
    const record = vi.fn((tags: readonly string[]) => {
      calls.push([...tags]);
      const n = calls.length;
      if (n === 1) {
        return new Promise<Map<string, number>>(resolve => {
          landFirst = () =>
            resolve(new Map(tags.map(tag => [tag, Date.now()] as const)));
        });
      }
      if (n === 2) return Promise.reject(new Error("connection reset"));
      return Promise.resolve(
        new Map(tags.map(tag => [tag, Date.now()] as const))
      );
    });
    publishTagExpiryLedger({
      record,
      expiriesOf: async () => ({ expired: new Map() }),
      prune: async () => 0,
    });

    const first = expireTags(["posts"]);
    await vi.advanceTimersByTimeAsync(LEDGER_CALL_TIMEOUT_MS);
    expect(await first).toBe("failed");
    holdFailedRecord(["posts"]);
    landFirst?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(await expireTags(["posts"])).toBe("failed");
    holdFailedRecord(["posts"]);

    await vi.advanceTimersByTimeAsync(FIRST_RETRY_DELAY_MS);
    expect(calls, "the retry records the second write").toEqual([
      ["posts"],
      ["posts"],
      ["posts"],
    ]);
  });

  it("forgets the refusals of tags a later flush recorded, however many there are", async () => {
    let refusing = true;
    const record = vi.fn(async (tags: readonly string[]) => {
      if (refusing) throw new Error("connection reset");
      return new Map(tags.map(tag => [tag, Date.now()] as const));
    });
    publishTagExpiryLedger({
      record,
      expiriesOf: async () => ({ expired: new Map() }),
      prune: async () => 0,
    });
    const refusals = () =>
      (
        globalThis as unknown as {
          __nextly_tag_expiry_view: { refusals: Map<string, unknown> };
        }
      ).__nextly_tag_expiry_view.refusals;

    for (let i = 0; i < 50; i += 1) {
      refusing = true;
      if ((await expireTags([`t${i}`])) === "failed")
        holdFailedRecord([`t${i}`]);
      // The next write's flush takes the kept tags and records them, before
      // the retry's timer comes round.
      refusing = false;
      await expireTags(takePendingExpiries());
      await vi.advanceTimersByTimeAsync(MAX_RETRY_DELAY_MS);
    }
    expect(refusals().size).toBe(0);
  });

  it("does not let a stuck call of a withdrawn ledger hold back the one installed after it", async () => {
    const wedged = vi.fn(
      () => new Promise<Map<string, number>>(() => undefined)
    );
    publishTagExpiryLedger({
      record: wedged,
      expiriesOf: async () => ({ expired: new Map() }),
      prune: async () => 0,
    });
    const first = expireTags(["posts"]);
    await vi.advanceTimersByTimeAsync(LEDGER_CALL_TIMEOUT_MS);
    expect(await first).toBe("failed");

    // A healthy ledger replaces it, while the old call never answers.
    const healthy = vi.fn(
      async (tags: readonly string[]) =>
        new Map(tags.map(tag => [tag, Date.now()] as const))
    );
    publishTagExpiryLedger({
      record: healthy,
      expiriesOf: async () => ({ expired: new Map() }),
      prune: async () => 0,
    });
    expect(await expireTags(["pages"])).toBe("recorded");
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it("starts no more than its limit of ledger calls at once, before any is given up on", async () => {
    let started = 0;
    const record = vi.fn(() => {
      started += 1;
      return new Promise<Map<string, number>>(() => undefined);
    });
    publishTagExpiryLedger({
      record,
      expiriesOf: async () => ({ expired: new Map() }),
      prune: async () => 0,
    });
    // A burst of writes in the first moment of an outage.
    const writes = Array.from(
      { length: 3 * MAX_LEDGER_CALLS_IN_FLIGHT },
      (_, i) => expireTags([`t${i}`])
    );
    await vi.advanceTimersByTimeAsync(LEDGER_CALL_TIMEOUT_MS);
    expect(await Promise.all(writes)).toEqual(writes.map(() => "failed"));
    expect(started, "calls the database was asked to run").toBe(
      MAX_LEDGER_CALLS_IN_FLIGHT
    );
  });

  it("lets a stuck record's late landing cover its refusal, though a retry was turned away meanwhile", async () => {
    let land: (() => void) | undefined;
    const record = vi.fn(
      (tags: readonly string[]) =>
        new Promise<Map<string, number>>(resolve => {
          land = () =>
            resolve(new Map(tags.map(tag => [tag, Date.now()] as const)));
        })
    );
    publishTagExpiryLedger({
      record,
      expiriesOf: async () => ({ expired: new Map() }),
      prune: async () => 0,
    });
    const first = expireTags(["posts"]);
    await vi.advanceTimersByTimeAsync(LEDGER_CALL_TIMEOUT_MS);
    expect(await first).toBe("failed");
    holdFailedRecord(["posts"]);
    // The first retry is turned away: the record is still stuck.
    await vi.advanceTimersByTimeAsync(FIRST_RETRY_DELAY_MS);
    expect(record).toHaveBeenCalledTimes(1);

    // The stuck record lands, and the next retry has nothing to make again.
    land?.();
    await vi.advanceTimersByTimeAsync(2 * FIRST_RETRY_DELAY_MS);
    expect(record).toHaveBeenCalledTimes(1);
    expect(info.mock.calls.map(([entry]) => entry.kind)).toContain(
      "cache-tag-record-recovered"
    );
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

  it("keeps an entry regenerated since the write fresh while retries fail, and judges the recorded retry by its reading", async () => {
    const rows = new Map<string, number>();
    let refusing = true;
    publishTagExpiryLedger({
      record: async tags => {
        if (refusing) throw new Error("connection reset");
        const at = Date.now() + 1_000;
        for (const tag of tags) rows.set(tag, at);
        return new Map(tags.map(tag => [tag, at] as const));
      },
      expiriesOf: async tags => ({
        now: Date.now(),
        expired: new Map(
          tags.flatMap(tag => {
            const at = rows.get(tag);
            return at === undefined ? [] : [[tag, at] as const];
          })
        ),
      }),
      prune: async () => 0,
    });
    const before = localNow();
    vi.advanceTimersByTime(5);
    // The write: expired here, refused by the ledger, kept for a retry.
    expect(await expireTags(["t"])).toBe("failed");
    holdFailedRecord(["t"]);
    vi.advanceTimersByTime(5);
    // An entry this process regenerated after the write.
    const regenerated = localNow();

    // Two refused retries: they record nothing and expire nothing here, so
    // the regenerated entry stays fresh through the outage.
    await vi.advanceTimersByTimeAsync(FIRST_RETRY_DELAY_MS);
    await vi.advanceTimersByTimeAsync(2 * FIRST_RETRY_DELAY_MS);
    expect(isEntryExpired(["t"], regenerated)).toBe(false);
    expect(isEntryExpired(["t"], before)).toBe(true);

    refusing = false;
    await vi.advanceTimersByTimeAsync(4 * FIRST_RETRY_DELAY_MS);
    expect(rows.has("t")).toBe(true);
    const afterRetry = localNow();

    // The recorded retry is judged by the database's reading it made, as a
    // write's own record is: another instance may have recorded the same tag
    // in the same millisecond, and only that reading orders an entry against
    // it. So the regenerated entry is refused once, here; one begun after the
    // reading is fresh.
    vi.advanceTimersByTime(TAG_LOOKUP_TTL_MS);
    await refreshTagExpiries(["t"]);
    expect(isEntryExpired(["t"], regenerated)).toBe(true);
    expect(isEntryExpired(["t"], afterRetry)).toBe(false);
  });

  it("waits the first wait again for a refusal kept during an attempt that then succeeded, not the wait it was armed with", async () => {
    let release: () => void = () => undefined;
    let calls = 0;
    const seen: string[][] = [];
    publishTagExpiryLedger({
      record: async tags => {
        calls += 1;
        seen.push([...tags]);
        if (calls <= 3) throw new Error("connection reset");
        if (calls === 4) {
          await new Promise<void>(resolve => {
            release = resolve;
          });
        }
        return new Map(tags.map(tag => [tag, Date.now()] as const));
      },
      expiriesOf: async () => ({ expired: new Map() }),
      prune: async () => 0,
    });
    holdFailedRecord(["posts"]);
    // Three refusals: waits of 1, 2 and 4 s, so the next would be 8 s.
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(4_000);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(calls).toBe(4);

    // Refused while the fourth attempt records, armed at 8 s.
    holdFailedRecord(["pages"]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(FIRST_RETRY_DELAY_MS);

    expect(calls).toBe(5);
    expect(seen[4]).toEqual(["pages"]);
  });

  it("retries the tags a hand-off that never answered gave back", async () => {
    const record = ledgerThat(() => "ok");
    const hanging = { handOff: () => new Promise<void>(() => undefined) };
    const handing = handOffWithin(
      hanging,
      ["posts"],
      "a write made outside Next.js"
    );
    await vi.advanceTimersByTimeAsync(HANDOFF_TIMEOUT_MS);
    await handing;

    await vi.advanceTimersByTimeAsync(FIRST_RETRY_DELAY_MS);

    expect(record).toHaveBeenCalledTimes(1);
    expect([...record.mock.calls[0][0]]).toEqual(["posts"]);
  });
});
