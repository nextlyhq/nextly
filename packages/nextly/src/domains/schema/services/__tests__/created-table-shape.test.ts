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

  // The comparison a push makes leaves out the columns a step of `nextly migrate` owns; a create
  // asks for them all the same.
  it("names a requested column a step of nextly migrate owns that the table does not hold", async () => {
    const withRevision: TableSpec = {
      ...requested,
      columns: [
        ...requested.columns,
        { name: "_revision", type: "integer", nullable: false },
      ],
    };
    liveTable(requested.columns);
    expect(await columnsTheCreateLeftOut({}, "sqlite", withRevision)).toEqual([
      { column: "_revision", problem: "missing", requestedType: "integer" },
    ]);
  });

  // The creating SQL keys a reference to one entry by its target's id type, where the desired table
  // names the descriptor's text: the reference is held as asked either way.
  it("takes a single reference held in its target's id type as asked", async () => {
    const withReference: TableSpec = {
      ...requested,
      columns: [
        ...requested.columns,
        {
          name: "owner",
          type: "text",
          nullable: true,
          holdsSingleReference: true,
        },
      ],
    };
    liveTable([
      ...requested.columns,
      { name: "owner", type: "uuid", nullable: true },
    ]);
    expect(
      await columnsTheCreateLeftOut({}, "postgresql", withReference)
    ).toEqual([]);
  });

  it("still names a single reference held in a type no id is held in", async () => {
    const withReference: TableSpec = {
      ...requested,
      columns: [
        ...requested.columns,
        {
          name: "owner",
          type: "text",
          nullable: true,
          holdsSingleReference: true,
        },
      ],
    };
    liveTable([
      ...requested.columns,
      { name: "owner", type: "integer", nullable: true },
    ]);
    expect(
      (await columnsTheCreateLeftOut({}, "postgresql", withReference)).map(
        e => e.column
      )
    ).toEqual(["owner"]);
  });
});
