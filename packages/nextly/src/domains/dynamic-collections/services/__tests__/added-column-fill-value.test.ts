/**
 * The value a Required column added over rows fills them with, from its stated default, in the
 * form the apply binds it and the pre-cleanup check judges it.
 *
 * A stated date is written in whatever form an author typed: a calendar date, an offset time.
 * The migration file writes it as the database reads it; the bound value has to reach the same
 * column as a date, and pass the check that refuses a value not of the field's type.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import {
  clearFieldTypes,
  registerFieldType,
} from "../../../schema/field-types/field-type-registry";
import { validateDefaultValue } from "../../../schema/pipeline/pre-cleanup/validate-default";
import {
  DynamicCollectionSchemaService,
  type SupportedDialect,
} from "../dynamic-collection-schema-service";

const NOW = new Date("2026-11-02T00:00:00.000Z");

const dated = (stated: string) =>
  ({
    name: "launchedOn",
    type: "date",
    required: true,
    default: stated,
  }) as unknown as FieldDefinition;

const fill = (dialect: SupportedDialect, stated: string) =>
  new DynamicCollectionSchemaService(undefined, dialect).addedColumnFillValue(
    dated(stated),
    NOW
  );

describe("a Required date field's stated default, as the rows are filled with it", () => {
  for (const stated of [
    "2026-01-02",
    "2026-01-02T03:04:05+05:00",
    "2026-01-02T03:04:05.000Z",
  ]) {
    for (const dialect of ["postgresql", "mysql"] as const) {
      it(`is the moment it names on ${dialect}, and passes the check, for "${stated}"`, () => {
        const value = fill(dialect, stated);
        expect(value).toBeInstanceOf(Date);
        expect((value as Date).getTime()).toBe(Date.parse(stated));
        expect(
          validateDefaultValue(
            { name: "launched_on", type: "date" },
            value,
            dialect
          ).success
        ).toBe(true);
      });
    }

    it(`is its epoch seconds on sqlite, and passes the check, for "${stated}"`, () => {
      const value = fill("sqlite", stated);
      expect(value).toBe(Math.floor(Date.parse(stated) / 1000));
      expect(
        validateDefaultValue(
          { name: "launched_on", type: "date" },
          value,
          "sqlite"
        ).success
      ).toBe(true);
    });
  }
});

describe("a Required plugin field stored as a timestamp, as the rows are filled with its stated default", () => {
  // A contributed type is named by its own token; what it stores decides how its value is bound.
  beforeEach(() => {
    registerFieldType({
      type: "launch-moment",
      storage: "timestamp",
      component: "@acme/launch/admin#Input",
    });
  });
  afterEach(() => clearFieldTypes());

  const stated = "2026-01-02T03:04:05.000Z";
  const plugin = {
    name: "launchedOn",
    type: "launch-moment",
    required: true,
    default: stated,
  } as unknown as FieldDefinition;

  it("is its epoch seconds on sqlite, as a date field's is, not the text it was typed as", () => {
    const value = new DynamicCollectionSchemaService(
      undefined,
      "sqlite"
    ).addedColumnFillValue(plugin, NOW);
    expect(value).toBe(Math.floor(Date.parse(stated) / 1000));
  });

  it("is the moment it names on postgresql and mysql", () => {
    for (const dialect of ["postgresql", "mysql"] as const) {
      const value = new DynamicCollectionSchemaService(
        undefined,
        dialect
      ).addedColumnFillValue(plugin, NOW);
      expect(value).toBeInstanceOf(Date);
      expect((value as Date).getTime()).toBe(Date.parse(stated));
    }
  });
});
