/**
 * One outcome per column, chosen by the fixed order, over states that hold together.
 *
 * Each pair below can hold for one column at once. The column gets the first outcome in the order,
 * and its record still carries the facts behind the other.
 */
import { describe, expect, it } from "vitest";

import {
  NO_RUN_FACTS,
  OUTCOME_ORDER,
  outcomeOf,
  type ColumnRunFacts,
  type TableLockFacts,
} from "../outcome";
import { repairRecord } from "../report";
import type { DiffersFinding } from "../types";

const differs: DiffersFinding = {
  kind: "differs",
  location: {
    kind: "fieldGroup",
    slug: "card",
    field: "related",
    table: "comp_card",
    column: "related",
    translation: false,
  },
  expected: { type: "json", nullable: true },
  live: { type: "varchar(36)", nullable: true },
  aspects: { type: true, nullability: false },
  cause: {
    kind: "legacy",
    shape: "component-list-in-scalar",
    before: "0.0.2-alpha.67",
  },
  judgement: { class: "safe", reasons: [] },
  conversion: {
    steps: [["widen"], ["rewrite"], ["retype"]],
    rewritesTable: true,
    blocks: "writes",
    cannotCarry: [],
    notCarried: [],
  },
  rowsRewritten: 3,
};

const lock: TableLockFacts = {
  table: "comp_card",
  tries: 5,
  waitedMs: 90_000,
  holder: { sessions: [], couldNotRead: null, wholeDatabase: false },
  nextStep: "run again once the holder ends",
};

const facts = (over: Partial<ColumnRunFacts>): ColumnRunFacts => ({
  ...NO_RUN_FACTS,
  ...over,
});

describe("the order", () => {
  it("is the documented list, first to last", () => {
    expect(OUTCOME_ORDER).toEqual([
      "not-migrated",
      "pending-migration",
      "plugin-owned",
      "failed",
      "interrupted",
      "unavailable-locked",
      "blocked",
      "needs-consent",
      "skipped-needs-consent",
      "would-convert",
      "converted",
    ]);
  });
});

describe("each pair that can hold together gives one outcome and keeps the other's facts", () => {
  it("an interrupted column on a locked table is interrupted, with its step and the lock", () => {
    const progress = { recordedStep: "widen", liveStep: null };
    const f = facts({ lock, progress });
    expect(outcomeOf(differs, f, "apply")).toBe("interrupted");
    const r = repairRecord(differs, f, "apply");
    expect(r.progress).toEqual(progress);
    expect(r.lock).toEqual(lock);
  });

  it("a blocked column on a locked table is unavailable, and keeps its class and reasons", () => {
    const blocked: DiffersFinding = {
      ...differs,
      judgement: {
        class: "blocked",
        reasons: [{ kind: "late-write", class: "blocked" }],
      },
    };
    const f = facts({ lock });
    expect(outcomeOf(blocked, f, "dry-run")).toBe("unavailable-locked");
    const r = repairRecord(blocked, f, "dry-run");
    expect(r.class).toBe("blocked");
    expect(r.reasons).toEqual([
      { kind: "late-write", class: "blocked", rows: null },
    ]);
    expect(r.lock).toEqual(lock);
  });

  it("a column holding a recorded step whose next step fails is failed, naming the step it holds", () => {
    const failure = { reason: "Invalid JSON text", heldStep: "rewrite" };
    const progress = { recordedStep: "rewrite", liveStep: "rewrite" };
    const f = facts({ failure, progress });
    expect(outcomeOf(differs, f, "apply")).toBe("failed");
    const r = repairRecord(differs, f, "apply");
    expect(r.failure).toEqual(failure);
    expect(r.progress).toEqual(progress);
  });

  it("a plugin-owned column on a locked table is plugin-owned, and keeps the lock", () => {
    const owned: DiffersFinding = {
      ...differs,
      plugin: "seo-kit",
      judgement: null,
      conversion: null,
      rowsRewritten: null,
    };
    const f = facts({ lock });
    expect(outcomeOf(owned, f, "dry-run")).toBe("plugin-owned");
    expect(repairRecord(owned, f, "dry-run").lock).toEqual(lock);
  });

  it("a column both lossy and blocked is blocked, and names both reasons with their rows", () => {
    const both: DiffersFinding = {
      ...differs,
      expected: { type: "json", nullable: false },
      judgement: {
        class: "blocked",
        reasons: [
          {
            kind: "not-json",
            class: "lossy",
            rows: { first: [{ id: "1" }], count: 1 },
          },
          {
            kind: "null-under-not-null",
            class: "blocked",
            rows: { first: [{ id: "2" }], count: 1 },
          },
        ],
      },
    };
    expect(outcomeOf(both, NO_RUN_FACTS, "dry-run")).toBe("blocked");
    expect(outcomeOf(both, NO_RUN_FACTS, "apply")).toBe("blocked");
    expect(repairRecord(both, NO_RUN_FACTS, "dry-run").reasons).toEqual([
      {
        kind: "not-json",
        class: "lossy",
        rows: { first: [{ id: "1" }], count: 1 },
      },
      {
        kind: "null-under-not-null",
        class: "blocked",
        rows: { first: [{ id: "2" }], count: 1 },
      },
    ]);
  });
});

describe("each case maps to one outcome from the list", () => {
  it("a missing table or column is not migrated, before its plugin", () => {
    expect(
      outcomeOf(
        {
          kind: "not-migrated",
          location: differs.location,
          plugin: "seo-kit",
          missing: "table",
          expected: differs.expected,
        },
        facts({ lock }),
        "dry-run"
      )
    ).toBe("not-migrated");
  });

  it("a pending change is pending a migration, before its plugin", () => {
    expect(
      outcomeOf(
        {
          kind: "pending-migration",
          location: differs.location,
          plugin: "seo-kit",
          applied: null,
          configured: differs.expected,
          live: null,
        },
        NO_RUN_FACTS,
        "dry-run"
      )
    ).toBe("pending-migration");
  });

  it("a column whose table's definition could not be read is unavailable", () => {
    expect(
      outcomeOf(
        {
          kind: "definition-unreadable",
          location: differs.location,
          expected: differs.expected,
        },
        facts({ lock }),
        "dry-run"
      )
    ).toBe("unavailable-locked");
  });

  it("a safe column would convert on a dry run, and is converted once an apply finished it", () => {
    expect(outcomeOf(differs, NO_RUN_FACTS, "dry-run")).toBe("would-convert");
    expect(outcomeOf(differs, facts({ converted: true }), "apply")).toBe(
      "converted"
    );
  });

  it("a column an apply finished from a recorded step is converted, not interrupted", () => {
    expect(
      outcomeOf(
        differs,
        facts({
          converted: true,
          progress: { recordedStep: "retype", liveStep: "retype" },
        }),
        "apply"
      )
    ).toBe("converted");
  });
});
