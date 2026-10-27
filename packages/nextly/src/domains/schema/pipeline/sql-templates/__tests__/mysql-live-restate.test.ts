/**
 * The drop guard refuses a statement built at run time, because it cannot see what it drops. The
 * runs `mysql-live-restate.ts` writes are built at run time too, so the guard reads each as the
 * plain statement it amounts to — but only a run that is exactly one of those. A hand-written
 * PREPARE, or one of these with anything changed, must stay unreadable and refused.
 */
import { describe, expect, it } from "vitest";

import {
  mysqlLiveStatements,
  plainMysqlEquivalents,
} from "../mysql-live-restate";

const rename = mysqlLiveStatements({
  type: "rename_column",
  tableName: "dc_posts",
  fromColumn: "heading",
  toColumn: "title2",
  fromType: "text",
  toType: "text",
})!;
const required = mysqlLiveStatements({
  type: "change_column_nullable",
  tableName: "dc_posts",
  columnName: "title2",
  fromNullable: true,
  toNullable: false,
})!;

describe("reading Nextly's own MySQL runs as plain statements", () => {
  it("reads each run as the statement it amounts to, and leaves the rest as written", () => {
    expect(
      plainMysqlEquivalents([
        "DROP INDEX `idx_dc_posts_heading` ON `dc_posts`",
        ...rename,
        ...required,
      ])
    ).toEqual([
      "DROP INDEX `idx_dc_posts_heading` ON `dc_posts`",
      "ALTER TABLE `dc_posts` RENAME COLUMN `heading` TO `title2`",
      "ALTER TABLE `dc_posts` MODIFY COLUMN `title2` text NOT NULL",
    ]);
  });

  it("leaves a run with anything changed as written, so the guard still refuses it", () => {
    // Each still names its table and columns where the reader looks for them, so only the
    // comparison with what the module renders tells it apart.
    const addsADrop = [
      rename[0].replace(
        "'ADD CONSTRAINT '",
        "'DROP COLUMN `slug`, ADD CONSTRAINT '"
      ),
      ...rename.slice(1),
    ];
    expect(addsADrop[0]).not.toBe(rename[0]);
    expect(plainMysqlEquivalents(addsADrop)).toEqual(addsADrop);
    const readsAnotherTable = [
      required[0].replace("TABLE_NAME = 'dc_posts'", "TABLE_NAME = 'dc_other'"),
      ...required.slice(1),
    ];
    expect(readsAnotherTable[0]).not.toBe(required[0]);
    expect(plainMysqlEquivalents(readsAnotherTable)).toEqual(readsAnotherTable);
    const cut = required.slice(0, 3);
    expect(plainMysqlEquivalents(cut)).toEqual(cut);
  });

  it("leaves a hand-written PREPARE as written", () => {
    const handWritten = [
      "SET @nextly_ddl = 'DROP TABLE `dc_posts`'",
      "PREPARE nextly_ddl FROM @nextly_ddl",
      "EXECUTE nextly_ddl",
      "DEALLOCATE PREPARE nextly_ddl",
    ];
    expect(plainMysqlEquivalents(handWritten)).toEqual(handWritten);
  });
});
