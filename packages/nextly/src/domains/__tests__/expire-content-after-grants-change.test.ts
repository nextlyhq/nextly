/**
 * The expiry after a change to grants reads which collections and Singles
 * there are, and that read has no hand-off of its own. So the expiry is owed
 * until it lands: queued as a job before it is tried, so a process gone first
 * leaves it to the jobs queue; tried twice; and when both fail, logged as an
 * error, never thrown, since the change it follows has committed, and tried
 * again by this process with a growing wait until it lands, when the queued
 * job is withdrawn. Landing means every tag expired or was recorded where
 * every instance reads it: a tag the revalidator kept in this process alone
 * is lost with it, so the job stays and the expiry is tried again.
 *
 * Inside a gate (`aheadOfGrantsChange`) the job is queued before the write,
 * due only after a margin, and the expiry after the write takes that row; one
 * no longer waiting when the expiry fails is replaced by a fresh one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { container } from "../../di/container";
import type { FlushOutcome } from "../../revalidation/types";

const content = vi.hoisted(() => vi.fn());
const flush = vi.hoisted(() =>
  vi.fn(async (_intents: unknown): Promise<FlushOutcome | void> => undefined)
);
const revalidator = vi.hoisted(() => vi.fn());
const logged = vi.hoisted(() => vi.fn());
const informed = vi.hoisted(() => vi.fn());

vi.mock("../../di/registrations/language-change-content-cache", () => ({
  languageChangeContentCache: () => ({ content, revalidator }),
}));
vi.mock("../../observability/logger", () => ({
  getNextlyLogger: () => ({ error: logged, info: informed }),
}));

const { aheadOfGrantsChange, expireContentAfterGrantsChange } = await import(
  "../flush-content-change"
);

const SCOPES = { collections: [{ slug: "posts" }], singles: [] };

/** The slug a queued row carries, as stored: a row an earlier process queued must still match. */
const JOB_SLUG = "nextly:grants-content-expiry";

const enqueue = vi.fn();
const withdrawUnclaimed = vi.fn();
const isUnclaimed = vi.fn();
const withdrawUnclaimedByDedupeKeys = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  // A fresh process: nothing owed from another test.
  delete (globalThis as { __nextly_grants_expiry_retry?: unknown })
    .__nextly_grants_expiry_retry;
  content.mockReset();
  flush.mockReset();
  flush.mockResolvedValue(undefined);
  revalidator.mockReset();
  revalidator.mockReturnValue({ flush });
  logged.mockClear();
  informed.mockClear();
  enqueue.mockReset();
  enqueue.mockResolvedValue({ id: "job-1", deduped: false });
  withdrawUnclaimed.mockReset();
  withdrawUnclaimed.mockResolvedValue(true);
  isUnclaimed.mockReset();
  isUnclaimed.mockResolvedValue(true);
  withdrawUnclaimedByDedupeKeys.mockReset();
  withdrawUnclaimedByDedupeKeys.mockResolvedValue(0);
  container.register("jobsRepository", () => ({
    enqueue,
    withdrawUnclaimed,
    isUnclaimed,
    withdrawUnclaimedByDedupeKeys,
  }));
});

afterEach(() => {
  container.clear();
  vi.useRealTimers();
});

describe("the content expiry after a change to grants", () => {
  it("queues the expiry before it is tried, expires every scope's tags, then withdraws the job", async () => {
    content.mockResolvedValue(SCOPES);
    await expireContentAfterGrantsChange();
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ slug: JOB_SLUG, dedupeKey: null })
    );
    // Queued first: a process gone during the try still leaves it owed.
    expect(enqueue.mock.invocationCallOrder[0]).toBeLessThan(
      content.mock.invocationCallOrder[0] ?? 0
    );
    expect(flush).toHaveBeenCalledWith([{ tags: ["nextly:posts"] }]);
    expect(withdrawUnclaimed).toHaveBeenCalledWith("job-1");
    expect(logged).not.toHaveBeenCalled();
  });

  it("reads the scopes again when the first read fails", async () => {
    content
      .mockRejectedValueOnce(new Error("database busy"))
      .mockResolvedValue(SCOPES);
    await expireContentAfterGrantsChange();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(withdrawUnclaimed).toHaveBeenCalledWith("job-1");
    expect(logged).not.toHaveBeenCalled();
  });

  it("when both reads fail, logs without throwing, keeps the job, and tries again until it lands", async () => {
    content
      .mockRejectedValueOnce(new Error("database down"))
      .mockRejectedValueOnce(new Error("database down"))
      .mockRejectedValueOnce(new Error("database down"))
      .mockResolvedValue(SCOPES);
    await expect(expireContentAfterGrantsChange()).resolves.toBeUndefined();
    expect(flush).not.toHaveBeenCalled();
    expect(withdrawUnclaimed).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "grants-change-content-expiry-failed" })
    );

    // The first retry, after the first wait, fails too.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(content).toHaveBeenCalledTimes(3);
    expect(flush).not.toHaveBeenCalled();

    // The wait doubled: nothing at one second more, the next try at two.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(content).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(content).toHaveBeenCalledTimes(4);
    expect(flush).toHaveBeenCalledWith([{ tags: ["nextly:posts"] }]);
    expect(withdrawUnclaimed).toHaveBeenCalledWith("job-1");
    expect(informed).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "grants-change-content-expiry-recovered",
      })
    );

    // Landed: the retries stop.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(content).toHaveBeenCalledTimes(4);
  });

  it("queues the job on a later try when the queue refused it at first", async () => {
    enqueue
      .mockRejectedValueOnce(new Error("database down"))
      .mockResolvedValue({ id: "job-2", deduped: false });
    content
      .mockRejectedValueOnce(new Error("database down"))
      .mockRejectedValueOnce(new Error("database down"))
      .mockRejectedValueOnce(new Error("database down"))
      .mockResolvedValue(SCOPES);
    await expireContentAfterGrantsChange();
    expect(enqueue).toHaveBeenCalledTimes(1);

    // The retry fails again, so the expiry is queued now, for a restart to find.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(enqueue).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(withdrawUnclaimed).toHaveBeenCalledWith("job-2");
  });

  it("is tried by this process alone where there is no jobs queue", async () => {
    container.clear();
    content
      .mockRejectedValueOnce(new Error("database down"))
      .mockRejectedValueOnce(new Error("database down"))
      .mockResolvedValue(SCOPES);
    await expireContentAfterGrantsChange();
    expect(flush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("queues and reads nothing in a process that caches nothing", async () => {
    revalidator.mockReturnValue(undefined);
    await expireContentAfterGrantsChange();
    expect(enqueue).not.toHaveBeenCalled();
    expect(content).not.toHaveBeenCalled();
  });

  it("keeps the job and tries again while the flush keeps tags in this process only", async () => {
    content.mockResolvedValue(SCOPES);
    const kept = {
      deferredTags: ["nextly:posts"],
      keptInProcess: ["nextly:posts"],
    };
    flush.mockResolvedValueOnce(kept).mockResolvedValueOnce(kept);
    await expireContentAfterGrantsChange();
    expect(flush).toHaveBeenCalledTimes(2);
    expect(withdrawUnclaimed).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "grants-change-content-expiry-failed" })
    );

    // Recorded on the next try: now it has landed.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(flush).toHaveBeenCalledTimes(3);
    expect(withdrawUnclaimed).toHaveBeenCalledWith("job-1");
  });

  it("withdraws the job when the tags it deferred were recorded for every instance", async () => {
    content.mockResolvedValue(SCOPES);
    flush.mockResolvedValue({ deferredTags: ["nextly:posts"] });
    await expireContentAfterGrantsChange();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(withdrawUnclaimed).toHaveBeenCalledWith("job-1");
    expect(logged).not.toHaveBeenCalled();
  });

  it("queues the job before a gated write, due after a margin, and the expiry takes that row", async () => {
    content.mockResolvedValue(SCOPES);
    const before = Date.now();
    await aheadOfGrantsChange(async () => {
      // Queued before the write starts.
      expect(enqueue).toHaveBeenCalledTimes(1);
      await expireContentAfterGrantsChange();
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [queued] = enqueue.mock.calls[0] as [
      { runAt: Date; dedupeKey: string; input: unknown },
    ];
    expect(queued.runAt.getTime()).toBeGreaterThanOrEqual(before + 4 * 60_000);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(withdrawUnclaimed.mock.calls).toEqual([["job-1"]]);
    // The row begins a chain, and confirming it withdraws every link of it.
    expect(queued).toMatchObject({
      input: { ahead: { link: 0 } },
      dedupeKey: expect.stringMatching(/:ahead:.+:0$/),
    });
    const [keys] = withdrawUnclaimedByDedupeKeys.mock.calls[0] as [string[]];
    expect(keys).toContain(queued.dedupeKey);
    expect(keys.length).toBeGreaterThan(8);
  });

  it("withdraws the row queued ahead when the gate announces no change", async () => {
    await aheadOfGrantsChange(async () => undefined);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(withdrawUnclaimed.mock.calls).toEqual([["job-1"]]);
    expect(content).not.toHaveBeenCalled();
  });

  it("leaves the row queued ahead when the write throws", async () => {
    await expect(
      aheadOfGrantsChange(async () => {
        throw new Error("rolled back");
      })
    ).rejects.toThrow("rolled back");
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(withdrawUnclaimed).not.toHaveBeenCalled();
  });

  it("queues nothing for a sweep until a write inside it asks", async () => {
    await aheadOfGrantsChange(async () => undefined, { queue: false });
    expect(enqueue).not.toHaveBeenCalled();
    await aheadOfGrantsChange(
      () => aheadOfGrantsChange(async () => undefined),
      { queue: false }
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("keeps the row queued ahead when the expiry fails and it still waits", async () => {
    content
      .mockRejectedValueOnce(new Error("database down"))
      .mockRejectedValueOnce(new Error("database down"))
      .mockResolvedValue(SCOPES);
    await aheadOfGrantsChange(() => expireContentAfterGrantsChange());
    expect(isUnclaimed).toHaveBeenCalledWith("job-1");
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(withdrawUnclaimed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(withdrawUnclaimed.mock.calls).toEqual([["job-1"]]);
  });

  it("queues a fresh row when the expiry fails and the row queued ahead was taken", async () => {
    enqueue
      .mockResolvedValueOnce({ id: "job-1", deduped: false })
      .mockResolvedValue({ id: "job-2", deduped: false });
    isUnclaimed.mockResolvedValue(false);
    content
      .mockRejectedValueOnce(new Error("database down"))
      .mockRejectedValueOnce(new Error("database down"))
      .mockResolvedValue(SCOPES);
    await aheadOfGrantsChange(() => expireContentAfterGrantsChange());
    expect(enqueue).toHaveBeenCalledTimes(2);
    // Due at once: it holds what the taken row no longer does.
    expect(enqueue).toHaveBeenLastCalledWith(
      expect.objectContaining({ runAt: null })
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect(withdrawUnclaimed.mock.calls).toEqual([["job-2"]]);
  });

  it("refuses the write when the queue refuses the row queued ahead of it", async () => {
    enqueue.mockRejectedValue(new Error("jobs table locked"));
    const write = vi.fn(async () => undefined);
    await expect(aheadOfGrantsChange(write)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("lets the write through where there is no jobs queue at all", async () => {
    container.clear();
    const write = vi.fn(async () => undefined);
    await aheadOfGrantsChange(write);
    expect(write).toHaveBeenCalledTimes(1);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("stops retrying once the services it flushes through are cleared", async () => {
    content.mockRejectedValue(new Error("database down"));
    await expireContentAfterGrantsChange();
    expect(content).toHaveBeenCalledTimes(2);

    const { clearServices } = await import("../../di/register");
    clearServices();
    // What the next registration would flush through, reachable again.
    const nextFlush = vi.fn(async () => undefined);
    revalidator.mockReturnValue({ flush: nextFlush });
    content.mockResolvedValue(SCOPES);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(content).toHaveBeenCalledTimes(2);
    expect(nextFlush).not.toHaveBeenCalled();
  });
});
