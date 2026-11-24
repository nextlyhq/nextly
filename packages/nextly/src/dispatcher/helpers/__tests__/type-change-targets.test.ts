/**
 * What the Schema Builder's type picker is told about a saved field: each other type blocked, and
 * why, or marked by what the change can do to the field's values, from the conversion rules; on an
 * entity stored per language, blocked too where a translation rule of the save refuses it, with the
 * save's own words.
 */
import { afterEach, describe, expect, it } from "vitest";

import { FIELD_TYPE_CATALOG } from "../../../collections/fields/catalog";
import { container } from "../../../di/container";
import { TRANSLATIONS_COLUMN_KEEPS_ITS_TYPE } from "../../../domains/schema/value-conversion/type-change/field-type-changes";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import {
  respondTypeChangeTargets,
  typeChangeTargets,
  type TranslationLayout,
} from "../type-change-targets";

const CANDIDATES = FIELD_TYPE_CATALOG.map(entry => entry.type);

describe.each(["postgresql", "mysql", "sqlite"] as const)(
  "the type picker's targets for a saved field (%s)",
  dialect => {
    const targetsOf = (field: Partial<FieldDefinition>) =>
      new Map(
        typeChangeTargets({
          field: { name: "f", ...field } as FieldDefinition,
          candidates: CANDIDATES.map(type => ({ type })),
          dialect,
          builtBy: "collection",
        }).map(target => [target.type, target])
      );

    it("a text field: other text keeps, a number may lose, a group is blocked", () => {
      const targets = targetsOf({ type: "text" });
      expect(targets.has("text")).toBe(false);
      expect(targets.get("textarea")).toMatchObject({
        blocked: null,
        outcome: "keeps",
      });
      expect(targets.get("number")).toMatchObject({
        blocked: null,
        outcome: "may-lose",
      });
      expect(targets.get("group")).toMatchObject({
        blocked: "container",
        outcome: null,
      });
    });

    it("a number field: written as text converts", () => {
      expect(targetsOf({ type: "number" }).get("text")).toMatchObject({
        blocked: null,
        outcome: "converts",
      });
    });

    it("a saved group: every type unavailable", () => {
      const targets = targetsOf({ type: "group", fields: [] });
      for (const target of targets.values()) {
        expect(target.blocked, target.type).not.toBeNull();
      }
    });
  }
);

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

describe("the route's answer for a field found by its path", () => {
  afterEach(() => {
    container.clear();
  });

  it("judges a change to a type that keeps one value as one value, not as the field's list", () => {
    const list = {
      name: "f",
      type: "number",
      hasMany: true,
    } as FieldDefinition;
    const targetOf = (hasMany?: boolean) =>
      typeChangeTargets({
        field: list,
        candidates: [
          { type: "text", ...(hasMany === undefined ? {} : { hasMany }) },
        ],
        dialect: "postgresql",
        builtBy: "collection",
        layout: { perLanguage: false, fileRetypes: true },
      })[0]?.outcome;
    // Several numbers becoming one text loses all but one; written as a list of texts, each is kept.
    expect(targetOf(true)).toBe("converts");
    expect(targetOf(false)).toBe("may-lose");
    // Not said, the field's own.
    expect(targetOf()).toBe("converts");
  });

  // The options are the ones the change would save, which a draft may have dropped or edited: the
  // saved field's own answer for values the saved field held.
  it("judges a change to a choice over the options the change would leave, not the saved ones", () => {
    const targetOf = (options?: string[]) =>
      typeChangeTargets({
        field: {
          name: "f",
          type: "select",
          options: [
            { label: "A", value: "a" },
            { label: "B", value: "b" },
          ],
        } as FieldDefinition,
        candidates: [
          { type: "radio", ...(options === undefined ? {} : { options }) },
        ],
        dialect: "postgresql",
        builtBy: "collection",
        layout: { perLanguage: false, fileRetypes: true },
      })[0]?.outcome;
    expect(targetOf(["a", "b"])).toBe("keeps");
    expect(targetOf(["a"])).toBe("may-lose");
    expect(targetOf([])).toBe("may-lose");
    // Not said, the field's own.
    expect(targetOf()).toBe("keeps");
  });

  it("refuses an answer for a field whose saved type is no longer the one the page knows", () => {
    container.registerSingleton("adapter", () => ({
      getCapabilities: () => ({ dialect: "sqlite" }),
    }));
    expect(() =>
      respondTypeChangeTargets({
        fields: [{ name: "summary", type: "text" }] as FieldDefinition[],
        body: { field: ["summary"], type: "textarea" },
        builtBy: "collection",
        layout: { perLanguage: false, fileRetypes: true },
      })
    ).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  });

  it("finds a field a group with no name holds on its level, by its own name", async () => {
    // A stand-in for the site's adapter: the route reads only which database it runs on.
    container.registerSingleton("adapter", () => ({
      getCapabilities: () => ({ dialect: "sqlite" }),
    }));
    const response = respondTypeChangeTargets({
      fields: [
        {
          name: "",
          type: "group",
          fields: [{ name: "subtitle", type: "text" }],
        },
      ] as FieldDefinition[],
      body: {
        field: ["subtitle"],
        type: "text",
        candidates: [{ type: "number" }],
      },
      builtBy: "collection",
      layout: { perLanguage: false, fileRetypes: true },
    });
    const body = (await response.json()) as {
      items: { type: string; outcome: string | null }[];
    };
    expect(body.items).toEqual([
      { type: "number", blocked: null, refusal: null, outcome: "may-lose" },
    ]);
  });
});
