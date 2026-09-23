import { describe, it, expect } from "vitest";

import {
  buildMigrationStatuses,
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
