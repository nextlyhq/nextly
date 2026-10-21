/**
 * The workflow keys, `_pendingChange` and `_inRelease`, as a filter carries
 * them: which values are accepted, which are refused and how, and what the
 * query is handed once they are taken out.
 *
 * The REST cases go through `parseWhereParam`, the door a list's `?where=`
 * address enters by, in both the JSON form and the bracket form, so a value the
 * dashboard links with is read the same whichever form the link uses.
 */
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { parseWhereParam } from "../../../../dispatcher/helpers/validation";
import { NextlyError } from "../../../../errors/nextly-error";
import { buildDrizzleCondition } from "../../../../services/collections/drizzle-condition";
import { unknownFieldProblem } from "../filter-shape";
import { buildWhereClause } from "../query-operators";
import {
  extractWorkflowFilter,
  IN_RELEASE_KEY,
  PENDING_CHANGE_KEY,
} from "../workflow-filter";

/** The problems a call refused with, or a failure when it did not refuse. */
function refusal(
  run: () => unknown
): { code: string; path: string; message: string }[] {
  try {
    run();
  } catch (error) {
    expect(NextlyError.is(error), String(error)).toBe(true);
    const e = error as NextlyError;
    expect(e.statusCode).toBe(400);
    return (
      e.publicData as {
        errors: { code: string; path: string; message: string }[];
      }
    ).errors;
  }
  throw new Error("expected the filter to be refused, and it was accepted");
}

const fromJson = (where: unknown) => () =>
  parseWhereParam(JSON.stringify(where));

describe("the workflow keys at the top level of a REST filter", () => {
  it.each([
    ["_pendingChange: true", { _pendingChange: true }],
    ["_inRelease: true", { _inRelease: true }],
    [
      "_inRelease with a bound",
      { _inRelease: { scheduledBefore: "2026-10-28T09:00:00Z" } },
    ],
    [
      "_inRelease with an offset bound and fractional seconds",
      { _inRelease: { scheduledBefore: "2026-10-28T09:00:00.250+05:00" } },
    ],
    [
      "both beside a field condition",
      {
        _pendingChange: true,
        _inRelease: true,
        status: { equals: "draft" },
      },
    ],
  ])("accepts %s from JSON", (_name, where) => {
    expect(parseWhereParam(JSON.stringify(where))).toEqual(where);
  });

  it("accepts the bracket forms, reading them as the JSON forms", () => {
    expect(parseWhereParam(undefined, "where[_pendingChange]=true")).toEqual({
      _pendingChange: true,
    });
    expect(parseWhereParam(undefined, "where[_inRelease]=true")).toEqual({
      _inRelease: true,
    });
    expect(
      parseWhereParam(
        undefined,
        "where[_inRelease][scheduledBefore]=2026-10-28T09:00:00Z"
      )
    ).toEqual({ _inRelease: { scheduledBefore: "2026-10-28T09:00:00Z" } });
  });

  it.each([
    ["_pendingChange: false", { _pendingChange: false }, PENDING_CHANGE_KEY],
    ["_pendingChange as text", { _pendingChange: "true" }, PENDING_CHANGE_KEY],
    ["_pendingChange as an object", { _pendingChange: {} }, PENDING_CHANGE_KEY],
    ["_inRelease: false", { _inRelease: false }, IN_RELEASE_KEY],
    ["_inRelease as an empty object", { _inRelease: {} }, IN_RELEASE_KEY],
    [
      "_inRelease with a date and no time",
      { _inRelease: { scheduledBefore: "2026-10-28" } },
      IN_RELEASE_KEY,
    ],
    [
      "_inRelease with a time and no zone",
      { _inRelease: { scheduledBefore: "2026-10-28T09:00:00" } },
      IN_RELEASE_KEY,
    ],
    [
      "_inRelease with an impossible instant",
      { _inRelease: { scheduledBefore: "2026-13-45T09:00:00Z" } },
      IN_RELEASE_KEY,
    ],
    [
      "_inRelease with a number of milliseconds",
      { _inRelease: { scheduledBefore: 1792400000000 } },
      IN_RELEASE_KEY,
    ],
    [
      "_inRelease with an extra key",
      {
        _inRelease: {
          scheduledBefore: "2026-10-28T09:00:00Z",
          scheduledAfter: "2026-10-21T09:00:00Z",
        },
      },
      IN_RELEASE_KEY,
    ],
    [
      "_inRelease with a misspelt bound",
      { _inRelease: { scheduled_before: "2026-10-28T09:00:00Z" } },
      IN_RELEASE_KEY,
    ],
  ])("refuses %s as malformed", (_name, where, key) => {
    expect(refusal(fromJson(where))).toEqual([
      expect.objectContaining({
        code: "FILTER_INVALID_OPERAND",
        path: `where.${key}`,
      }),
    ]);
  });

  it("refuses a bracket bound with no zone, as the JSON form is refused", () => {
    expect(
      refusal(() =>
        parseWhereParam(
          undefined,
          "where[_inRelease][scheduledBefore]=2026-10-28T09:00:00"
        )
      ).map(p => p.code)
    ).toEqual(["FILTER_INVALID_OPERAND"]);
  });
});

describe("the workflow keys below the top level", () => {
  it.each([
    [
      "_pendingChange inside and",
      { and: [{ _pendingChange: true }, { status: { equals: "draft" } }] },
      "where.and.0._pendingChange",
    ],
    [
      "_inRelease inside or",
      { or: [{ title: { equals: "a" } }, { _inRelease: true }] },
      "where.or.1._inRelease",
    ],
    [
      "_inRelease two levels down",
      { and: [{ or: [{ _inRelease: { scheduledBefore: "x" } }] }] },
      "where.and.0.or.0._inRelease",
    ],
  ])("refuses %s as misplaced", (_name, where, path) => {
    expect(refusal(fromJson(where))).toEqual([
      expect.objectContaining({ code: "FILTER_MISPLACED_KEY", path }),
    ]);
  });
});

describe("extractWorkflowFilter", () => {
  it("takes both keys out and hands back the rest", () => {
    const { filter, cleanedWhere, problems } = extractWorkflowFilter({
      _pendingChange: true,
      _inRelease: { scheduledBefore: "2026-10-28T09:00:00Z" },
      status: { equals: "draft" },
    });
    expect(problems).toEqual([]);
    expect(filter).toEqual({
      pendingChange: true,
      inRelease: { scheduledBefore: new Date("2026-10-28T09:00:00Z") },
    });
    expect(cleanedWhere).toEqual({ status: { equals: "draft" } });
  });

  it("reads the open form as no upper bound", () => {
    expect(extractWorkflowFilter({ _inRelease: true }).filter).toEqual({
      pendingChange: false,
      inRelease: { scheduledBefore: null },
    });
  });

  it("leaves no filter behind when the keys were all there was", () => {
    expect(
      extractWorkflowFilter({ _pendingChange: true }).cleanedWhere
    ).toBeUndefined();
  });

  it("hands a filter without them back untouched", () => {
    const where = { status: { equals: "draft" } };
    const read = extractWorkflowFilter(where);
    expect(read.filter).toBeNull();
    expect(read.cleanedWhere).toBe(where);
  });

  it("returns an unreadable value as a problem, never as no condition", () => {
    // Dropping it would run the read under a wider filter than was written.
    const read = extractWorkflowFilter({
      _inRelease: {},
      status: { equals: "draft" },
    });
    expect(read.problems.map(p => p.code)).toEqual(["FILTER_INVALID_OPERAND"]);
    expect(read.filter).toEqual({ pendingChange: false, inRelease: null });
  });
});

describe("unknownFieldProblem", () => {
  it("is the refusal the condition builder gives a field it cannot find", () => {
    // `_inRelease` is refused to a caller who may not read releases with this
    // problem, so it must be word for word what an unknown field gets.
    const table = pgTable("posts", { id: uuid("id"), title: text("title") });
    const built = refusal(() =>
      buildDrizzleCondition(buildWhereClause({ titel: { equals: "a" } }), table)
    );
    expect(built).toEqual([unknownFieldProblem("where.titel", "titel")]);
  });
});
