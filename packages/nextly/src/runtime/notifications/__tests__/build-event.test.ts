// F10 PR 3 — build-event helper unit tests.

import { describe, expect, it } from "vitest";

import { buildNotificationEvent } from "../build-event.js";

const fixedNow = () => new Date("2026-04-29T18:00:00.000Z");

describe("buildNotificationEvent", () => {
  it("builds a success event with all fields", () => {
    const e = buildNotificationEvent({
      success: true,
      source: "ui",
      scope: { kind: "collection", slug: "posts" },
      summary: { added: 1, removed: 0, renamed: 0, changed: 0 },
      durationMs: 320,
      journalId: "id-1",
      now: fixedNow,
    });

    expect(e).toEqual({
      ts: "2026-04-29T18:00:00.000Z",
      source: "ui",
      status: "success",
      scope: { kind: "collection", slug: "posts" },
      summary: { added: 1, removed: 0, renamed: 0, changed: 0 },
      durationMs: 320,
      journalId: "id-1",
    });
  });

  it("builds a failed event with error", () => {
    const e = buildNotificationEvent({
      success: false,
      source: "code",
      scope: { kind: "global" },
      durationMs: 50,
      journalId: "id-2",
      error: { code: "X_FAILED", message: "bad" },
      now: fixedNow,
    });

    expect(e).toEqual({
      ts: "2026-04-29T18:00:00.000Z",
      source: "code",
      status: "failed",
      scope: { kind: "global" },
      durationMs: 50,
      journalId: "id-2",
      error: { code: "X_FAILED", message: "bad" },
    });
  });

  it("builds a failed event with optional partial summary", () => {
    const e = buildNotificationEvent({
      success: false,
      source: "ui",
      scope: { kind: "collection", slug: "posts" },
      summary: { added: 1 },
      durationMs: 50,
      journalId: "id-3",
      error: { message: "constraint violation" },
      now: fixedNow,
    });

    if (e.status !== "failed") throw new Error("expected failed event");
    expect(e.summary).toEqual({ added: 1 });
  });

  it("supports fresh-push scope", () => {
    const e = buildNotificationEvent({
      success: true,
      source: "code",
      scope: { kind: "fresh-push" },
      summary: { added: 5, removed: 0, renamed: 0, changed: 0 },
      durationMs: 100,
      journalId: "id-4",
      now: fixedNow,
    });

    expect(e.scope).toEqual({ kind: "fresh-push" });
  });

  it("uses Date.now() when `now` is omitted", () => {
    const before = Date.now();
    const e = buildNotificationEvent({
      success: true,
      source: "code",
      scope: { kind: "global" },
      summary: { added: 0, removed: 0, renamed: 0, changed: 0 },
      durationMs: 0,
      journalId: "id-5",
    });
    const after = Date.now();

    const ts = new Date(e.ts).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
