/**
 * @module domains/schema/events/__tests__/backfill.unit
 * @since v0.0.3-alpha (Plan B)
 */
import { describe, it, expect } from "vitest";

import { mapMigrationsRow, mapJournalRow } from "../backfill";

describe("mapMigrationsRow", () => {
  it("maps a nextly_migrations row to a file_apply event", () => {
    const out = mapMigrationsRow({
      filename: "0001_init.sql",
      sha256: "abc",
      status: "applied",
      appliedAt: new Date("2026-01-01T00:00:00Z"),
      appliedBy: "ci",
      durationMs: 42,
      errorJson: null,
    });
    expect(out).toMatchObject({
      eventType: "file_apply",
      source: "cli-migrate",
      status: "applied",
      filename: "0001_init.sql",
      sha256: "abc",
      appliedBy: "ci",
      durationMs: 42,
    });
  });

  it("maps a failed migrations row to status=failed", () => {
    const out = mapMigrationsRow({
      filename: "x.sql",
      sha256: "z",
      status: "failed",
      appliedAt: null,
      appliedBy: null,
      durationMs: null,
      errorJson: { message: "boom" },
    });
    expect(out.status).toBe("failed");
  });
});

describe("mapJournalRow", () => {
  const base = {
    source: "code" as string,
    status: "success" as string,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    endedAt: new Date("2026-01-01T00:00:01Z"),
    durationMs: 1000,
    scopeKind: "collection" as string | null,
    scopeSlug: "posts" as string | null,
  };

  it("maps source=code → dev_push", () => {
    expect(mapJournalRow({ ...base }).eventType).toBe("dev_push");
  });
  it("maps source=ui → ui_save", () => {
    expect(mapJournalRow({ ...base, source: "ui" }).eventType).toBe("ui_save");
  });
  it("maps source=cli → db_sync", () => {
    expect(mapJournalRow({ ...base, source: "cli" }).eventType).toBe("db_sync");
  });
  it("falls back to dev_push for unknown source", () => {
    expect(mapJournalRow({ ...base, source: "weird" }).eventType).toBe(
      "dev_push"
    );
  });
  it("maps journal status=success → applied", () => {
    expect(mapJournalRow({ ...base }).status).toBe("applied");
  });
  it("maps journal status=failed → failed", () => {
    expect(mapJournalRow({ ...base, status: "failed" }).status).toBe("failed");
  });
  it("returns null (skip) for in_progress / aborted rows", () => {
    expect(mapJournalRow({ ...base, status: "in_progress" })).toBeNull();
    expect(mapJournalRow({ ...base, status: "aborted" })).toBeNull();
  });
});
