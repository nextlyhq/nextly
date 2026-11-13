/**
 * Which recorded indexes stop migrate:create widening a MySQL column into TEXT: those that key the
 * column as the snapshot recorded it and that the run keeps. A snapshot that recorded no indexes
 * for the table cannot rule one out.
 */
import { describe, expect, it } from "vitest";

import type {
  IndexSpec,
  NextlySchemaSnapshot,
  Operation,
} from "../../pipeline/diff/types";
import { refuseIndexedTextWidening } from "../indexed-text-widening";

const TAG_INDEX: IndexSpec = {
  name: "idx_single_about_tag",
  columns: ["tag"],
  unique: false,
};

/** One table, `single_about`, whose `tag` the snapshot recorded as `varchar(255)`. */
function snapshot(indexes: IndexSpec[] | undefined): NextlySchemaSnapshot {
  return {
    tables: [
      {
        name: "single_about",
        columns: [
          { name: "id", type: "varchar(36)", nullable: false },
          { name: "tag", type: "varchar(255)", nullable: true },
        ],
        ...(indexes === undefined ? {} : { indexes }),
      },
    ],
  } as unknown as NextlySchemaSnapshot;
}

const widen = (column: string): Operation =>
  ({
    type: "change_column_type",
    tableName: "single_about",
    columnName: column,
    fromType: "varchar(255)",
    toType: "text",
  }) as Operation;

/** The refusal's message, or undefined when the run goes ahead. */
function refusal(
  operations: Operation[],
  previous: NextlySchemaSnapshot
): string | undefined {
  try {
    refuseIndexedTextWidening({ operations, previous, dialect: "mysql" });
    return undefined;
  } catch (error) {
    return (error as { publicMessage?: string }).publicMessage;
  }
}

describe("widening a MySQL column into TEXT", () => {
  it("is refused under an index the run keeps, naming it", () => {
    expect(refusal([widen("tag")], snapshot([TAG_INDEX]))).toContain(
      "idx_single_about_tag"
    );
  });

  it("goes ahead when no recorded index keys the column", () => {
    expect(refusal([widen("tag")], snapshot([]))).toBeUndefined();
  });

  it("is refused where the snapshot recorded no indexes, which cannot rule one out", () => {
    expect(refusal([widen("tag")], snapshot(undefined))).toContain(
      "cannot be read"
    );
  });

  it("goes ahead when the same run drops the index", () => {
    const drop = {
      type: "drop_index",
      tableName: "single_about",
      index: TAG_INDEX,
    } as Operation;
    expect(
      refusal([drop, widen("tag")], snapshot([TAG_INDEX]))
    ).toBeUndefined();
  });

  it("finds the index of a column renamed in the same run by its recorded name", () => {
    const rename = {
      type: "rename_column",
      tableName: "single_about",
      fromColumn: "tag",
      toColumn: "label",
      fromType: "varchar(255)",
      toType: "varchar(255)",
    } as Operation;
    expect(refusal([rename, widen("label")], snapshot([TAG_INDEX]))).toContain(
      "single_about.label"
    );
  });

  it("is refused for a rename that widens the column itself", () => {
    const renameAndWiden = {
      type: "rename_column",
      tableName: "single_about",
      fromColumn: "tag",
      toColumn: "label",
      fromType: "varchar(255)",
      toType: "text",
    } as Operation;
    expect(refusal([renameAndWiden], snapshot([TAG_INDEX]))).toContain(
      "idx_single_about_tag"
    );
  });

  it("never refuses on another dialect", () => {
    expect(() =>
      refuseIndexedTextWidening({
        operations: [widen("tag")],
        previous: snapshot(undefined),
        dialect: "postgresql",
      })
    ).not.toThrow();
  });
});
