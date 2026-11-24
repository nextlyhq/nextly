/**
 * What the Schema Builder's type picker is told about a saved field of an entity stored per language:
 * a change a translation rule of the save refuses whatever the field's values hold is blocked too,
 * with the save's own words.
 */
import { describe, expect, it } from "vitest";

import { TRANSLATIONS_COLUMN_KEEPS_ITS_TYPE } from "../../../domains/schema/value-conversion/type-change/field-type-changes";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import {
  typeChangeTargets,
  type TranslationLayout,
} from "../type-change-targets";

/** A collection's save retypes a translations column in its file; a Single's and a field group's do not. */
const COLLECTION: TranslationLayout = { perLanguage: true, fileRetypes: true };
const SINGLE: TranslationLayout = { perLanguage: true, fileRetypes: false };

describe.each(["postgresql", "mysql", "sqlite"] as const)(
  "the type picker on an entity stored per language (%s)",
  dialect => {
    const targetOf = (
      field: Partial<FieldDefinition>,
      type: string,
      layout: TranslationLayout = COLLECTION,
      inJson = false,
      hasMany?: boolean
    ) =>
      typeChangeTargets({
        field: { name: "f", ...field } as FieldDefinition,
        candidates: [{ type, ...(hasMany === undefined ? {} : { hasMany }) }],
        dialect,
        builtBy: "collection",
        layout,
        inJson,
      })[0];

    it("a translated text becoming a number leaves translation reshaped: unavailable, in the save's words", () => {
      const target = targetOf({ type: "text" }, "number");
      expect(target).toMatchObject({
        blocked: "leaves-translation",
        outcome: null,
        refusal: { code: "RESHAPED_FIELD_LEAVES_TRANSLATION" },
      });
      expect(target?.refusal?.reason).not.toBe("");
      expect(target?.refusal?.steps.length).toBeGreaterThan(0);
    });

    it("a shared number becoming a text joins translation as another kind of value: unavailable, in the save's words", () => {
      expect(targetOf({ type: "number" }, "text")).toMatchObject({
        blocked: "joins-translation",
        outcome: null,
        refusal: { code: "RESHAPED_FIELD_JOINS_TRANSLATION" },
      });
    });

    // Controls: the same change where no translation rule applies is judged by its values alone.
    it("a shared text, a field inside a group's JSON, or the earlier layout: no translation rule asked", () => {
      const open = { blocked: null, refusal: null, outcome: "may-lose" };
      expect(targetOf({ type: "text", localized: false }, "number")).toEqual({
        type: "number",
        ...open,
      });
      expect(
        targetOf({ type: "text" }, "number", COLLECTION, true)
      ).toMatchObject(open);
      expect(
        targetOf({ type: "text" }, "number", {
          perLanguage: false,
          fileRetypes: true,
        })
      ).toMatchObject(open);
    });

    it("a translated text becoming a long text, or a long text becoming code, keeps its translations column: open", () => {
      for (const [from, to] of [
        ["text", "textarea"],
        ["textarea", "code"],
      ] as const) {
        expect(targetOf({ type: from }, to, SINGLE), to).toMatchObject({
          blocked: null,
          refusal: null,
        });
      }
    });

    it("a Single's field kept per language becoming a number retypes its translations column, which its save does not: unavailable", () => {
      expect(
        targetOf({ type: "text", localized: true }, "number", SINGLE)
      ).toEqual({
        type: "number",
        blocked: "translations-column",
        refusal: {
          code: "TYPE_CHANGE_BLOCKED",
          reason: TRANSLATIONS_COLUMN_KEEPS_ITS_TYPE,
          steps: [],
        },
        outcome: null,
      });
    });

    // A collection's save file retypes the column where it changes on this database: a checkbox's
    // integer on SQLite is a number's column too, so there the file changes nothing and the column
    // PostgreSQL and MySQL make would keep the old type.
    it("a collection's translated checkbox becoming a number: unavailable on SQLite only", () => {
      const target = targetOf(
        { type: "checkbox", localized: true },
        "number",
        COLLECTION
      );
      expect(target?.blocked).toBe(
        dialect === "sqlite" ? "translations-column" : null
      );
    });
  }
);
