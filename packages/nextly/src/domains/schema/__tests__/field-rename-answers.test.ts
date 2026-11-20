/**
 * A schema change's answers about a field leaving and another arriving: read at the boundary once
 * per pair, refused for a pair left unanswered on a road that takes them, and never asked for off
 * such a road. A pair whose two names are one column can't be dropped and added in one change, and
 * a rename answered for a pair the change doesn't make is refused rather than left aside.
 *
 * @module domains/schema/__tests__/field-rename-answers.test
 */
import { describe, expect, it } from "vitest";

import { toSnakeCase } from "../../../shared/lib/case-conversion";
import {
  parseFieldRenameAnswers,
  refuseUnansweredRename,
  withFieldRenameAnswers,
  type FieldRenameAnswer,
} from "../field-rename-answers";

const pair = (from: string, to: string) => ({
  from: { name: from },
  to: { name: to },
});

/** The code a refusal carries, or undefined where nothing was refused. */
async function refusedWith(
  answers: FieldRenameAnswer[] | undefined,
  from: string,
  to: string
): Promise<string | undefined> {
  const run = async () =>
    refuseUnansweredRename(
      'The collection "posts"',
      [pair(from, to)],
      field => toSnakeCase(field.name),
      { before: [from, "body"], after: [to, "copy"] }
    );
  try {
    await (answers ? withFieldRenameAnswers(answers, run) : run());
    return undefined;
  } catch (error) {
    return (error as { publicData?: { errors?: { code?: string }[] } })
      .publicData?.errors?.[0]?.code;
  }
}

describe("a pair whose fields have no column", () => {
  it("is never refused as one column, as a field group's rows go by the field's exact name", async () => {
    const run = async () =>
      refuseUnansweredRename(
        'The collection "posts"',
        [pair("fooBar", "foo_bar")],
        () => undefined,
        { before: ["fooBar"], after: ["foo_bar"] }
      );
    await expect(
      withFieldRenameAnswers(
        [{ from: "fooBar", to: "foo_bar", choice: "drop_and_add" }],
        run
      )
    ).resolves.toBeUndefined();
  });
});

describe("parseFieldRenameAnswers", () => {
  it("reads one answer per pair, and none where none was sent", () => {
    expect(parseFieldRenameAnswers(undefined)).toEqual([]);
    expect(
      parseFieldRenameAnswers([{ from: "a", to: "b", choice: "rename" }])
    ).toEqual([{ from: "a", to: "b", choice: "rename" }]);
  });

  it("refuses two answers for one pair, which would leave which applies to their order", () => {
    expect(() =>
      parseFieldRenameAnswers([
        { from: "a", to: "b", choice: "rename" },
        { from: "a", to: "b", choice: "drop_and_add" },
      ])
    ).toThrow(/Validation/i);
  });

  it("refuses a choice it doesn't know", () => {
    expect(() =>
      parseFieldRenameAnswers([{ from: "a", to: "b", choice: "guess" }])
    ).toThrow(/Validation/i);
  });
});

describe("refuseUnansweredRename", () => {
  it("refuses a pair with no answer on a road that takes answers, and passes an answered one", async () => {
    expect(await refusedWith([], "heading", "headline")).toBe(
      "FIELD_RENAME_UNANSWERED"
    );
    expect(
      await refusedWith(
        [{ from: "heading", to: "headline", choice: "rename" }],
        "heading",
        "headline"
      )
    ).toBeUndefined();
  });

  it("asks nothing off such a road, as the Builder's own saves are", async () => {
    expect(await refusedWith(undefined, "heading", "headline")).toBeUndefined();
  });

  it("refuses a rename answer for a pair the change doesn't make, and leaves a drop_and_add one aside", async () => {
    // The change pairs heading/headline; body/copy is no candidate, as when two fields are
    // replaced at once and nothing pairs.
    expect(
      await refusedWith(
        [
          { from: "heading", to: "headline", choice: "rename" },
          { from: "body", to: "copy", choice: "rename" },
        ],
        "heading",
        "headline"
      )
    ).toBe("FIELD_RENAME_NOT_OFFERED");
    expect(
      await refusedWith(
        [
          { from: "heading", to: "headline", choice: "rename" },
          { from: "body", to: "copy", choice: "drop_and_add" },
        ],
        "heading",
        "headline"
      )
    ).toBeUndefined();
  });

  it("leaves aside a rename answer naming a field the change doesn't remove or add, as a retry's does", async () => {
    expect(
      await refusedWith(
        [
          { from: "heading", to: "headline", choice: "rename" },
          { from: "summary", to: "copy", choice: "rename" },
        ],
        "heading",
        "headline"
      )
    ).toBeUndefined();
  });

  it("refuses a change renaming two pairs, as each step applies only the rename it finds", async () => {
    // A shared column's pair and a field group's, each a candidate of its own.
    const two = async (second: "rename" | "drop_and_add") =>
      withFieldRenameAnswers(
        [
          { from: "heading", to: "headline", choice: "rename" },
          { from: "hero", to: "banner", choice: second },
        ],
        async () =>
          refuseUnansweredRename(
            'The collection "posts"',
            [pair("heading", "headline"), pair("hero", "banner")],
            field => toSnakeCase(field.name),
            { before: ["heading", "hero"], after: ["headline", "banner"] }
          )
      ).then(
        () => undefined,
        (error: unknown) =>
          (error as { publicData?: { errors?: { code?: string }[] } })
            .publicData?.errors?.[0]?.code
      );
    expect(await two("rename")).toBe("FIELD_RENAME_ONE_AT_A_TIME");
    expect(await two("drop_and_add")).toBeUndefined();
  });

  it("refuses dropping and adding two names of one column, and lets them be renamed", async () => {
    expect(
      await refusedWith(
        [{ from: "fooBar", to: "foo_bar", choice: "drop_and_add" }],
        "fooBar",
        "foo_bar"
      )
    ).toBe("FIELD_RENAME_SAME_COLUMN");
    expect(
      await refusedWith(
        [{ from: "fooBar", to: "foo_bar", choice: "rename" }],
        "fooBar",
        "foo_bar"
      )
    ).toBeUndefined();
  });
});
