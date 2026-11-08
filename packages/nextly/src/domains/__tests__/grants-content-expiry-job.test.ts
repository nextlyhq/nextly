/**
 * The job that performs a grants change's content expiry for a process that
 * could not. It is done only when every tag expired or was recorded where every
 * instance reads it, and a row's attempts are bounded, so its last attempts
 * queue a successor before failing: the expiry stays owed past the row.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JobContentApi } from "../jobs/job-content-api";
import type { FlushOutcome } from "../../revalidation/types";

const content = vi.hoisted(() => vi.fn());
const flush = vi.hoisted(() =>
  vi.fn(async (_intents: unknown): Promise<FlushOutcome | void> => undefined)
);

vi.mock("../../di/registrations/language-change-content-cache", () => ({
  languageChangeContentCache: () => ({
    content,
    revalidator: () => ({ flush }),
  }),
}));

const { createGrantsContentExpiryJob } = await import(
  "../grants-content-expiry-job"
);

const SCOPES = { collections: [{ slug: "posts" }], singles: [] };
const NOW = new Date("2026-11-08T00:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

const enqueue = vi.fn();
const definition = createGrantsContentExpiryJob({
  jobs: () => ({ enqueue }),
});
const LAST = definition.retry.maxAttempts;

/** Runs the handler as the queue would on `attempt` of the row `job-7`. */
function run(
  attempt: number,
  input: Parameters<typeof definition.handler>[0] = null
): Promise<void> {
  return Promise.resolve(
    definition.handler(input, {
      jobId: "job-7",
      attempt,
      user: null,
      now: NOW,
      content: {} as JobContentApi,
      deadline: new Date(NOW.getTime() + 60_000),
    })
  );
}

beforeEach(() => {
  content.mockReset();
  flush.mockReset();
  flush.mockResolvedValue(undefined);
  enqueue.mockReset();
  enqueue.mockResolvedValue({ id: "job-8", deduped: false });
});

describe("the grants content expiry job", () => {
  it("queues a successor before its last attempt fails", async () => {
    content.mockRejectedValue(new Error("database down"));
    await expect(run(LAST)).rejects.toThrow("database down");
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({
      slug: "nextly:grants-content-expiry",
      input: null,
      runAt: new Date(NOW.getTime() + HOUR_MS),
      runAsUserId: null,
      dedupeKey: "nextly:grants-content-expiry:after:job-7",
      now: NOW,
    });
  });

  it("asks for the successor on each of its last three attempts, under one key", async () => {
    content.mockRejectedValue(new Error("database down"));
    await expect(run(LAST - 3)).rejects.toThrow();
    expect(enqueue).not.toHaveBeenCalled();
    await expect(run(LAST - 2)).rejects.toThrow();
    await expect(run(LAST - 1)).rejects.toThrow();
    const keys = enqueue.mock.calls.map(
      ([job]) => (job as { dedupeKey: string }).dedupeKey
    );
    expect(keys).toEqual([
      "nextly:grants-content-expiry:after:job-7",
      "nextly:grants-content-expiry:after:job-7",
    ]);
  });

  it("queues no successor while attempts remain, or once the expiry lands", async () => {
    content.mockRejectedValueOnce(new Error("database down"));
    await expect(run(1)).rejects.toThrow("database down");
    content.mockResolvedValue(SCOPES);
    await expect(run(LAST)).resolves.toBeUndefined();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("still fails with the expiry's error when the successor cannot be queued", async () => {
    content.mockRejectedValue(new Error("database down"));
    enqueue.mockRejectedValue(new Error("jobs table unavailable"));
    await expect(run(LAST)).rejects.toThrow("database down");
  });

  it("fails, so the queue tries again, while the flush keeps tags in the running process only", async () => {
    content.mockResolvedValue(SCOPES);
    flush.mockResolvedValue({
      deferredTags: ["nextly:posts"],
      keptInProcess: ["nextly:posts"],
    });
    await expect(run(1)).rejects.toBeDefined();
  });

  it("is done when the tags it deferred were recorded for every instance", async () => {
    content.mockResolvedValue(SCOPES);
    flush.mockResolvedValue({ deferredTags: ["nextly:posts"] });
    await expect(run(1)).resolves.toBeUndefined();
  });

  it("queues the next link of a write-ahead row's chain before its expiry", async () => {
    content.mockResolvedValue(SCOPES);
    const startedAt = NOW.getTime() - 6 * 60_000;
    await run(1, { ahead: { chain: "c1", link: 0, startedAt } });
    expect(enqueue).toHaveBeenCalledWith({
      slug: "nextly:grants-content-expiry",
      input: { ahead: { chain: "c1", link: 1, startedAt } },
      // The delay doubles from the five-minute margin.
      runAt: new Date(NOW.getTime() + 10 * 60_000),
      runAsUserId: null,
      dedupeKey: "nextly:grants-content-expiry:ahead:c1:1",
      now: NOW,
    });
    expect(enqueue.mock.invocationCallOrder[0]).toBeLessThan(
      content.mock.invocationCallOrder[0] ?? 0
    );
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("ends a chain past the horizon, at its last link, and a plain row at its run", async () => {
    content.mockResolvedValue(SCOPES);
    await run(1, {
      ahead: { chain: "c1", link: 2, startedAt: NOW.getTime() - 25 * HOUR_MS },
    });
    await run(1, {
      ahead: { chain: "c1", link: 99, startedAt: NOW.getTime() },
    });
    await run(1, null);
    expect(enqueue).not.toHaveBeenCalled();
    expect(flush).toHaveBeenCalledTimes(3);
  });
});
