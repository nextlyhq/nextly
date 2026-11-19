/**
 * The judgement of what a stopped Builder save applied, apart from any database: the changes a
 * save asks of its fields, the field list with only some of them laid over, which changes a table
 * holds, and how the stop and a failed settle are told.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import type { ColumnSpec, TableSpec } from "../../pipeline/diff/types";
import {
  appliedFieldsOf,
  askedChanges,
  fieldsWith,
  judgeStoppedSave,
  standsAs,
  stoppedSaveError,
  withSettleFailure,
  type AskedChange,
} from "../stopped-save";

const text = (name: string) => ({ name, type: "text" });
const column = (name: string, type = "text", nullable = true): ColumnSpec => ({
  name,
  type,
  nullable,
});
const table = (...columns: ColumnSpec[]): TableSpec => ({
  name: "dc_posts",
  columns,
});

describe("askedChanges", () => {
  it("names each field's change: added, dropped, renamed, retyped, or its settings", () => {
    expect(
      askedChanges<{ name: string; type: string; required?: boolean }>(
        [
          text("kept"),
          text("gone"),
          text("old"),
          text("typed"),
          { ...text("set"), required: false },
        ],
        [
          text("kept"),
          text("new"),
          text("added"),
          { name: "typed", type: "number" },
          { ...text("set"), required: true },
        ],
        [{ from: "old", to: "new" }]
      )
    ).toEqual([
      { field: "added", change: "add" },
      { field: "gone", change: "drop" },
      { field: "new", change: "rename", from: "old" },
      { field: "set", change: "settings" },
      { field: "typed", change: "retype" },
    ]);
  });

  it("takes a rename whose names the lists do not hold as the addition and drop they are", () => {
    expect(
      askedChanges([text("a")], [text("b")], [{ from: "x", to: "b" }])
    ).toEqual([
      { field: "a", change: "drop" },
      { field: "b", change: "add" },
    ]);
  });
});

describe("fieldsWith", () => {
  const previous = [text("heading"), text("old"), text("gone")];
  const next = [
    text("heading"),
    text("new"),
    { name: "added", type: "number" },
  ];
  const asked: AskedChange[] = [
    { field: "added", change: "add" },
    { field: "gone", change: "drop" },
    { field: "new", change: "rename", from: "old" },
  ];

  it("keeps a field as it was where its change did not apply, and leaves out an addition that did not", () => {
    expect(fieldsWith(previous, next, asked, () => false)).toEqual(previous);
  });

  it("lays over exactly the changes that applied", () => {
    expect(
      fieldsWith(previous, next, asked, c => c.field !== "gone").map(
        f => f.name
      )
    ).toEqual(["heading", "new", "added", "gone"]);
    expect(
      appliedFieldsOf(previous, next, [
        { field: "added", change: "add", applied: false },
        { field: "gone", change: "drop", applied: true },
        { field: "new", change: "rename", from: "old", applied: true },
      ]).map(f => f.name)
    ).toEqual(["heading", "new"]);
  });
});

describe("judgeStoppedSave", () => {
  const before = table(column("heading"));
  const asked: AskedChange[] = [
    { field: "alpha", change: "add" },
    { field: "beta", change: "add" },
  ];
  const withEach = new Map([
    ["alpha", table(column("heading"), column("alpha"))],
    ["beta", table(column("heading"), column("beta"))],
  ]);

  it("names a change applied where its parts stand as it makes them, and not where they stand as before", () => {
    expect(
      judgeStoppedSave({
        asked,
        live: table(column("heading"), column("alpha")),
        before,
        withEach,
      })
    ).toEqual([
      { field: "alpha", change: "add", applied: true },
      { field: "beta", change: "add", applied: false },
    ]);
  });

  it("judges nothing where a part stands as neither", () => {
    expect(
      judgeStoppedSave({
        asked,
        live: table(column("heading"), column("alpha", "integer")),
        before,
        withEach,
      })
    ).toBeUndefined();
  });

  it("judges nothing where two changes reach one part", () => {
    expect(
      judgeStoppedSave({
        asked: [
          { field: "alpha", change: "add" },
          { field: "other", change: "settings" },
        ],
        live: table(column("heading"), column("alpha")),
        before,
        withEach: new Map([
          ["alpha", table(column("heading"), column("alpha"))],
          ["other", table(column("heading"), column("alpha", "integer"))],
        ]),
      })
    ).toBeUndefined();
  });

  it("names a change making no part of the table applied", () => {
    expect(
      judgeStoppedSave({
        asked: [{ field: "heading", change: "settings" }],
        live: before,
        before,
        withEach: new Map([["heading", before]]),
      })
    ).toEqual([{ field: "heading", change: "settings", applied: true }]);
  });
});

describe("standsAs", () => {
  it("holds only where the whole table stands as declared", () => {
    expect(standsAs(table(column("a")), table(column("a")))).toBe(true);
    expect(standsAs(table(column("a")), table(column("a"), column("b")))).toBe(
      false
    );
    expect(standsAs(undefined, table(column("a")))).toBe(false);
  });
});

describe("how a stop is told", () => {
  it("reports each change by field, applied or not, with no statement in its words", () => {
    const failure = new Error("injected: ALTER TABLE `dc_posts` ADD `beta`");
    const error = stoppedSaveError(
      "posts",
      [
        { field: "alpha", change: "add", applied: true },
        { field: "beta", change: "add", applied: false },
        { field: "title", change: "rename", from: "name", applied: true },
      ],
      failure
    );
    expect(error.publicMessage).toBe(
      'The save of "posts" stopped part way, and keeps what applied. Applied: alpha (added), name renamed to title. Not applied: beta (added). Save again to finish the rest.'
    );
    expect(error.publicData).toEqual({
      changes: [
        { field: "alpha", change: "add", applied: true },
        { field: "beta", change: "add", applied: false },
        { field: "title", change: "rename", from: "name", applied: true },
      ],
    });
    expect(error.publicMessage).not.toMatch(/ALTER|dc_posts/);
  });

  it("tells a failed settle after the stop's own failure, never in its place", () => {
    const stop = new NextlyError({
      code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
      publicMessage: "The file failed part-way.",
    });
    const told = withSettleFailure(
      stop,
      new NextlyError({
        code: "NEXTLY_MIGRATION_CONCURRENT_RUN",
        publicMessage: "Another run recorded the file first.",
      })
    );
    expect(told.code).toBe("NEXTLY_MIGRATION_PARTIALLY_APPLIED");
    expect(told.publicMessage).toBe(
      "The file failed part-way. Recording what of it applied failed too, so the save stays recorded as in progress, to be settled again: Another run recorded the file first."
    );
    // A driver's text stays in the log.
    expect(
      withSettleFailure(stop, new Error("ER_LOCK_DEADLOCK: secret table"))
        .publicMessage
    ).toBe(
      "The file failed part-way. Recording what of it applied failed too, so the save stays recorded as in progress, to be settled again."
    );
  });
});
