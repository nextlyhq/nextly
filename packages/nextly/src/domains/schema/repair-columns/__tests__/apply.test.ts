/**
 * What an apply's document says, without a database: each outcome counted, the code a failed column
 * gives among blocked ones, the way each MySQL statement states how it must run, and the names of a
 * conversion's steps.
 */
import { describe, expect, it } from "vitest";

import { restatedColumn } from "../../pipeline/sql-templates/mysql-live-restate";
import { TABLE_TRY_MS } from "../apply";
import {
  NO_RUN_FACTS,
  type ColumnRunFacts,
  type TableLockFacts,
} from "../outcome";
import { repairRecord } from "../report";
import { reportDocument } from "../report-json";
import { stepName } from "../resume";
import type { ColumnLocation, DiffersFinding } from "../types";

const at = (column: string): ColumnLocation => ({
  kind: "collection",
  slug: "posts",
  field: column,
  table: "dc_posts",
  column,
  translation: false,
});

/** A difference of `column` whose rows give `cls`. */
function differs(
  column: string,
  cls: "safe" | "lossy" | "blocked"
): DiffersFinding {
  return {
    kind: "differs",
    location: at(column),
    expected: { type: "json", nullable: true },
    live: { type: "text", nullable: true },
    aspects: { type: true, nullability: false },
    cause: null,
    judgement: {
      class: cls,
      reasons:
        cls === "safe"
          ? []
          : [{ kind: cls === "lossy" ? "not-json" : "too-long", class: cls }],
    },
    conversion: {
      steps: [["ALTER TABLE `dc_posts` MODIFY COLUMN `x` json"]],
      rewritesTable: true,
      blocks: "writes",
      cannotCarry: [],
      notCarried: [],
    },
    rowsRewritten: 3,
  };
}

const lock: TableLockFacts = {
  table: "dc_posts",
  tries: 1,
  waitedMs: 5_000,
  holder: { sessions: [], couldNotRead: null, wholeDatabase: false },
  nextStep: "run again once the session using the table ends",
};

/** An apply's document over `columns`, each with the facts the run established for it. */
function applyDocument(
  columns: Array<[DiffersFinding, Partial<ColumnRunFacts>]>
) {
  return reportDocument({
    nextlyVersion: "test",
    mode: "apply",
    dialect: "mysql",
    schemaLock: { state: "free", holder: null, unreadable: null },
    records: columns.map(([finding, facts]) =>
      repairRecord(finding, { ...NO_RUN_FACTS, ...facts }, "apply")
    ),
    warnings: [],
  });
}

describe("repair-columns --apply document", () => {
  it("the summary counts each outcome", () => {
    const document = applyDocument([
      [differs("a", "safe"), { converted: true }],
      [differs("b", "safe"), { converted: true }],
      [
        differs("c", "safe"),
        { failure: { reason: "refused", heldStep: null } },
      ],
      [
        differs("d", "safe"),
        {
          progress: {
            recordedStep: "widened to text",
            liveStep: "widened to text",
          },
        },
      ],
      [differs("e", "safe"), { lock }],
      [differs("f", "blocked"), {}],
      [differs("g", "lossy"), {}],
    ]);
    const outcomes = document.result?.summary.outcomes;
    expect(outcomes).toMatchObject({
      converted: 2,
      failed: 1,
      interrupted: 1,
      "unavailable-locked": 1,
      blocked: 1,
      "skipped-needs-consent": 1,
      "would-convert": 0,
      "needs-consent": 0,
    });
    expect(document.result?.summary.total).toBe(7);
  });

  it("exits with the failed code when one column fails while another stays blocked", () => {
    expect(
      applyDocument([
        [
          differs("a", "safe"),
          { failure: { reason: "refused", heldStep: null } },
        ],
        [differs("b", "blocked"), {}],
      ])
    ).toMatchObject({ ok: false, exitCode: 3 });
    // Blocked alone is a difference that remains, and converted alone is none.
    expect(applyDocument([[differs("b", "blocked"), {}]]).exitCode).toBe(2);
    expect(
      applyDocument([[differs("a", "safe"), { converted: true }]])
    ).toMatchObject({
      ok: true,
      exitCode: 0,
    });
  });
});

describe("a MySQL conversion names how it must run", () => {
  it("a type change copies the table and lets reads continue; a nullability change runs in place", () => {
    const [typeChange] = restatedColumn("t", "c", {
      type: "json",
      online: "copy",
    });
    expect(typeChange).toContain("ALGORITHM=COPY, LOCK=SHARED");
    const [nullability] = restatedColumn("t", "c", {
      nullable: true,
      online: "in-place",
    });
    expect(nullability).toContain("ALGORITHM=INPLACE, LOCK=NONE");
    // Asked nothing, it states nothing, so a migration file's statement is unchanged.
    expect(restatedColumn("t", "c", { nullable: true })[0]).not.toContain(
      "ALGORITHM"
    );
  });
});

describe("a conversion's steps", () => {
  it("are named by the state each leaves the column in", () => {
    expect([0, 1, 2, 3].map(step => stepName(step, 3))).toEqual([
      "not started",
      "widened to text",
      "values rewritten as lists",
      "converted",
    ]);
    expect([0, 1].map(step => stepName(step, 1))).toEqual([
      "not started",
      "converted",
    ]);
  });

  it("waits about five seconds for a table in use, one try", () => {
    expect(TABLE_TRY_MS).toBe(5_000);
  });
});
