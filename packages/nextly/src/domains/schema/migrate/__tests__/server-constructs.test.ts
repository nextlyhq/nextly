// What a migration unit adds that the connected server cannot hold.
//
// Two readings, each with its own trap: the snapshot reading must count only
// what is ADDED, and on another owner's table only the stream's own elements;
// the statement reading must find a CHECK or an expression key part in the SQL
// that would run, and nothing that merely looks like one in a string, a
// comment, a DROP or an ordinary prefix-length key.

import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import type { TableSpec } from "../../pipeline/diff/types";
import {
  constructsAdded,
  refuseStatementsTheServerCannotHold,
} from "../server-constructs";

const table = (
  name: string,
  checks: string[],
  indexes: Array<{ name: string; expression?: string }> = []
): TableSpec => ({
  name,
  columns: [{ name: "id", type: "varchar(36)", nullable: false }],
  checks: checks.map(check => ({ name: check, sql: "id <> ''" })),
  indexes: indexes.map(index => ({ ...index, columns: [], unique: false })),
});

describe("constructsAdded", () => {
  it("counts only the checks and indexes the target adds over the snapshot before it", () => {
    const added = constructsAdded(
      [table("t", ["ck_old"], [{ name: "ix_old", expression: "lower(id)" }])],
      [
        table(
          "t",
          ["ck_old", "ck_new"],
          [
            { name: "ix_old", expression: "lower(id)" },
            { name: "ix_new", expression: "upper(id)" },
          ]
        ),
      ]
    );
    expect(added).toEqual([
      expect.objectContaining({
        name: "t",
        checks: [expect.objectContaining({ name: "ck_new" })],
        indexes: [expect.objectContaining({ name: "ix_new" })],
      }),
    ]);
  });

  it("on another owner's table keeps only what the stream contributed", () => {
    // The stream's copy of the owner's table carries the owner's check, new
    // to this copy because the owner added it since; it is not the stream's.
    const added = constructsAdded(
      [table("dep__items", [])],
      [table("dep__items", ["ck_owners", "ck_mine"])],
      {
        dep__items: {
          columns: [],
          indexes: [],
          foreignKeys: [],
          checks: ["ck_mine"],
        },
      }
    );
    expect(added[0]?.checks?.map(check => check.name)).toEqual(["ck_mine"]);
  });
});

const unenforcing = {
  enforcesCheckConstraints: false,
  functionalIndexes: false,
  serverVersion: "8.0.12",
};

const refusal = (statement: string) => () =>
  refuseStatementsTheServerCannotHold(
    [statement],
    "mysql",
    unenforcing,
    "0001_x.sql"
  );

/** What a refusal says, read from its detail rather than the generic public message. */
function refusalText(run: () => void): string {
  try {
    run();
  } catch (error) {
    expect(NextlyError.isValidation(error)).toBe(true);
    return JSON.stringify((error as NextlyError).publicData);
  }
  return "";
}

describe("refuseStatementsTheServerCannotHold", () => {
  it("refuses a statement that adds a CHECK, naming the file and the version", () => {
    expect(
      refusalText(
        refusal("ALTER TABLE `t` ADD CONSTRAINT `ck` CHECK (`n` >= 0)")
      )
    ).toMatch(/0001_x\.sql\\" adds a CHECK.*8\.0\.12/);
    expect(
      refusalText(refusal("CREATE TABLE `t` (`n` int CHECK (`n` > 0))"))
    ).toContain("adds a CHECK");
  });

  it("refuses an index whose key part is an expression, in each place one is written", () => {
    for (const statement of [
      "CREATE INDEX `ix` ON `t` ((lower(`email`)))",
      "ALTER TABLE `t` ADD INDEX `ix` (`a`, (lower(`b`)))",
      "CREATE TABLE `t` (`a` text, KEY `ix` ((lower(`a`))))",
    ]) {
      expect(refusalText(refusal(statement)), statement).toContain(
        "index on an expression"
      );
    }
  });

  it("leaves what only looks like one alone", () => {
    for (const statement of [
      "ALTER TABLE `t` DROP CHECK `ck`",
      "INSERT INTO `t` (`note`) VALUES ('CHECK (x)')",
      "-- CHECK (x)\nALTER TABLE `t` ADD `n` int",
      "CREATE INDEX `ix` ON `t` (`name`(10))",
      "ALTER TABLE `t` ADD PRIMARY KEY (`id`)",
      "ALTER TABLE `t` ADD CONSTRAINT `fk` FOREIGN KEY (`a`) REFERENCES `p` (`id`)",
      "INSERT INTO `t` (`a`) VALUES (1) ON DUPLICATE KEY UPDATE `a` = (`a` + 1)",
      "DROP INDEX `ix` ON `t`",
    ]) {
      expect(refusal(statement), statement).not.toThrow();
    }
  });

  it("judges nothing on a server that holds both", () => {
    expect(() =>
      refuseStatementsTheServerCannotHold(
        ["ALTER TABLE `t` ADD CHECK (`n` > 0)"],
        "mysql",
        { enforcesCheckConstraints: true, functionalIndexes: true },
        "0001_x.sql"
      )
    ).not.toThrow();
  });
});
