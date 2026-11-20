/**
 * The questions the push asks of a change (`pushQuestionSet`): its rename candidates, and the
 * classifier's events less each column drop a candidate covers, which is asked as that pair. The
 * schema dialog's questions are drawn from the same set, so these cases pin the one rule both read.
 */
import { describe, expect, it } from "vitest";

import type { RenameCandidate } from "../pushschema-pipeline-interfaces";
import { pushQuestionSet } from "../pushschema-pipeline";
import type { ClassifierEvent } from "../resolution/types";

const candidate = (
  tableName: string,
  fromColumn: string,
  toColumn: string
): RenameCandidate => ({
  tableName,
  fromColumn,
  toColumn,
  fromType: "text",
  toType: "text",
  typesCompatible: true,
  preservesValues: true,
  defaultSuggestion: "rename",
});

const drop = (tableName: string, columnName: string): ClassifierEvent => ({
  id: `destructive_drop:${tableName}.${columnName}`,
  kind: "destructive_drop",
  tableName,
  columnName,
  columnType: "text",
  tableRowCount: 3,
  applicableResolutions: ["confirm_drop"],
});

const required = (tableName: string, columnName: string): ClassifierEvent => ({
  id: `add_required_field_no_default:${tableName}.${columnName}`,
  kind: "add_required_field_no_default",
  tableName,
  columnName,
  tableRowCount: 3,
  applicableResolutions: ["provide_default"],
});

describe("pushQuestionSet", () => {
  it("asks a drop a rename candidate covers as that pair, not again as a drop", () => {
    const asked = pushQuestionSet({
      candidates: [candidate("dc_posts", "views", "visits")],
      events: [drop("dc_posts", "views")],
    });

    expect(asked.candidates).toEqual([
      candidate("dc_posts", "views", "visits"),
    ]);
    expect(asked.events).toEqual([]);
  });

  it("asks a drop no candidate covers", () => {
    const asked = pushQuestionSet({
      candidates: [candidate("dc_posts", "views", "visits")],
      events: [drop("dc_posts", "views"), drop("dc_posts", "notes")],
    });

    expect(asked.events).toEqual([drop("dc_posts", "notes")]);
  });

  // A candidate covers its own table's column only: the same column name on another table is a
  // drop of its own, asked as one.
  it("asks a drop of the same column on another table", () => {
    const asked = pushQuestionSet({
      candidates: [candidate("dc_posts", "views", "visits")],
      events: [drop("dc_posts", "views"), drop("dc_pages", "views")],
    });

    expect(asked.events).toEqual([drop("dc_pages", "views")]);
  });

  it("keeps every question that is not a drop, a covered column's included", () => {
    const asked = pushQuestionSet({
      candidates: [candidate("dc_posts", "views", "visits")],
      events: [required("dc_posts", "visits"), required("dc_posts", "views")],
    });

    expect(asked.events).toEqual([
      required("dc_posts", "visits"),
      required("dc_posts", "views"),
    ]);
  });
});
