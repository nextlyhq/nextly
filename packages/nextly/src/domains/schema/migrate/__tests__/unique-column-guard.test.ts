// The refusal a column made unique over repeated values gets: each column with its first values
// and how many more there are, and every value in the log.
import { describe, expect, it } from "vitest";

import {
  LISTED_REPEATS,
  uniqueColumnRepeatsError,
  uniqueIndexCheckpoint,
  type RepeatedValue,
} from "../unique-column-guard";

const column = (repeats: RepeatedValue[]) => ({
  entity: { kind: "collection" as const, slug: "profiles" },
  field: "person",
  table: "dc_profiles",
  column: "person",
  repeats,
  showValues: true,
});

describe("uniqueColumnRepeatsError", () => {
  it(`lists the first ${LISTED_REPEATS} values, counts the rest, and logs every one`, () => {
    const repeats = Array.from({ length: LISTED_REPEATS + 2 }, (_, at) => ({
      value: `p${String(at).padStart(2, "0")}`,
      entries: 2,
    }));

    const error = uniqueColumnRepeatsError([column(repeats)], "the run");

    const listed = repeats
      .slice(0, LISTED_REPEATS)
      .map(r => `"${r.value}" (2 entries)`)
      .join(", ");
    expect(error.publicMessage).toBe(
      `the run was not applied. Collection 'profiles': field 'person' cannot become unique while ${LISTED_REPEATS + 2} values repeat: ${listed}, and 2 more (the full list is in the log). Give each entry its own value, or clear the repeats, then run \`nextly migrate\` again.`
    );
    expect(error.publicMessage).not.toContain(`"p${LISTED_REPEATS}"`);
    expect(error.logContext).toMatchObject({
      reason: "unique-column-over-repeats",
      columns: [{ field: "person", repeats }],
    });
  });

  it(`lists exactly ${LISTED_REPEATS} values with no count of more`, () => {
    const repeats = Array.from({ length: LISTED_REPEATS }, (_, at) => ({
      value: `p${at}`,
      entries: 3,
    }));

    const error = uniqueColumnRepeatsError([column(repeats)], "the run");

    expect(error.publicMessage).not.toContain("more (the full list");
    expect(error.publicMessage).toContain(`"p${LISTED_REPEATS - 1}"`);
  });

  it("names a translated value's language", () => {
    const error = uniqueColumnRepeatsError(
      [column([{ value: "ada", entries: 2, language: "en" }])],
      "the run"
    );

    expect(error.publicMessage).toContain(`"ada" (2 entries in "en")`);
  });
});

// Which unique indexes a file's runner judges at their own statement: each one not judged with
// certainty before the file runs.
describe("uniqueIndexCheckpoint", () => {
  const unit = { source: "0001_unique.sql", transaction: false };
  const index = "CREATE UNIQUE INDEX `uq` ON `dc_profiles` (`person`)";
  const judgedAtStatement = (statements: string[]) =>
    uniqueIndexCheckpoint(statements, "mysql", unit) !== undefined;

  it("leaves to the check before the file a unique index read whole over a column it already has", () => {
    expect(judgedAtStatement([index])).toBe(false);
    expect(
      judgedAtStatement([
        "ALTER TABLE `dc_profiles` RENAME COLUMN `owner` TO `person`",
        index,
      ])
    ).toBe(false);
  });

  it("judges at its statement a unique index with an option after its key list", () => {
    expect(
      judgedAtStatement([
        "CREATE UNIQUE INDEX `uq` ON `dc_profiles` (`person`) USING BTREE",
      ])
    ).toBe(true);
  });

  it("judges at its statement a unique index on a qualified table", () => {
    expect(
      judgedAtStatement([
        "CREATE UNIQUE INDEX `uq` ON `app`.`dc_profiles` (`person`)",
      ])
    ).toBe(true);
  });

  it("judges at its statement a unique index after renames that swap two columns", () => {
    expect(
      judgedAtStatement([
        "ALTER TABLE `dc_profiles` RENAME COLUMN `person` TO `partner`, RENAME COLUMN `partner` TO `person`",
        index,
      ])
    ).toBe(true);
    expect(
      judgedAtStatement([
        "ALTER TABLE `dc_profiles` RENAME COLUMN `person` TO `spare`",
        "ALTER TABLE `dc_profiles` RENAME COLUMN `partner` TO `person`",
        "ALTER TABLE `dc_profiles` RENAME COLUMN `spare` TO `partner`",
        index,
      ])
    ).toBe(true);
  });

  it("judges at its statement a unique index over a column the file adds", () => {
    expect(
      judgedAtStatement([
        "ALTER TABLE `dc_profiles` ADD COLUMN `person` varchar(36)",
        index,
      ])
    ).toBe(true);
    expect(
      judgedAtStatement([
        "ALTER TABLE `dc_profiles` ADD COLUMN `person` varchar(36) DEFAULT 'ada'",
        index,
      ])
    ).toBe(true);
  });
});
