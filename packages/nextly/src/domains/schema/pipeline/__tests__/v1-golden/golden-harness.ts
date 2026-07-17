// Phase 7 Task 1 — golden-SQL harness for drizzle-kit v1's per-dialect
// pushSchema output.
//
// Why this exists: Nextly's TEXT consumers (filterUnsafeStatements, the
// destructive-statement scanner, fresh-push's splitStatements) read the kit's
// actual SQL strings. v1's rewritten engine may word its SQL differently on
// any future pin bump — and a guard regex that stops matching blocks nothing.
// Each scenario captures the kit's real output into a committed fixture
// (vitest file snapshots — refresh deliberately with `vitest -u` and review
// the diff) and asserts every text consumer classifies the captured
// statements correctly.
//
// This suite re-runs, in full, on every future Drizzle version bump BEFORE
// Nextly adopts it — the standing RC-riding mitigation.

import { expect } from "vitest";

import {
  filterUnsafeStatements,
  findUnexpectedDestructiveStatements,
} from "../../filter-unsafe-statements";
import { splitStatements } from "../../fresh-push";

export interface CapturedPush {
  sqlStatements: string[];
  hints: Array<{ hint: string; statement?: string }>;
}

export interface GoldenScenario {
  name: string;
  // Raw DDL to seed the live DB before the pushSchema diff.
  seed: string[];
  // Desired drizzle table objects, keyed by import name.
  desired: () => Record<string, unknown>;
  // Table names the pipeline would consider "desired" (drives
  // filterUnsafeStatements and the PG entities filter).
  desiredTableNames: string[];
  // Extra live-only tables (orphans) the scenario creates via seed; on PG
  // these must also be in the kit's entities filter for it to see them.
  extraFilterTables?: string[];
  // What the text consumers must decide for this scenario's statements.
  expectDestructiveOffenders: "none" | "some";
  // Table names filterUnsafeStatements must strip DROPs for (empty = pass-through).
  expectFilterBlocks: string[];
  // The v1 rename resolver crashes (deterministically) instead of emitting —
  // scenarios marked `throws` snapshot the error message, not statements.
  throws?: RegExp;
}

// Shared consumer assertions, run against every captured (non-throwing)
// scenario. Keeping them in one place means a future wording drift fails
// EVERY consumer check loudly, not just the one someone remembered to write.
export function assertTextConsumers(
  scenario: GoldenScenario,
  captured: CapturedPush
): void {
  // 1. Destructive-statement scanner (Phase D guard).
  const offenders = findUnexpectedDestructiveStatements(captured.sqlStatements);
  if (scenario.expectDestructiveOffenders === "none") {
    expect(offenders, `${scenario.name}: scanner false-positive`).toEqual([]);
  } else {
    expect(
      offenders.length,
      `${scenario.name}: scanner MISSED a destructive statement — guard regex no longer matches v1 wording`
    ).toBeGreaterThan(0);
  }

  // 2. Drop-guard filter (fresh-push / Phase D).
  const kept = filterUnsafeStatements(
    captured.sqlStatements,
    scenario.desiredTableNames
  );
  for (const blockedTable of scenario.expectFilterBlocks) {
    const leaked = kept.filter(s =>
      new RegExp(`DROP\\s+TABLE[^;]*${blockedTable}`, "i").test(s)
    );
    expect(
      leaked,
      `${scenario.name}: filterUnsafeStatements let a DROP for unmanaged "${blockedTable}" through`
    ).toEqual([]);
  }
  if (scenario.expectFilterBlocks.length === 0) {
    expect(
      kept.length,
      `${scenario.name}: filter dropped statements it should pass through`
    ).toBe(captured.sqlStatements.length);
  }

  // 3. fresh-push splitStatements: nothing the kit emitted may be lost
  // (PRAGMA choreography included — dropping it is #5782 territory).
  const pieces = splitStatements(captured.sqlStatements);
  expect(
    pieces.length,
    `${scenario.name}: splitStatements lost statements`
  ).toBeGreaterThanOrEqual(captured.sqlStatements.length);
  const joined = pieces.join("\n");
  for (const s of captured.sqlStatements) {
    const head = s.trim().split(/\s+/).slice(0, 3).join(" ");
    if (head.length > 0) {
      expect(
        joined.toLowerCase(),
        `${scenario.name}: statement head "${head}" missing after split`
      ).toContain(head.split(";")[0].toLowerCase().slice(0, 20));
    }
  }
}

export function fixturePath(dialect: string, name: string): string {
  return `./__fixtures__/${dialect}-${name}.json`;
}

export function serializeCapture(captured: CapturedPush): string {
  return JSON.stringify(captured, null, 2) + "\n";
}
