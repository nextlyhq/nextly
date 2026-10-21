/**
 * Which tables a full uninstall's DOWN leaves in place (`tablesLeftInPlace`)
 * when it holds a data statement.
 *
 * On PostgreSQL an `INSERT`, `UPDATE` or `DELETE` can run DDL: through a
 * trigger on its table, or a function its expressions call. One may rename
 * the plugin's table away, so a later `DROP TABLE` of the name reaches
 * nothing and the table survives. What such a statement does to tables is
 * not in its text, so every table counts as left and the uninstall is
 * refused before anything runs. MySQL's and SQLite's triggers and functions
 * cannot run DDL, and SQLite's generated DOWNs copy rows through a rebuild,
 * so there a data statement is still followed.
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../database/schema-registry";
import { tablesLeftInPlace } from "../drop-guard";

const TABLES = ["fx__notes", "fx__tags"];

const DROPS = ["DROP TABLE fx__notes", "DROP TABLE fx__tags"];

describe("a DOWN holding a data statement on PostgreSQL", () => {
  it.each<string>([
    "DELETE FROM fx__notes WHERE id = 1",
    "UPDATE fx__tags SET name = 'x'",
    "INSERT INTO fx__tags (id) VALUES (1)",
  ])("counts every table as left: %s", data => {
    expect(tablesLeftInPlace([data, ...DROPS], "postgresql", TABLES)).toEqual(
      TABLES
    );
  });

  it("still follows a PostgreSQL DOWN of schema statements alone", () => {
    expect(tablesLeftInPlace(DROPS, "postgresql", TABLES)).toEqual([]);
  });
});

describe("a DOWN holding a data statement where triggers run no DDL", () => {
  it.each<SupportedDialect>(["sqlite", "mysql"])(
    "follows the tables through it on %s",
    dialect => {
      expect(
        tablesLeftInPlace(
          ["DELETE FROM fx__notes WHERE id = 1", ...DROPS],
          dialect,
          TABLES
        )
      ).toEqual([]);
    }
  );

  it("follows a SQLite rebuild, which copies rows with an INSERT", () => {
    expect(
      tablesLeftInPlace(
        [
          "CREATE TABLE `__new_fx__notes` (`id` integer PRIMARY KEY)",
          "INSERT INTO `__new_fx__notes` (`id`) SELECT `id` FROM `fx__notes`",
          "DROP TABLE `fx__notes`",
          "ALTER TABLE `__new_fx__notes` RENAME TO `fx__notes`",
          "DROP TABLE fx__tags",
        ],
        "sqlite",
        TABLES
      )
    ).toEqual(["fx__notes"]);
  });
});
