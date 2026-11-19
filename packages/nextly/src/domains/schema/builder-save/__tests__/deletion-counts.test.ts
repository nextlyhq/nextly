/**
 * Which fields a save that removes fields compares with the counts confirmed (`deletionHoldOf`),
 * and where it counts them: the fields whose columns go, and the table their values are in.
 *
 * Counted through a stand-in for SQLite's handle that answers every count with the same number, so
 * what is asserted is which fields are compared and which table each is read from, not the count.
 *
 * What separates the right set from plausible wrong ones:
 * - one read off the top-level fields alone misses a field inside a group with no name, whose
 *   column is the row's own and goes with it;
 * - one that ignores the save's renames compares a renamed field, whose values the save keeps, and
 *   refuses the save when it holds any;
 * - one that places a translatable field by the entity's own setting alone reads the main table
 *   under per-language storage, where the values are in the translations table;
 * - one that quotes names by a narrower grammar than the naming rules refuses to count a table
 *   named with a hyphen, and so refuses every such save.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import {
  _resetPerLanguageStorage,
  setPerLanguageStorage,
} from "../../../i18n/per-language-storage";
import { deletionHoldOf } from "../deletion-counts";

afterEach(() => {
  _resetPerLanguageStorage();
});

/** SQLite's handle, answering every count with `count`. */
const countingSqlite = (count: number) => ({
  all: () => [{ count }],
});

const text = (name: string): FieldDefinition =>
  ({ name, type: "text" }) as FieldDefinition;

/** A group with no name: it only lays its fields out, which are stored on the row. */
const layout = (fields: FieldDefinition[]): FieldDefinition =>
  ({ type: "group", fields }) as unknown as FieldDefinition;

/** The fields a refusal names, as `fields.<name>`. */
async function refusedFields(compare: Promise<void>): Promise<string[]> {
  try {
    await compare;
    return [];
  } catch (error) {
    const errors = (
      error as { publicData?: { errors?: Array<{ path: string }> } }
    ).publicData?.errors;
    return (errors ?? []).map(entry => entry.path);
  }
}

describe("the fields a save that removes fields compares", () => {
  it("compares a field removed from a group with no name", async () => {
    const hold = deletionHoldOf({
      dialect: "sqlite",
      tableName: "dc_notes",
      localized: false,
      previous: [text("label"), layout([text("note")])],
      next: [text("label"), layout([])],
      confirmed: [],
    });

    expect(hold).toBeDefined();
    expect(await refusedFields(hold!.compare(countingSqlite(2)))).toEqual([
      "fields.note",
    ]);
  });

  it("leaves out a field the save renames, whose values it keeps", () => {
    const hold = deletionHoldOf({
      dialect: "sqlite",
      tableName: "dc_notes",
      localized: false,
      previous: [text("label"), text("note")],
      next: [text("label"), text("memo")],
      renamed: [{ from: "note", to: "memo" }],
      confirmed: [],
    });

    expect(hold).toBeUndefined();
  });

  it("counts a translatable field in the translations table under per-language storage", () => {
    setPerLanguageStorage(true);
    const hold = deletionHoldOf({
      dialect: "sqlite",
      tableName: "dc_notes",
      // The entity is not translated: under per-language storage its translatable values are
      // in the translations table all the same.
      localized: false,
      previous: [text("label"), text("note")],
      next: [text("label")],
      confirmed: [],
    });

    expect(hold?.tables).toEqual(["dc_notes_locales"]);
  });

  it("counts a field of a table named with a hyphen, and deletes when the count matches", async () => {
    const hold = deletionHoldOf({
      dialect: "sqlite",
      tableName: "dc_my-notes",
      localized: false,
      previous: [text("label"), text("note")],
      next: [text("label")],
      confirmed: [{ field: "note", count: 5 }],
    });

    await expect(hold!.compare(countingSqlite(5))).resolves.toBeUndefined();
  });
});
