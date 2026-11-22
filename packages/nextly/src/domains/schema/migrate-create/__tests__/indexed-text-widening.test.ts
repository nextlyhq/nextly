/**
 * How migrate:create widens a MySQL column into TEXT under a recorded index: each index that keys
 * the column and that the run keeps is dropped before the run's operations and created again after
 * them, under the names the run leaves. A unique index, and a snapshot that recorded no indexes for
 * the table, are refused instead.
 */
import { describe, expect, it } from "vitest";

import type {
  IndexSpec,
  NextlySchemaSnapshot,
  Operation,
} from "../../pipeline/diff/types";
import { withIndexesLiftedForTextWidenings } from "../indexed-text-widening";

const TAG_INDEX: IndexSpec = {
  name: "idx_single_about_tag",
  columns: ["tag"],
  unique: false,
};

/**
 * One table, `single_about`, whose `tag` (and each of `more`) the snapshot recorded as
 * `varchar(255)`.
 */
function snapshot(
  indexes: IndexSpec[] | undefined,
  more: string[] = []
): NextlySchemaSnapshot {
  return {
    tables: [
      {
        name: "single_about",
        columns: [
          { name: "id", type: "varchar(36)", nullable: false },
          { name: "tag", type: "varchar(255)", nullable: true },
          ...more.map(name => ({ name, type: "varchar(255)", nullable: true })),
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

/** The operations the run writes, or the refusal's message. */
function lifted(
  operations: Operation[],
  previous: NextlySchemaSnapshot
): Operation[] | string {
  try {
    return withIndexesLiftedForTextWidenings({
      operations,
      previous,
      dialect: "mysql",
    });
  } catch (error) {
    return (error as { publicMessage?: string }).publicMessage ?? "refused";
  }
}

const dropIndex = (index: IndexSpec, tableName = "single_about"): Operation =>
  ({ type: "drop_index", tableName, index }) as Operation;
const addIndex = (index: IndexSpec, tableName = "single_about"): Operation =>
  ({ type: "add_index", tableName, index }) as Operation;

describe("widening a MySQL column into TEXT", () => {
  it("drops an index the run keeps first and creates it again last", () => {
    expect(lifted([widen("tag")], snapshot([TAG_INDEX]))).toEqual([
      dropIndex(TAG_INDEX),
      widen("tag"),
      addIndex(TAG_INDEX),
    ]);
  });

  it("lifts an index over two columns once, whichever of them the run widens", () => {
    const pair: IndexSpec = {
      name: "idx_single_about_tag_note",
      columns: ["tag", "note"],
      unique: false,
    };
    expect(
      lifted([widen("tag"), widen("note")], snapshot([pair], ["note"]))
    ).toEqual([dropIndex(pair), widen("tag"), widen("note"), addIndex(pair)]);
  });

  it("goes ahead unchanged when no recorded index keys the column", () => {
    expect(lifted([widen("tag")], snapshot([]))).toEqual([widen("tag")]);
  });

  it("is refused where the snapshot recorded no indexes, which cannot rule one out", () => {
    expect(lifted([widen("tag")], snapshot(undefined))).toContain(
      "cannot be read"
    );
  });

  it("is refused under a unique index, which a prefix would not keep whole, naming it", () => {
    const unique: IndexSpec = { ...TAG_INDEX, unique: true };
    const refused = lifted([widen("tag")], snapshot([unique]));
    expect(refused).toContain("the unique index idx_single_about_tag");
    expect(refused).toContain("Unique setting off");
  });

  it("lifts nothing when the same run drops the index", () => {
    const drop = dropIndex(TAG_INDEX);
    expect(lifted([drop, widen("tag")], snapshot([TAG_INDEX]))).toEqual([
      drop,
      widen("tag"),
    ]);
  });

  it("drops the index of a column renamed in the same run by its recorded name, and makes it again on the new one", () => {
    const rename = {
      type: "rename_column",
      tableName: "single_about",
      fromColumn: "tag",
      toColumn: "label",
      fromType: "varchar(255)",
      toType: "varchar(255)",
    } as Operation;
    expect(lifted([rename, widen("label")], snapshot([TAG_INDEX]))).toEqual([
      dropIndex(TAG_INDEX),
      rename,
      widen("label"),
      addIndex({ ...TAG_INDEX, columns: ["label"] }),
    ]);
  });

  it("lifts the index around a rename that widens the column itself", () => {
    const renameAndWiden = {
      type: "rename_column",
      tableName: "single_about",
      fromColumn: "tag",
      toColumn: "label",
      fromType: "varchar(255)",
      toType: "text",
    } as Operation;
    expect(lifted([renameAndWiden], snapshot([TAG_INDEX]))).toEqual([
      dropIndex(TAG_INDEX),
      renameAndWiden,
      addIndex({ ...TAG_INDEX, columns: ["label"] }),
    ]);
  });

  it("changes nothing on another dialect", () => {
    expect(
      withIndexesLiftedForTextWidenings({
        operations: [widen("tag")],
        previous: snapshot(undefined),
        dialect: "postgresql",
      })
    ).toEqual([widen("tag")]);
  });
});
