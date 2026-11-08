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

const { expireContentAfterGrantsChange } = await import(
  "../flush-content-change"
);

const SCOPES = { collections: [{ slug: "posts" }], singles: [] };

/** The slug a queued row carries, as stored: a row an earlier process queued must still match. */
const JOB_SLUG = "nextly:grants-content-expiry";

const enqueue = vi.fn();
const withdrawUnclaimed = vi.fn();

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
  container.register("jobsRepository", () => ({ enqueue, withdrawUnclaimed }));
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
});
