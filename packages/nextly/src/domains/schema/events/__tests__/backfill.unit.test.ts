/**
 * @module domains/schema/events/__tests__/backfill.unit
 * @since v0.0.3-alpha (Plan B)
 */
import { describe, it, expect } from "vitest";

import {
  legacyLedgerShape,
  mapJournalRow,
  mapMigrationsRow,
  readLegacyLedgerRow,
} from "../backfill";

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

describe("reading nextly_migrations in the shape an earlier release kept it", () => {
  const FILE_LEDGER = [
    "id",
    "filename",
    "sha256",
    "status",
    "applied_at",
    "applied_by",
    "duration_ms",
    "error_json",
  ];
  const EARLIER = [
    "id",
    "name",
    "batch",
    "checksum",
    "status",
    "error_message",
    "executed_at",
  ];
  const HELPER = ["id", "name", "applied_at", "checksum"];

  it("reads a table with no column naming the file as no known shape", () => {
    expect(legacyLedgerShape(["id", "label", "created_at"])).toBeNull();
  });

  it("reads the file ledger as it was written", () => {
    const shape = legacyLedgerShape(FILE_LEDGER)!;
    const read = readLegacyLedgerRow(
      {
        filename: "0001_init.sql",
        sha256: "a".repeat(64),
        status: "applied",
        applied_at: Date.UTC(2026, 0, 2),
        applied_by: "ci",
        duration_ms: 12,
        error_json: null,
      },
      shape
    );
    expect(read).toEqual({
      kind: "move",
      row: {
        filename: "0001_init.sql",
        sha256: "a".repeat(64),
        status: "applied",
        appliedAt: new Date(Date.UTC(2026, 0, 2)),
        appliedBy: "ci",
        durationMs: 12,
        errorJson: null,
      },
    });
  });

  it("reads the earlier shape by its own names, its time in seconds and its error as text", () => {
    const shape = legacyLedgerShape(EARLIER)!;
    const seconds = Date.UTC(2026, 0, 2) / 1000;
    const read = readLegacyLedgerRow(
      {
        id: "x",
        name: "0002_posts.sql",
        batch: 1,
        checksum: "b".repeat(64),
        status: "failed",
        error_message: "relation exists",
        executed_at: seconds,
      },
      shape
    );
    expect(read).toEqual({
      kind: "move",
      row: {
        filename: "0002_posts.sql",
        sha256: "b".repeat(64),
        status: "failed",
        appliedAt: new Date(Date.UTC(2026, 0, 2)),
        appliedBy: null,
        durationMs: null,
        errorJson: { message: "relation exists" },
      },
    });
  });

  it("reads no shape in the migration helper's table, whose name is a label rather than a file", () => {
    expect(legacyLedgerShape(HELPER)).toBeNull();
  });

  it("reads a time kept as SQLite's CURRENT_TIMESTAMP text as UTC, and an empty checksum as none", () => {
    const read = readLegacyLedgerRow(
      {
        name: "0003.sql",
        batch: 1,
        checksum: "",
        status: "applied",
        executed_at: "2026-01-02 03:04:05",
      },
      legacyLedgerShape(EARLIER)!
    );
    expect(read).toMatchObject({
      kind: "move",
      row: {
        status: "applied",
        sha256: null,
        appliedAt: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)),
      },
    });
  });

  it("skips a record of a run that never finished", () => {
    expect(
      readLegacyLedgerRow(
        { name: "0004.sql", checksum: "c", status: "pending", executed_at: 1 },
        legacyLedgerShape(EARLIER)!
      )
    ).toEqual({ kind: "skip", filename: "0004.sql", status: "pending" });
  });

  it("refuses a status no release wrote, and a record naming no file", () => {
    const shape = legacyLedgerShape(EARLIER)!;
    expect(
      readLegacyLedgerRow({ name: "0005.sql", status: "rolled_back" }, shape)
    ).toMatchObject({ kind: "refuse" });
    expect(
      readLegacyLedgerRow({ name: "", status: "applied" }, shape)
    ).toMatchObject({ kind: "refuse" });
  });
});
