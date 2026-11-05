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
  restatedColumn,
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

  it("reads a run on a table whose name holds an apostrophe", () => {
    // The run spells the name inside SQL string literals, where the apostrophe is doubled; read
    // back as written, it would render the name doubled again and never match.
    const table = "app_o'brien";
    const renamed = mysqlLiveStatements({
      type: "rename_column",
      tableName: table,
      fromColumn: "label",
      toColumn: "caption",
      fromType: "text",
      toType: "text",
    })!;
    const nullable = mysqlLiveStatements({
      type: "change_column_nullable",
      tableName: table,
      columnName: "caption",
      fromNullable: false,
      toNullable: true,
    })!;
    expect(plainMysqlEquivalents([...renamed, ...nullable])).toEqual([
      "ALTER TABLE `app_o'brien` RENAME COLUMN `label` TO `caption`",
      "ALTER TABLE `app_o'brien` MODIFY COLUMN `caption` text NULL",
    ]);
  });

  it("writes a backslash in a name so that no SQL mode reads it as an escape, and reads the run back", () => {
    const renamed = mysqlLiveStatements({
      type: "rename_column",
      tableName: "app\\notes",
      fromColumn: "label",
      toColumn: "caption\\suffix",
      fromType: "text",
      toType: "text",
    })!;
    // A literal holding `\s` would be read as `s` by a session in MySQL's default mode.
    expect(renamed.join("\n")).not.toMatch(/'[^']*\\[^']*'/);
    expect(plainMysqlEquivalents(renamed)).toEqual([
      "ALTER TABLE `app\\notes` RENAME COLUMN `label` TO `caption\\suffix`",
    ]);
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

// The statements the existing callers build, pinned as text: the migration-file renderer
// (`sql-templates/mysql.ts`, through `mysqlLiveStatements`), the companion column widening
// (`i18n/runtime/companion-io.ts`, a type alone) and the drop guard (`ownership/drop-guard.ts`, which
// reads a run back through `plainMysqlEquivalents`). A column conversion may leave the character set
// and collation out of the restatement, and only when it asks to; none of these asks.
describe("the restatement every existing caller builds", () => {
  it("restates the character set and collation, byte for byte as before", () => {
    expect(restatedColumn("dc_posts", "title", { type: "varchar(255)" }))
      .toMatchInlineSnapshot(`
        [
          "SET @nextly_ddl = COALESCE((SELECT IF(EXTRA LIKE '%DEFAULT_GENERATED%' AND (@@SESSION.sql_mode LIKE '%NO_BACKSLASH_ESCAPES%' AND INSTR(REGEXP_REPLACE(CONVERT(COLUMN_DEFAULT USING utf8mb4) COLLATE utf8mb4_bin, CONCAT(CHAR(92 USING utf8mb4), CHAR(92 USING utf8mb4), '(.)'), '$1', 1, 0, 'n'), CHAR(92 USING utf8mb4)) > 0), 'cannot restate dc_posts.title: its default needs backslash escapes', CONCAT('ALTER TABLE \`dc_posts\` MODIFY COLUMN \`title\` ', 'varchar(255)', IF(CHARACTER_SET_NAME IS NULL, '', CONCAT(' CHARACTER SET ', CHARACTER_SET_NAME, ' COLLATE ', COLLATION_NAME)), IF(COALESCE(GENERATION_EXPRESSION, '') = '', '', CONCAT(' GENERATED ALWAYS AS (', GENERATION_EXPRESSION, ')', IF(EXTRA LIKE '%STORED GENERATED%', ' STORED', ' VIRTUAL'))), IF(IS_NULLABLE = 'YES', ' NULL', ' NOT NULL'), IF(COLUMN_DEFAULT IS NULL, '', IF(EXTRA LIKE '%DEFAULT_GENERATED%', IF(LEFT(COLUMN_DEFAULT, 17) = 'CURRENT_TIMESTAMP', CONCAT(' DEFAULT ', COLUMN_DEFAULT), CONCAT(' DEFAULT (', REGEXP_REPLACE(CONVERT(COLUMN_DEFAULT USING utf8mb4) COLLATE utf8mb4_bin, CONCAT(CHAR(92 USING utf8mb4), CHAR(92 USING utf8mb4), '(.)'), '$1', 1, 0, 'n'), ')')), CONCAT(' DEFAULT ', IF(DATA_TYPE = 'bit', COLUMN_DEFAULT, IF(@@SESSION.sql_mode LIKE '%NO_BACKSLASH_ESCAPES%', CONCAT('''', REPLACE(COLUMN_DEFAULT, '''', ''''''), ''''), QUOTE(COLUMN_DEFAULT)))))), IF(EXTRA LIKE '%auto_increment%', ' AUTO_INCREMENT', ''), IF(EXTRA LIKE '%on update %', CONCAT(' ON UPDATE ', REGEXP_SUBSTR(EXTRA, '(?<=on update )[^ ]+')), ''), IF(EXTRA LIKE '%INVISIBLE%', ' INVISIBLE', ''), IF(COLUMN_COMMENT = '', '', CONCAT(' COMMENT ', IF(@@SESSION.sql_mode LIKE '%NO_BACKSLASH_ESCAPES%', CONCAT('''', REPLACE(COLUMN_COMMENT, '''', ''''''), ''''), QUOTE(COLUMN_COMMENT)))))) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dc_posts' AND COLUMN_NAME = 'title'), 'column dc_posts.title is not in this database')",
          "PREPARE nextly_ddl FROM @nextly_ddl",
          "EXECUTE nextly_ddl",
          "DEALLOCATE PREPARE nextly_ddl",
        ]
      `);
    expect(required).toMatchInlineSnapshot(`
      [
        "SET @nextly_ddl = COALESCE((SELECT IF(EXTRA LIKE '%DEFAULT_GENERATED%' AND (@@SESSION.sql_mode LIKE '%NO_BACKSLASH_ESCAPES%' AND INSTR(REGEXP_REPLACE(CONVERT(COLUMN_DEFAULT USING utf8mb4) COLLATE utf8mb4_bin, CONCAT(CHAR(92 USING utf8mb4), CHAR(92 USING utf8mb4), '(.)'), '$1', 1, 0, 'n'), CHAR(92 USING utf8mb4)) > 0), 'cannot restate dc_posts.title2: its default needs backslash escapes', CONCAT('ALTER TABLE \`dc_posts\` MODIFY COLUMN \`title2\` ', COLUMN_TYPE, IF(CHARACTER_SET_NAME IS NULL, '', CONCAT(' CHARACTER SET ', CHARACTER_SET_NAME, ' COLLATE ', COLLATION_NAME)), IF(COALESCE(GENERATION_EXPRESSION, '') = '', '', CONCAT(' GENERATED ALWAYS AS (', GENERATION_EXPRESSION, ')', IF(EXTRA LIKE '%STORED GENERATED%', ' STORED', ' VIRTUAL'))), ' NOT NULL', IF(COLUMN_DEFAULT IS NULL, '', IF(EXTRA LIKE '%DEFAULT_GENERATED%', IF(LEFT(COLUMN_DEFAULT, 17) = 'CURRENT_TIMESTAMP', CONCAT(' DEFAULT ', COLUMN_DEFAULT), CONCAT(' DEFAULT (', REGEXP_REPLACE(CONVERT(COLUMN_DEFAULT USING utf8mb4) COLLATE utf8mb4_bin, CONCAT(CHAR(92 USING utf8mb4), CHAR(92 USING utf8mb4), '(.)'), '$1', 1, 0, 'n'), ')')), CONCAT(' DEFAULT ', IF(DATA_TYPE = 'bit', COLUMN_DEFAULT, IF(@@SESSION.sql_mode LIKE '%NO_BACKSLASH_ESCAPES%', CONCAT('''', REPLACE(COLUMN_DEFAULT, '''', ''''''), ''''), QUOTE(COLUMN_DEFAULT)))))), IF(EXTRA LIKE '%auto_increment%', ' AUTO_INCREMENT', ''), IF(EXTRA LIKE '%on update %', CONCAT(' ON UPDATE ', REGEXP_SUBSTR(EXTRA, '(?<=on update )[^ ]+')), ''), IF(EXTRA LIKE '%INVISIBLE%', ' INVISIBLE', ''), IF(COLUMN_COMMENT = '', '', CONCAT(' COMMENT ', IF(@@SESSION.sql_mode LIKE '%NO_BACKSLASH_ESCAPES%', CONCAT('''', REPLACE(COLUMN_COMMENT, '''', ''''''), ''''), QUOTE(COLUMN_COMMENT)))))) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dc_posts' AND COLUMN_NAME = 'title2'), 'column dc_posts.title2 is not in this database')",
        "PREPARE nextly_ddl FROM @nextly_ddl",
        "EXECUTE nextly_ddl",
        "DEALLOCATE PREPARE nextly_ddl",
      ]
    `);
    expect(plainMysqlEquivalents(required)).toEqual([
      "ALTER TABLE `dc_posts` MODIFY COLUMN `title2` text NOT NULL",
    ]);
  });
});

describe("a restatement that leaves out the character set and collation", () => {
  const CHARACTER_SET_PART =
    "IF(CHARACTER_SET_NAME IS NULL, '', CONCAT(' CHARACTER SET ', CHARACTER_SET_NAME, ' COLLATE ', COLLATION_NAME)), ";

  it("is the full restatement with only that part taken out, for a type that has no place for it", () => {
    const full = restatedColumn("dc_posts", "body", {
      type: "json",
      nullable: true,
    });
    const without = restatedColumn("dc_posts", "body", {
      type: "json",
      nullable: true,
      characterSet: "left-out",
    });
    expect(full[0]).toContain(CHARACTER_SET_PART);
    expect(without[0]).not.toContain("CHARACTER SET");
    expect(without).toEqual([
      full[0].replace(CHARACTER_SET_PART, ""),
      ...full.slice(1),
    ]);
  });

  it("restates them when asked to, as when the option is not given", () => {
    expect(
      restatedColumn("dc_posts", "body", {
        type: "text",
        characterSet: "restated",
      })
    ).toEqual(restatedColumn("dc_posts", "body", { type: "text" }));
  });
});
