/**
 * A translated date field's companion column an earlier release made with a time zone on
 * PostgreSQL is converted, not judged as a column that cannot hold its field: it holds the same
 * instants, each read in the session's zone.
 */
import { describe, expect, it } from "vitest";

import type { ColumnSpec } from "../../schema/pipeline/diff/types";

import {
  companionColumnsThatCannotHold,
  earlierCompanionColumnType,
  planColumnsTranslatedBefore,
  zonedDateColumns,
} from "./companion-column-holds";

const published = { name: "published", type: "date", localized: true };
const column = (type: string): ColumnSpec => ({
  name: "published",
  type,
  nullable: true,
});
const args = (
  type: string,
  dialect: "postgresql" | "mysql" = "postgresql"
) => ({
  fields: [published],
  live: [column(type)],
  dialect,
  builtBy: "collection" as const,
});

describe("earlierCompanionColumnType", () => {
  it("names a PostgreSQL date column's earlier type, and no other", () => {
    expect(earlierCompanionColumnType("TIMESTAMP", "postgresql")).toBe(
      "timestamp with time zone"
    );
    expect(earlierCompanionColumnType("TEXT", "postgresql")).toBeUndefined();
    expect(earlierCompanionColumnType("DATETIME(3)", "mysql")).toBeUndefined();
  });
});

describe("zonedDateColumns", () => {
  it("lists a date column with a time zone, to the field's own type", () => {
    expect(zonedDateColumns(args("timestamptz"))).toEqual([
      { column: "published", type: "TIMESTAMP" },
    ]);
  });

  it("lists nothing once the column is the field's own type", () => {
    expect(zonedDateColumns(args("timestamp"))).toEqual([]);
  });

  it("lists nothing on MySQL", () => {
    expect(zonedDateColumns(args("datetime", "mysql"))).toEqual([]);
  });
});

describe("the judges of a companion column", () => {
  it("take a date column with a time zone as the field's", () => {
    expect(
      companionColumnsThatCannotHold({
        ...args("timestamptz"),
        surface: "code",
      })
    ).toEqual([]);
    expect(
      planColumnsTranslatedBefore({
        ...args("timestamptz"),
        before: new Map([["published", published]]),
      })
    ).toEqual({ widen: [], refuse: [], warn: [] });
  });

  it("still refuse a column of another kind", () => {
    expect(
      companionColumnsThatCannotHold({ ...args("integer"), surface: "code" })
    ).toHaveLength(1);
  });
});
