import { describe, it, expect } from "vitest";

import { buildMigrationStatuses } from "../migrate-status";

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
