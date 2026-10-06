import { describe, it, expect } from "vitest";

import type { SchemaEventRow } from "../../../domains/schema/events/schema-events-repository";
import { PARTIAL_ROLLBACK_NOTE } from "../plugin-module-rollback";
import {
  buildMigrationStatuses,
  failedRollbacksSinceApply,
  ledgerRecords,
  pluginRowsToStatuses,
} from "../migrate-status";

describe("buildMigrationStatuses", () => {
  it("reconciles a ledger filename (.sql) with the discovered file name (no ext)", () => {
    const files = [
      {
        name: "20260101_000000_000_init",
        filePath: "/x/20260101_000000_000_init.sql",
        checksum: "abc",
        collections: [],
        timestamp: "20260101_000000",
      },
    ];
    const applied = [
      {
        id: "e1",
        filename: "20260101_000000_000_init.sql", // ledger stores WITH .sql
        sha256: "abc",
        status: "applied" as const,
        appliedBy: null,
        durationMs: 5,
        errorJson: null,
        appliedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ];

    const statuses = buildMigrationStatuses(files, applied);

    // Exactly ONE row, applied — not a "pending" + "applied (file missing)" pair.
    expect(statuses).toHaveLength(1);
    expect(statuses[0].status).toBe("applied");
    expect(statuses.some(s => s.status === "applied (file missing)")).toBe(
      false
    );
    expect(statuses.some(s => s.status === "pending")).toBe(false);
  });
});

describe("pluginRowsToStatuses", () => {
  const appliedRow = (filename: string, status: "applied" | "failed") => ({
    id: `e-${filename}`,
    filename,
    sha256: "",
    status,
    appliedBy: null,
    durationMs: 7,
    errorJson: null,
    appliedAt: new Date("2026-09-23T00:00:00Z"),
  });

  it("lists a plugin's rows without file matching, so none reads as file-missing", async () => {
    // A plugin's files live in its package, not the app's migrations
    // directory; running them through `buildMigrationStatuses` would report
    // every one as "applied (file missing)".
    const statuses = pluginRowsToStatuses([
      appliedRow("plugin:auth/001_init", "applied"),
      appliedRow("plugin:auth/002_add_col", "failed"),
    ]);
    expect(statuses.map(s => [s.filename, s.status])).toEqual([
      ["plugin:auth/001_init", "applied"],
      ["plugin:auth/002_add_col", "failed"],
    ]);
    expect(statuses.some(s => s.status === "applied (file missing)")).toBe(
      false
    );
  });

  it("carries the row's timing and never claims a checksum mismatch", async () => {
    const statuses = pluginRowsToStatuses([
      appliedRow("plugin:auth/001_init", "applied"),
    ]);
    expect(statuses[0].appliedAt).toEqual(new Date("2026-09-23T00:00:00Z"));
    expect(statuses[0].durationMs).toBe(7);
    expect(statuses[0].checksumMismatch).toBe(false);
  });
});

describe("ledgerRecords", () => {
  function event(
    filename: string,
    status: SchemaEventRow["status"],
    at: number
  ): SchemaEventRow {
    return {
      id: `${filename}-${status}-${at}`,
      eventType: "file_apply",
      status,
      source: "cli-migrate",
      filename,
      sha256: null,
      scopeKind: null,
      scopeSlug: null,
      startedAt: new Date(at),
      endedAt: new Date(at),
      durationMs: null,
      note: null,
      statementsExecuted: null,
      supersededEventIds: null,
      supersededBy: null,
    };
  }

  it("reports each migration by its NEWEST event, so a rolled-back one is not applied", () => {
    // A rollback inserts a `rolled_back` event after the `applied` one; the
    // older row is still in the ledger.
    const rows = [
      event("plugin:@acme/fx/0001_init", "applied", 1000),
      event("plugin:@acme/fx/0002_more", "applied", 2000),
      event("plugin:@acme/fx/0002_more", "rolled_back", 3000),
      event("plugin:@acme/fx/0003_last", "applied", 4000),
      event("plugin:@acme/fx/0003_last", "failed", 5000),
    ];
    expect(
      ledgerRecords(rows, "@acme/fx").map(r => [r.filename, r.status])
    ).toEqual([
      ["plugin:@acme/fx/0001_init", "applied"],
      ["plugin:@acme/fx/0003_last", "failed"],
    ]);
  });

  it("names an applied migration whose rollback failed since, and flags MySQL's", () => {
    const applied = ledgerRecords([
      event("0001_a.sql", "applied", 1000),
      event("0002_b.sql", "applied", 2000),
      event("0003_c.sql", "applied", 5000),
    ]);
    const rollback = (filename: string, at: number, note: string) => ({
      ...event(filename, "failed", at),
      eventType: "file_rollback" as const,
      note,
    });
    const failures = failedRollbacksSinceApply(applied, [
      rollback("0001_a.sql", 3000, "migrate:down failed: x"),
      rollback(
        "0002_b.sql",
        3000,
        `${PARTIAL_ROLLBACK_NOTE} migrate:down failed: y`
      ),
      // Before the migration's latest apply: an old attempt, not its state now.
      rollback("0003_c.sql", 4000, "migrate:down failed: z"),
    ]);
    expect(failures.map(f => [f.filename, f.possiblyPartial])).toEqual([
      ["0001_a.sql", false],
      ["0002_b.sql", true],
    ]);
  });

  it("applies the same rule to the app's own files", () => {
    const rows = [
      event("0001_init.sql", "applied", 1000),
      event("0001_init.sql", "rolled_back", 2000),
      event("0001_init.sql", "applied", 3000),
      event("plugin:@acme/fx/0001_init", "applied", 1000),
    ];
    expect(ledgerRecords(rows).map(r => [r.filename, r.status])).toEqual([
      ["0001_init.sql", "applied"],
    ]);
  });
});
