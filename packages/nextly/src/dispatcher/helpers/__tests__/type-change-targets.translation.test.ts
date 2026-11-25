/**
 * What the Schema Builder's type picker is told about a saved field of an entity stored per language:
 * a change a translation rule of the save refuses whatever the field's values hold is blocked too,
 * with the save's own words.
 */
import { afterEach, describe, expect, it } from "vitest";

import { container } from "../../../di/container";
import { TRANSLATIONS_COLUMN_KEEPS_ITS_TYPE } from "../../../domains/schema/value-conversion/type-change/field-type-changes";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import {
  respondTypeChangeTargets,
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
      as?: Partial<FieldDefinition>
    ) =>
      typeChangeTargets({
        field: { name: "f", ...field } as FieldDefinition,
        candidates: [{ type, ...(as === undefined ? {} : { field: as }) }],
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

    // Whether the field is translated after the change is the draft's to say.
    it("a shared number becoming a text the draft keeps shared: open; one it translates: unavailable", () => {
      const becoming = (saved: Partial<FieldDefinition>, localized: boolean) =>
        targetOf({ type: "number", ...saved }, "text", COLLECTION, false, {
          localized,
        });
      expect(becoming({}, false)).toMatchObject({
        blocked: null,
        outcome: "converts",
      });
      expect(becoming({ localized: false }, true)).toMatchObject({
        blocked: "joins-translation",
        outcome: null,
      });
    });

    // A rename in the same draft is the save's to judge: the change of type is asked of the one field.
    it("a field the draft renamed too is judged by its saved name", () => {
      expect(
        targetOf(
          { type: "number", localized: false },
          "text",
          COLLECTION,
          false,
          {
            name: "renamed",
            localized: true,
          }
        )
      ).toMatchObject({ blocked: "joins-translation", outcome: null });
    });

    // Controls: the same change where no translation rule applies is judged by its values alone.
    it("a shared text, a field inside a container's JSON that is not translated there, or the earlier layout: no translation rule asked", () => {
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

// A group or repeater keeps one structure in every language, and the text inside it each language's
// own, field by field, whatever the entity's own switch says: a field that stops being translated
// there leaves every language's text behind it.
describe.each(["postgresql", "mysql", "sqlite"] as const)(
  "the type picker on a field inside a group or repeating rows (%s)",
  dialect => {
    afterEach(() => {
      container.clear();
    });

    const text = (name: string, extra: Record<string, unknown> = {}) => ({
      name,
      type: "text",
      ...extra,
    });
    const holding = (
      fields: Record<string, unknown>[],
      extra: Record<string, unknown> = {}
    ) => [{ name: "meta", type: "group", fields, ...extra }];
    const TWO = [text("note"), text("subtitle")];

    /** The picker's answer for the field at `path` becoming `to`, as the change would save it. */
    const inside = async (
      fields: Record<string, unknown>[],
      path: string[],
      to: string,
      asked: {
        type?: string;
        as?: Record<string, unknown>;
        layout?: TranslationLayout;
        builtBy?: "collection" | "fieldGroup";
      } = {}
    ) => {
      container.registerSingleton("adapter", () => ({
        getCapabilities: () => ({ dialect }),
      }));
      const response = respondTypeChangeTargets({
        fields: fields as unknown as FieldDefinition[],
        body: {
          field: path,
          type: asked.type ?? "text",
          candidates: [
            {
              type: to,
              ...(asked.as === undefined ? {} : { field: asked.as }),
            },
          ],
        },
        builtBy: asked.builtBy ?? "collection",
        layout: asked.layout ?? COLLECTION,
      });
      const body = (await response.json()) as {
        items: { blocked: string | null; outcome: string | null }[];
      };
      return body.items[0];
    };
    const LEAVES = {
      blocked: "leaves-translation-inside",
      refusal: null,
      outcome: null,
    };

    it.each([
      ["a group of two texts", holding(TWO), ["meta", "note"]],
      ["a group of one text", holding([text("note")]), ["meta", "note"]],
      ["repeating rows", holding(TWO, { type: "repeater" }), ["meta", "note"]],
      [
        "a group inside repeating rows",
        holding([{ name: "inner", type: "group", fields: TWO }], {
          type: "repeater",
        }),
        ["meta", "inner", "note"],
      ],
      [
        "a group with no name inside a group",
        holding([{ name: "", type: "group", fields: TWO }]),
        ["meta", "note"],
      ],
    ])(
      "a text in %s becoming a number: unavailable",
      async (_where, fields, path) => {
        expect(await inside(fields, path, "number")).toMatchObject(LEAVES);
      }
    );

    it.each([
      ["a Single's", SINGLE, "collection"],
      ["a field group's", SINGLE, "fieldGroup"],
    ] as const)(
      "unavailable in %s group too, whose save makes no file",
      async (_of, layout, builtBy) => {
        expect(
          await inside(holding(TWO), ["meta", "note"], "number", {
            layout,
            builtBy,
          })
        ).toMatchObject(LEAVES);
      }
    );

    it("a text becoming another translated type is open; one the draft turns Localized off for is not", async () => {
      expect(
        await inside(holding(TWO), ["meta", "note"], "textarea")
      ).toMatchObject({ blocked: null, outcome: "keeps" });
      expect(
        await inside(holding(TWO), ["meta", "note"], "textarea", {
          as: { localized: false },
        })
      ).toMatchObject(LEAVES);
      // A number that says it is translated keeps its place among the translated.
      expect(
        (
          await inside(holding(TWO), ["meta", "note"], "number", {
            as: { localized: true },
          })
        )?.blocked
      ).toBeNull();
    });

    // Controls: what is not translated inside its container leaves nothing behind.
    it.each([
      [
        "a shared text",
        holding([text("note", { localized: false }), text("subtitle")]),
        ["meta", "note"],
      ],
      [
        "a text in a group shared whole",
        holding(TWO, { localized: false }),
        ["meta", "note"],
      ],
      [
        "a row's own id",
        holding([text("id"), ...TWO], { type: "repeater" }),
        ["meta", "id"],
      ],
    ])("%s becoming a number: open", async (_what, fields, path) => {
      expect(await inside(fields, path, "number")).toMatchObject({
        blocked: null,
        outcome: "may-lose",
      });
    });

    it("on the earlier layout, and for a number becoming a text: open", async () => {
      expect(
        (
          await inside(holding(TWO), ["meta", "note"], "number", {
            layout: { perLanguage: false, fileRetypes: true },
          })
        )?.blocked
      ).toBeNull();
      expect(
        (
          await inside(
            holding([{ name: "rank", type: "number" }, text("subtitle")]),
            ["meta", "rank"],
            "text",
            { type: "number" }
          )
        )?.blocked
      ).toBeNull();
    });
  }
);
