import { describe, expect, it } from "vitest";

import { convertToFieldDefinition, toSnakeName } from "./field-transformers";

/**
 * The rule an auto-derived Name follows when a Label carries punctuation.
 *
 * A field Name is a database column name and an API response key, so it may
 * carry only `a-z`, `0-9` and `_`. The derivation once translated the Label
 * character-by-character — every space, period, apostrophe or colon became
 * its own underscore — so "phone no." named the column "phone_no_" and a
 * punctuation-only label produced a name of pure underscores. The rule the
 * builder already applies everywhere else (`startingFieldName`,
 * `toKebabName`) is the one followed here: a RUN of anything that is not a
 * letter or a digit collapses to one underscore, and nothing dangles at
 * either end.
 *
 * @module lib/builder/to-snake-name.test
 */
describe("toSnakeName", () => {
  it("drops trailing punctuation rather than leaving a dangling underscore", () => {
    expect(toSnakeName("phone no.")).toBe("phone_no");
  });

  it("collapses a run of special characters into a single underscore", () => {
    expect(toSnakeName("Author's: Note;")).toBe("author_s_note");
  });

  it("trims separator runs at the start as well", () => {
    expect(toSnakeName("*Main Title*")).toBe("main_title");
  });

  it("leaves already-clean names untouched (the save path re-derives them)", () => {
    expect(toSnakeName("already_snake_name")).toBe("already_snake_name");
    expect(toSnakeName("line_2_address")).toBe("line_2_address");
  });

  it("reduces a punctuation-only label to nothing, not a row of underscores", () => {
    expect(toSnakeName("?!")).toBe("");
  });
});

describe("the save path (convertToFieldDefinition)", () => {
  /**
   * A stored name is not a label: it is the field's identity. Re-deriving it
   * would collapse `line__item` to `line_item`, trim `legacy_` to `legacy`, or
   * turn a plugin's camelCase `metaTitle` into `meta_title` during an
   * unrelated save, silently renaming a database column and API key. The
   * derivation is for labels; every name is sent as it is, and a name the
   * save refuses is refused there, naming the field.
   */
  const base = {
    id: "f-1",
    label: "Line Item",
    type: "text",
    validation: {},
  } as const;

  it("keeps a legal stored name verbatim during an unrelated save", () => {
    expect(convertToFieldDefinition({ ...base, name: "line__item" }).name).toBe(
      "line__item"
    );
    expect(convertToFieldDefinition({ ...base, name: "legacy_" }).name).toBe(
      "legacy_"
    );
  });

  it("keeps a camelCase name a plugin declared verbatim", () => {
    expect(convertToFieldDefinition({ ...base, name: "metaTitle" }).name).toBe(
      "metaTitle"
    );
  });

  it("sends a name the save refuses as it is, for the save to refuse naming the field", () => {
    // Renamed here, it would reach the save as a field nobody named.
    expect(convertToFieldDefinition({ ...base, name: "My Field!" }).name).toBe(
      "My Field!"
    );
  });

  it("stops serializing localized on a field-group reference", () => {
    // A component reference produces no column, so its localized flag is
    // unbacked metadata — a value saved by the pre-gate editor must not
    // keep riding every save now that the switch no longer offers it.
    // Both stored spellings are fed, in either spelling the guard must
    // refuse.
    for (const type of ["component", "fieldGroup"] as const) {
      const result = convertToFieldDefinition({
        ...base,
        name: "seo_block",
        type,
        advanced: { localized: true },
      });
      expect(result.localized).toBeUndefined();
    }
  });
});
