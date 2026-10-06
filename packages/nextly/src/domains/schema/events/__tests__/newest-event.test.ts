/**
 * "Is this file applied?" is answered by the NEWEST event for it, and every
 * reader of the ledger asks through `appliedFilenames`.
 *
 * A rollback is recorded by inserting a `rolled_back` event after the
 * `applied` one, so "has an applied row" is the plausible wrong answer these
 * separate the helper from.
 */
import { describe, expect, it } from "vitest";

import {
  appliedFilenames,
  newestEvent,
  newestEventsByFilename,
} from "../newest-event";
import type { SchemaEventRow } from "../schema-events-repository";

function row(
  filename: string | null,
  status: SchemaEventRow["status"],
  startedAtMs: number,
  id = `${String(filename)}-${status}-${startedAtMs}`
): SchemaEventRow {
  return {
    id,
    eventType: "file_apply",
    status,
    source: "cli-migrate",
    filename,
    sha256: null,
    scopeKind: null,
    scopeSlug: null,
    startedAt: new Date(startedAtMs),
    endedAt: new Date(startedAtMs),
    durationMs: null,
    note: null,
    statementsExecuted: null,
    supersededEventIds: null,
    supersededBy: null,
  };
}

describe("appliedFilenames", () => {
  it("applied then rolled back is NOT applied", () => {
    // The row a filter for `status === "applied"` would still find.
    const rows = [row("a", "applied", 1000), row("a", "rolled_back", 2000)];
    expect(appliedFilenames(rows)).toEqual(new Set());
  });

  it("rolled back then applied again IS applied", () => {
    const rows = [
      row("a", "applied", 1000),
      row("a", "rolled_back", 2000),
      row("a", "applied", 3000),
    ];
    expect(appliedFilenames(rows)).toEqual(new Set(["a"]));
  });

  it("decides by startedAt, not by the order rows arrive in", () => {
    // A ledger read carries no ORDER BY, so the rollback can come back first.
    const rows = [row("a", "rolled_back", 2000), row("a", "applied", 1000)];
    expect(appliedFilenames(rows)).toEqual(new Set());
  });

  it("a failed re-apply after an applied row is not applied", () => {
    const rows = [row("a", "applied", 1000), row("a", "failed", 2000)];
    expect(appliedFilenames(rows)).toEqual(new Set());
  });

  it("a failed attempt before a successful apply leaves it applied", () => {
    const rows = [row("a", "failed", 1000), row("a", "applied", 2000)];
    expect(appliedFilenames(rows)).toEqual(new Set(["a"]));
  });

  it("judges each filename on its own events", () => {
    const rows = [
      row("a", "applied", 1000),
      row("b", "applied", 1500),
      row("b", "rolled_back", 2500),
      row("c", "failed", 3000),
    ];
    expect(appliedFilenames(rows)).toEqual(new Set(["a"]));
  });

  it("skips rows with no filename", () => {
    expect(appliedFilenames([row(null, "applied", 1000)])).toEqual(new Set());
  });
});

describe("newestEventsByFilename", () => {
  it("breaks a startedAt tie exactly as newestEvent does", () => {
    // The helper exists so this rule has one implementation. A hand-rolled
    // `>=` comparison keeps the LAST row on a tie; `newestEvent` keeps the
    // first, and the two would disagree about the same ledger.
    const first = row("a", "applied", 1000, "first");
    const second = row("a", "rolled_back", 1000, "second");
    const rows = [first, second];

    expect(newestEventsByFilename(rows).get("a")).toBe(newestEvent(rows));
    expect(newestEventsByFilename(rows).get("a")?.id).toBe("first");
    expect(appliedFilenames(rows)).toEqual(new Set(["a"]));
  });
});
