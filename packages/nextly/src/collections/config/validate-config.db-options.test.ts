/**
 * A collection's `db` options are checked where they are written.
 *
 * The write path reads them leniently: an `idType` it does not know generates
 * UUIDv4 ids, and an `allowIdOnCreate` that is not `true` discards the id a
 * caller supplies. So a value outside the offered set has to be refused when
 * the config is defined, or it is ignored in silence. `serial`, which a config
 * carried over from Payload holds, is refused with the alternative named.
 */
import { describe, expect, it } from "vitest";

import { text } from "../fields/helpers";

import { defineCollection, type CollectionConfig } from "./define-collection";
import { validateCollectionConfig } from "./validate-config";

function errorsFor(db: unknown) {
  return validateCollectionConfig({
    slug: "orders",
    fields: [text({ name: "reference" })],
    db,
  } as CollectionConfig).errors;
}

describe("validateCollectionConfig: db options", () => {
  it("accepts each offered id type, the id option, and no db options at all", () => {
    expect(errorsFor(undefined)).toEqual([]);
    expect(errorsFor({ idType: "uuid" })).toEqual([]);
    expect(errorsFor({ idType: "uuidv7", allowIdOnCreate: true })).toEqual([]);
    expect(errorsFor({ allowIdOnCreate: false })).toEqual([]);
  });

  it("refuses serial, naming the table keyed by col.serial() as the way to a sequential number", () => {
    const errors = errorsFor({ idType: "serial" });
    expect(errors).toEqual([
      expect.objectContaining({
        path: "db.idType",
        code: "DB_ID_TYPE_INVALID",
      }),
    ]);
    expect(errors[0]?.message).toContain('"serial" is not offered');
    expect(errors[0]?.message).toContain("col.serial()");
  });

  it("refuses any other id type, naming the value and the choices", () => {
    const errors = errorsFor({ idType: "uuid7" });
    expect(errors).toEqual([
      expect.objectContaining({
        path: "db.idType",
        code: "DB_ID_TYPE_INVALID",
      }),
    ]);
    expect(errors[0]?.message).toContain('"uuid7"');
    expect(errors[0]?.message).toContain('"uuid" or "uuidv7"');
    // A value that is not a string is named by its kind, a bigint included.
    expect(errorsFor({ idType: 7n })[0]?.message).toContain("got a bigint");
  });

  it("refuses an allowIdOnCreate that is not a boolean", () => {
    expect(errorsFor({ allowIdOnCreate: "true" })).toEqual([
      expect.objectContaining({
        path: "db.allowIdOnCreate",
        code: "DB_ALLOW_ID_ON_CREATE_INVALID",
      }),
    ]);
  });

  it("refuses a name that is not an option, a misspelling included", () => {
    // The write path reads `idType` and `allowIdOnCreate` alone, so either
    // name misspelt would leave the option at its default in silence.
    expect(errorsFor({ idTyp: "uuidv7", allowIDOnCreate: true })).toEqual([
      expect.objectContaining({
        path: "db.idTyp",
        code: "DB_OPTION_UNKNOWN",
        message: expect.stringContaining('"idType", "allowIdOnCreate"'),
      }),
      expect.objectContaining({
        path: "db.allowIDOnCreate",
        code: "DB_OPTION_UNKNOWN",
      }),
    ]);
  });

  it("refuses db options that are not an object", () => {
    expect(errorsFor("uuidv7")).toEqual([
      expect.objectContaining({ path: "db", code: "DB_OPTIONS_INVALID_TYPE" }),
    ]);
  });

  it("stops defineCollection, the entry every code-first collection goes through", () => {
    expect(() =>
      defineCollection({
        slug: "orders",
        fields: [text({ name: "reference" })],
        db: { idType: "serial" } as unknown as CollectionConfig["db"],
      })
    ).toThrow(/DB_ID_TYPE_INVALID/);
  });
});
