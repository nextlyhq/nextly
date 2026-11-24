/**
 * What the Schema Builder's type picker is told about a saved field: each other type blocked, and
 * why, or marked by what the change can do to the field's values, from the conversion rules. What a
 * translation rule of the save refuses is in `type-change-targets.translation.test.ts`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { FIELD_TYPE_CATALOG } from "../../../collections/fields/catalog";
import { container } from "../../../di/container";
import {
  clearFieldTypes,
  registerFieldType,
} from "../../../domains/schema/field-types/field-type-registry";
import type { PluginFieldType } from "../../../plugins/contributions";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import {
  respondTypeChangeTargets,
  typeChangeTargets,
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

    // Two values alike refuse a field made unique, on every database. One unique already is judged as
    // the column the change makes: MySQL keeps a unique text in a bounded one, which a long text need
    // not fit.
    it("a long text becoming a text the draft made unique, or one unique already", () => {
      const outcomeOf = (before: boolean, after: boolean) =>
        typeChangeTargets({
          field: {
            name: "f",
            type: "textarea",
            unique: before,
          } as FieldDefinition,
          candidates: [{ type: "text", field: { unique: after } }],
          dialect,
          builtBy: "collection",
        })[0]?.outcome;
      expect(outcomeOf(false, false)).toBe("keeps");
      expect(outcomeOf(false, true)).toBe("may-lose");
      expect(outcomeOf(true, false)).toBe("keeps");
      expect(outcomeOf(true, true)).toBe(
        dialect === "mysql" ? "may-lose" : "keeps"
      );
    });

    // The field as the Builder's change saves an ordinary one: every setting said, none of them on.
    it("marks every type of a field with no rules by its pair alone", () => {
      for (const type of ["text", "number", "date", "checkbox", "chips"]) {
        const marks = (field?: Record<string, unknown>) =>
          typeChangeTargets({
            field: { name: "f", label: "F", type } as FieldDefinition,
            candidates: CANDIDATES.map(to => ({
              type: to,
              ...(field === undefined ? {} : { field: { ...field, type: to } }),
            })),
            dialect,
            builtBy: "collection",
          });
        expect(
          marks({
            name: "f",
            label: "F",
            required: false,
            unique: false,
            index: false,
            defaultValue: undefined,
            hasMany: undefined,
          }),
          type
        ).toEqual(marks());
      }
    });

    it("a saved group: every type unavailable", () => {
      const targets = targetsOf({ type: "group", fields: [] });
      for (const target of targets.values()) {
        expect(target.blocked, target.type).not.toBeNull();
      }
    });
  }
);

describe("the route's answer for a field found by its path", () => {
  afterEach(() => {
    container.clear();
    clearFieldTypes();
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
          {
            type: "text",
            ...(hasMany === undefined ? {} : { field: { hasMany } }),
          },
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
          {
            type: "radio",
            ...(options === undefined
              ? {}
              : {
                  field: {
                    options: options.map(value => ({ label: value, value })),
                  },
                }),
          },
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

  // The save asks the new field's own rules of each stored value (`fieldAccepts`): one the draft adds
  // or tightens may refuse what the saved field holds, whatever the types keep.
  describe("for a field whose rules the draft changed", () => {
    /** A long text becoming a text, which keeps every value, under these rules before and after. */
    const marked = (
      before: Record<string, unknown>,
      after: Record<string, unknown>,
      type = "text"
    ) =>
      typeChangeTargets({
        field: {
          name: "f",
          type: "textarea",
          ...before,
        } as unknown as FieldDefinition,
        candidates: [{ type, field: after }],
        dialect: "postgresql",
        builtBy: "collection",
      })[0]?.outcome;
    const rules = (validation: Record<string, unknown>) => ({ validation });

    it.each(["minLength", "min", "minRows", "minChips"])(
      "%s added or raised may lose values; the same, lowered or removed keeps them",
      rule => {
        expect(marked({}, rules({ [rule]: 5 }))).toBe("may-lose");
        expect(marked(rules({ [rule]: 3 }), rules({ [rule]: 5 }))).toBe(
          "may-lose"
        );
        expect(marked(rules({ [rule]: 5 }), rules({ [rule]: 5 }))).toBe(
          "keeps"
        );
        expect(marked(rules({ [rule]: 5 }), rules({ [rule]: 3 }))).toBe(
          "keeps"
        );
        expect(marked(rules({ [rule]: 5 }), {})).toBe("keeps");
      }
    );

    it.each(["maxLength", "max", "maxRows", "maxChips"])(
      "%s added or lowered may lose values; the same, raised or removed keeps them",
      rule => {
        expect(marked({}, rules({ [rule]: 40 }))).toBe("may-lose");
        expect(marked(rules({ [rule]: 80 }), rules({ [rule]: 40 }))).toBe(
          "may-lose"
        );
        expect(marked(rules({ [rule]: 40 }), rules({ [rule]: 40 }))).toBe(
          "keeps"
        );
        expect(marked(rules({ [rule]: 40 }), rules({ [rule]: 80 }))).toBe(
          "keeps"
        );
        expect(marked(rules({ [rule]: 40 }), {})).toBe("keeps");
      }
    );

    it("a pattern added or changed may lose values; the same, emptied or removed keeps them", () => {
      const letters = rules({ pattern: "^[a-z]+$" });
      expect(marked({}, letters)).toBe("may-lose");
      expect(marked(rules({ pattern: "^[a-z0-9]+$" }), letters)).toBe(
        "may-lose"
      );
      expect(marked(letters, letters)).toBe("keeps");
      expect(marked(letters, rules({ pattern: "" }))).toBe("keeps");
      expect(marked(letters, {})).toBe("keeps");
    });

    it("a least length of none, or a message, refuses no value", () => {
      expect(marked({}, rules({ minLength: 0 }))).toBe("keeps");
      expect(marked({}, rules({ message: "Too long" }))).toBe("keeps");
    });

    // A blank text is a value the old field held, and a required one refuses it.
    it("Required turned on may lose values, in either spelling; carried over or turned off keeps them", () => {
      expect(marked({}, { required: true })).toBe("may-lose");
      expect(marked({}, rules({ required: true }))).toBe("may-lose");
      expect(marked({ required: true }, rules({ required: true }))).toBe(
        "keeps"
      );
      expect(marked(rules({ required: true }), { required: true })).toBe(
        "keeps"
      );
      expect(marked({ required: true }, { required: false })).toBe("keeps");
    });

    it("a rule this does not know may lose values where it is new or changed, not where it is unset", () => {
      expect(marked({}, rules({ multipleOf: 5 }))).toBe("may-lose");
      expect(marked(rules({ multipleOf: 2 }), rules({ multipleOf: 5 }))).toBe(
        "may-lose"
      );
      expect(marked(rules({ multipleOf: 5 }), rules({ multipleOf: 5 }))).toBe(
        "keeps"
      );
      for (const unset of [null, false, ""]) {
        expect(marked({}, rules({ multipleOf: unset }))).toBe("keeps");
      }
    });

    // A smallest number of none is not zero: a negative one is refused by it.
    it("a least number of zero may lose values", () => {
      expect(marked({}, rules({ min: 0 }))).toBe("may-lose");
    });

    it("a saved rule spelled on the field itself is the same rule", () => {
      expect(marked({ maxLength: 40 }, rules({ maxLength: 40 }))).toBe("keeps");
      expect(marked({ pattern: "^a" }, rules({ pattern: "^a" }))).toBe("keeps");
    });

    it("a change that keeps the saved field's rules, or that is blocked, is marked by its types", () => {
      const bounded = { name: "f", type: "textarea", maxLength: 40 };
      const bare = typeChangeTargets({
        field: bounded as unknown as FieldDefinition,
        candidates: [{ type: "text" }],
        dialect: "postgresql",
        builtBy: "collection",
      });
      expect(bare[0]?.outcome).toBe("keeps");
      expect(marked({}, rules({ maxLength: 40 }), "group")).toBeNull();
    });
  });

  // The save runs a plugin's own check over each stored value, and only it knows what that refuses.
  it("a plugin's type with a check of its own may lose values; one with none is judged by what it stores", () => {
    const stars = { type: "stars", label: "Stars", storage: "number" } as const;
    registerFieldType({
      ...stars,
      validate: (value: unknown) =>
        Number(value) <= 5 ? true : "At most five stars.",
    } as unknown as PluginFieldType);
    registerFieldType({
      ...stars,
      type: "tally",
    } as unknown as PluginFieldType);
    const marks = typeChangeTargets({
      field: { name: "f", type: "number" } as FieldDefinition,
      candidates: [{ type: "stars" }, { type: "tally" }],
      dialect: "postgresql",
      builtBy: "collection",
    }).map(target => [target.type, target.outcome]);
    expect(marks).toEqual([
      ["stars", "may-lose"],
      ["tally", "keeps"],
    ]);
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

  describe("for a field whose settings the page knows", () => {
    const KIND = {
      name: "kind",
      type: "select",
      options: [
        { label: "A", value: "a" },
        { label: "B", value: "b" },
      ],
    };
    /** The settings a page asks with for a field stored with none of them, as it loads one. */
    const UNSET = {
      hasMany: false,
      unique: false,
      options: [],
      validation: {},
    };
    const ask = (stored: Record<string, unknown>, saved: unknown) => {
      container.registerSingleton("adapter", () => ({
        getCapabilities: () => ({ dialect: "mysql" }),
      }));
      return respondTypeChangeTargets({
        fields: [stored] as unknown as FieldDefinition[],
        body: {
          field: [stored.name],
          type: stored.type,
          saved,
          candidates: [{ type: "textarea" }],
        },
        builtBy: "collection",
        layout: { perLanguage: true, fileRetypes: true },
      });
    };

    it.each([
      ["Unique", { name: "v", type: "text", unique: true }, UNSET],
      ["several values", { name: "v", type: "text", hasMany: true }, UNSET],
      [
        "translation, off since",
        { name: "v", type: "text", localized: false },
        UNSET,
      ],
      [
        "translation, on since",
        { name: "v", type: "number", localized: true },
        { ...UNSET, localized: false },
      ],
      ["its options", KIND, { ...UNSET, options: ["a", "b", "c"] }],
      [
        "a bound",
        { name: "v", type: "text", validation: { maxLength: 40 } },
        { ...UNSET, validation: { maxLength: 100 } },
      ],
      [
        "a least bound, off since",
        { name: "v", type: "text" },
        { ...UNSET, validation: { minLength: 3 } },
      ],
      [
        "its pattern",
        { name: "v", type: "text", validation: { pattern: "^a" } },
        { ...UNSET, validation: { pattern: "^b" } },
      ],
      [
        "Required",
        { name: "v", type: "text", required: true },
        { ...UNSET, validation: { required: false } },
      ],
    ])(
      "refuses an answer where another save changed %s, and says to reload",
      (_setting, stored, saved) => {
        expect(() => ask(stored, saved)).toThrow(
          expect.objectContaining({
            code: "CONFLICT",
            publicMessage: `The saved field ${stored.name} has changed since the page was loaded. Reload it to see the field as saved.`,
          })
        );
      }
    );

    // A definition need not state a default, whatever wrote it: one stored with none of these
    // settings, or with each said, reads the same.
    it.each([
      ["stored with none of them", { name: "v", type: "text" }, UNSET],
      [
        "stored with nulls",
        {
          name: "v",
          type: "text",
          unique: null,
          hasMany: null,
          localized: null,
          options: null,
        },
        UNSET,
      ],
      [
        "stored with each default said, as a page that knows none said",
        {
          name: "v",
          type: "text",
          unique: false,
          hasMany: false,
          localized: true,
          options: [],
        },
        UNSET,
      ],
      [
        "stored with no default said, as a page that knows each said",
        { name: "v", type: "text" },
        { ...UNSET, localized: true },
      ],
      [
        "never translated, whatever its type's default",
        { name: "v", type: "text", virtual: true },
        UNSET,
      ],
      ["its options in another order", KIND, { ...UNSET, options: ["b", "a"] }],
      [
        "with its rules as stored",
        {
          name: "v",
          type: "text",
          required: true,
          validation: { maxLength: 40, pattern: "^a", message: "Old words" },
        },
        {
          ...UNSET,
          validation: {
            required: true,
            maxLength: 40,
            pattern: "^a",
            message: "New words",
          },
        },
      ],
      // The Builder's save writes no rule on the field itself, so the page does not know one there.
      [
        "with a rule stated on the field itself",
        { name: "v", type: "text", maxLength: 40, pattern: "^a" },
        UNSET,
      ],
      // A plugin's type keeps its own options in a container, under any name: none is a rule of core's.
      [
        "with a plugin's options named as rules are",
        {
          name: "v",
          type: "text",
          pluginOptions: {
            max: 5,
            pattern: "^a",
            required: true,
            unique: true,
            hasMany: true,
          },
        },
        {
          ...UNSET,
          own: {
            max: 5,
            pattern: "^a",
            required: true,
            unique: true,
            hasMany: true,
          },
        },
      ],
      [
        "with Required said one way on the field and another under its rules",
        {
          name: "v",
          type: "text",
          required: false,
          validation: { required: true },
        },
        { ...UNSET, validation: { required: true } },
      ],
      [
        "with an empty pattern, no least length, and Required off, all said",
        {
          name: "v",
          type: "text",
          required: false,
          validation: { pattern: "", minLength: 0 },
        },
        UNSET,
      ],
      // As the Builder wrote a field before it sent any of these, and loads it.
      [
        "saved as the Builder has always saved one",
        {
          name: "v",
          label: "V",
          type: "text",
          required: true,
          unique: false,
          index: false,
          validation: { maxLength: 40, message: "Too long" },
          admin: { width: "50%" },
        },
        {
          ...UNSET,
          validation: { required: true, maxLength: 40, message: "Too long" },
        },
      ],
      [
        "with no rules at all",
        { name: "v", type: "text", validation: null },
        UNSET,
      ],
    ])("answers for a field %s", (_how, stored, saved) => {
      expect(ask(stored, saved).status).toBe(200);
    });
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
