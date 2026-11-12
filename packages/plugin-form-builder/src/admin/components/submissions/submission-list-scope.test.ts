/**
 * The list's order and a submission's neighbours in it: rows sent at the same
 * moment still each have a newer and an older, and every row's place in the
 * list is its own.
 */
import { describe, expect, it } from "vitest";

import { LIST_SORT, neighbourQueries } from "./submission-list-scope";

interface Row {
  id: string;
  submittedAt: string;
  status: string;
}

type Where = Record<string, unknown>;

/** One field condition, as the entries API reads the operators used here. */
function holds(value: string, condition: Record<string, string>): boolean {
  return Object.entries(condition).every(([op, operand]) => {
    if (op === "equals") return value === operand;
    if (op === "not_equals") return value !== operand;
    if (op === "greater_than") return value > operand;
    if (op === "less_than") return value < operand;
    throw new Error(`operator ${op} is not modelled`);
  });
}

/** A filter over rows: field conditions, `and` and `or`, all joined by and. */
function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "or") return (value as Where[]).some(w => matches(row, w));
    if (key === "and") return (value as Where[]).every(w => matches(row, w));
    return holds(row[key as keyof Row], value as Record<string, string>);
  });
}

/** Rows in a sort's order, keys as the entries API spells them. */
function sorted(rows: Row[], sort: string): Row[] {
  const keys = sort.split(",").map(raw => ({
    field: raw.replace(/^-/, "") as keyof Row,
    desc: raw.startsWith("-"),
  }));
  return [...rows].sort((a, b) => {
    for (const { field, desc } of keys) {
      if (a[field] === b[field]) continue;
      return (a[field] < b[field] ? -1 : 1) * (desc ? -1 : 1);
    }
    return 0;
  });
}

const AT = "2026-11-10T14:15:00.000Z";
const ROWS: Row[] = [
  { id: "c", submittedAt: AT, status: "new" },
  { id: "a", submittedAt: AT, status: "new" },
  { id: "d", submittedAt: "2026-11-11T09:00:00.000Z", status: "new" },
  { id: "b", submittedAt: AT, status: "new" },
  { id: "e", submittedAt: "2026-11-09T09:00:00.000Z", status: "new" },
  { id: "s", submittedAt: AT, status: "spam" },
];

describe("a submission's neighbours in its list", () => {
  it("are the rows beside it, ties on the time included", () => {
    const scope = { status: "all" as const };
    const list = sorted(
      ROWS.filter(row => row.status !== "spam"),
      LIST_SORT
    ).map(row => row.id);
    expect(list).toEqual(["d", "a", "b", "c", "e"]);

    for (const [index, id] of list.entries()) {
      const row = ROWS.find(each => each.id === id)!;
      const around = neighbourQueries(scope, row.submittedAt, row.id);
      const newer = sorted(
        ROWS.filter(each => matches(each, around.newer.where)),
        around.newer.sort
      );
      const older = sorted(
        ROWS.filter(each => matches(each, around.older.where)),
        around.older.sort
      );
      expect(newer[0]?.id).toBe(list[index - 1]);
      expect(older[0]?.id).toBe(list[index + 1]);
      // Its place: how many come before it.
      expect(newer).toHaveLength(index);
    }
  });
});
