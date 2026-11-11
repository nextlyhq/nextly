/**
 * What a create left out of the table it was asked for, judged by the comparison a push makes: a
 * requested column the live table lacks, or holds as another type. A column the table holds
 * beyond the request is not the question, and a table that is not there lacks every column.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  NextlySchemaSnapshot,
  TableSpec,
} from "../../pipeline/diff/types";

const live: { snapshot: NextlySchemaSnapshot } = { snapshot: { tables: [] } };

vi.mock("../../pipeline/diff/introspect-live", () => ({
  introspectLiveColumns: vi.fn(async () => live.snapshot),
}));

const { columnsTheCreateLeftOut, describeColumnsLeftOut } = await import(
  "../created-table-shape"
);

const requested: TableSpec = {
  name: "comp_card",
  columns: [
    { name: "id", type: "text", nullable: false },
    { name: "title", type: "text", nullable: true },
    { name: "views", type: "integer", nullable: true },
  ],
};

function liveTable(columns: TableSpec["columns"]): void {
  live.snapshot = { tables: [{ name: "comp_card", columns }] };
}

describe("columnsTheCreateLeftOut", () => {
  beforeEach(() => {
    live.snapshot = { tables: [] };
  });

  it("finds nothing left out when every requested column is there as asked", async () => {
    liveTable(requested.columns);
    expect(await columnsTheCreateLeftOut({}, "sqlite", requested)).toEqual([]);
  });

  it("names a requested column the table does not hold", async () => {
    liveTable(requested.columns.filter(column => column.name !== "views"));
    expect(await columnsTheCreateLeftOut({}, "sqlite", requested)).toEqual([
      { column: "views", problem: "missing", requestedType: "integer" },
    ]);
  });

  it("names a requested column the table holds as another type", async () => {
    liveTable([
      ...requested.columns.filter(column => column.name !== "views"),
      { name: "views", type: "text", nullable: true },
    ]);
    const leftOut = await columnsTheCreateLeftOut({}, "sqlite", requested);
    expect(leftOut).toEqual([
      expect.objectContaining({ column: "views", problem: "otherType" }),
    ]);
    expect(describeColumnsLeftOut(leftOut)).toContain('"views" is text');
  });

  it("does not count a column the table holds beyond the request", async () => {
    liveTable([
      ...requested.columns,
      { name: "extra", type: "text", nullable: true },
    ]);
    expect(await columnsTheCreateLeftOut({}, "sqlite", requested)).toEqual([]);
  });

  it("names every requested column when the table is not there", async () => {
    expect(
      (await columnsTheCreateLeftOut({}, "sqlite", requested)).map(
        e => e.column
      )
    ).toEqual(["id", "title", "views"]);
  });
});
