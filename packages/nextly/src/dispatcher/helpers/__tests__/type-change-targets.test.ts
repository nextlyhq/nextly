/**
 * What the Schema Builder's type picker is told about a saved field: each other type blocked, and
 * why, or marked by what the change can do to the field's values, from the conversion rules. What a
 * translation rule of the save refuses is in `type-change-targets.translation.test.ts`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { FIELD_TYPE_CATALOG } from "../../../collections/fields/catalog";
import { container } from "../../../di/container";
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

    // The draft's own settings decide the column the change makes: MySQL keeps a unique text in a
    // bounded one, which a long text need not fit.
    it("a long text becoming a text the draft made unique: judged as the column that makes", () => {
      const outcomeWith = (field: Partial<FieldDefinition>) =>
        typeChangeTargets({
          field: { name: "f", type: "textarea" } as FieldDefinition,
          candidates: [{ type: "text", field }],
          dialect,
          builtBy: "collection",
        })[0]?.outcome;
      expect(outcomeWith({ unique: false })).toBe("keeps");
      expect(outcomeWith({ unique: true })).toBe(
        dialect === "mysql" ? "may-lose" : "keeps"
      );
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
    const UNSET = { hasMany: false, unique: false, options: [] };
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
