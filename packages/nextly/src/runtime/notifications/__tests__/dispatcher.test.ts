// F10 PR 3 — dispatcher unit tests.
// The dispatcher's contract: fan out one event to every channel
// SEQUENTIALLY (so terminal/NDJSON ordering matches arrival order),
// isolate per-channel failures behind try/catch, and never throw.

import { describe, expect, it, vi } from "vitest";

import { createNotifier } from "../dispatcher.js";
import type {
  MigrationNotificationEvent,
  NotificationChannel,
} from "../types.js";

const event: MigrationNotificationEvent = {
  ts: "2026-04-29T18:00:00.000Z",
  source: "ui",
  status: "success",
  scope: { kind: "collection", slug: "posts" },
  summary: { added: 1, removed: 0, renamed: 0, changed: 0 },
  durationMs: 320,
  journalId: "id-1",
};

describe("createNotifier", () => {
  it("calls write on every channel with the same event reference", async () => {
    const a: NotificationChannel = { name: "a", write: vi.fn() };
    const b: NotificationChannel = { name: "b", write: vi.fn() };
    const notifier = createNotifier({ channels: [a, b] });

    await notifier.notify(event);

    expect(a.write).toHaveBeenCalledTimes(1);
    expect(a.write).toHaveBeenCalledWith(event);
    expect(b.write).toHaveBeenCalledTimes(1);
    expect(b.write).toHaveBeenCalledWith(event);
  });

  it("isolates one channel's failure from others (warn + continue)", async () => {
    const warn = vi.fn();
    const failing: NotificationChannel = {
      name: "fail",
      write: vi.fn().mockRejectedValue(new Error("disk full")),
    };
    const ok: NotificationChannel = { name: "ok", write: vi.fn() };
    const notifier = createNotifier({
      channels: [failing, ok],
      logger: { warn },
    });

    await expect(notifier.notify(event)).resolves.toBeUndefined();

    expect(ok.write).toHaveBeenCalledWith(event);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[notifications] fail channel failed")
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("disk full"));
  });

  it("never throws when all channels fail", async () => {
    const failingA: NotificationChannel = {
      name: "a",
      write: vi.fn().mockRejectedValue(new Error("boom-a")),
    };
    const failingB: NotificationChannel = {
      name: "b",
      write: vi.fn().mockRejectedValue("boom-b"),
    };
    const warn = vi.fn();
    const notifier = createNotifier({
      channels: [failingA, failingB],
      logger: { warn },
    });

    await expect(notifier.notify(event)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("works with zero channels (no-op resolves)", async () => {
    const notifier = createNotifier({ channels: [] });
    await expect(notifier.notify(event)).resolves.toBeUndefined();
  });

  it("calls channels SEQUENTIALLY (preserves order)", async () => {
    const calls: string[] = [];
    const a: NotificationChannel = {
      name: "a",
      write: async () => {
        await new Promise(r => setTimeout(r, 10));
        calls.push("a");
      },
    };
    const b: NotificationChannel = {
      name: "b",
      write: async () => {
        calls.push("b");
      },
    };
    const notifier = createNotifier({ channels: [a, b] });

    await notifier.notify(event);

    // If the dispatcher fired channels in parallel via Promise.all,
    // 'b' would resolve before 'a' (a sleeps 10ms). Sequential
    // execution guarantees calls === ['a', 'b'].
    expect(calls).toEqual(["a", "b"]);
  });

  it("works without a logger (warn arg is optional)", async () => {
    const failing: NotificationChannel = {
      name: "x",
      write: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const notifier = createNotifier({ channels: [failing] });
    await expect(notifier.notify(event)).resolves.toBeUndefined();
  });

  it("handles non-Error throws (string, number, undefined) without crashing", async () => {
    const warn = vi.fn();
    const channels: NotificationChannel[] = [
      { name: "string-throw", write: () => Promise.reject("oops") },
      { name: "number-throw", write: () => Promise.reject(42) },
      { name: "undef-throw", write: () => Promise.reject(undefined) },
    ];
    const notifier = createNotifier({ channels, logger: { warn } });

    await expect(notifier.notify(event)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(3);
  });
});
