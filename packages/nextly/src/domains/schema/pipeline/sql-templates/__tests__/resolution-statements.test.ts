/**
 * A fill a migration file writes for a Required date column is the instant the
 * push binds, in the literal each dialect's date column reads: an ISO
 * timestamp on PostgreSQL, the UTC datetime MySQL's pinned session takes, and
 * the epoch seconds SQLite stores.
 */
import { describe, expect, it } from "vitest";

import { resolutionStatement } from "../resolution-statements";

const at = new Date(Date.UTC(2026, 10, 11, 9, 30, 15, 250));
const fill = (value: unknown) =>
  ({
    tableName: "dc_posts",
    columnName: "published_on",
    kind: "fill",
    value,
  }) as const;

describe("resolutionStatement for a date fill", () => {
  it.each([
    ["postgresql", `'2026-11-11T09:30:15.250Z'`],
    ["mysql", `'2026-11-11 09:30:15.250'`],
    ["sqlite", String(Math.floor(at.getTime() / 1000))],
  ] as const)("writes the instant as %s reads a date", (dialect, literal) => {
    expect(resolutionStatement(fill(at), dialect)).toContain(
      `= ${literal} WHERE`
    );
  });

  it("still refuses a value no column stores", () => {
    expect(() =>
      resolutionStatement(fill(new Date(Number.NaN)), "postgresql")
    ).toThrow(/must be a string, a finite number, a boolean or a date/);
    expect(() =>
      resolutionStatement(fill({ not: "a date" }), "postgresql")
    ).toThrow(/must be a string/);
  });
});
