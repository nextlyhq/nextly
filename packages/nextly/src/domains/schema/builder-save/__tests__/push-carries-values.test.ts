// Which Single and field-group saves keep the dialog's push, and which run the migration file they
// write: a save that carries values across its change keeps the push.
import { describe, expect, it, vi } from "vitest";

import type { TableSpec } from "../../pipeline/diff/types";
import { getColumnDescriptor } from "../../services/field-column-descriptor";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { pushCarriesValues } from "../push-carries-values";

const field = (name: string, extra: Record<string, unknown> = {}) =>
  ({ name, type: "text", ...extra }) as unknown as FieldDefinition;
const shared = (name: string) => field(name, { localized: false });
const translated = (name: string) => field(name, { localized: true });

/** A save of `oldFields` into `newFields`, untranslated, with no live key read unless asked. */
function save(
  overrides: Partial<Parameters<typeof pushCarriesValues>[0]> = {}
): Parameters<typeof pushCarriesValues>[0] {
  return {
    oldFields: [shared("heading")],
    newFields: [shared("heading"), shared("body")],
    wasStored: false,
    isStored: false,
    renamed: undefined,
    liveTable: () => Promise.resolve(undefined),
    columnOf: field => getColumnDescriptor(field, "postgresql", "collection"),
    renames: [],
    ...overrides,
  };
}

describe("pushCarriesValues", () => {
  it("runs the file for a save that moves no value, without reading the live table", async () => {
    const liveTable = vi.fn(() => Promise.resolve(undefined));
    expect(await pushCarriesValues(save({ liveTable }))).toBe(false);
    expect(liveTable).not.toHaveBeenCalled();
  });

  it("runs the file for a translated entity's field added, a shared one renamed, or a translated one kept", async () => {
    expect(
      await pushCarriesValues(
        save({
          oldFields: [translated("title"), shared("body")],
          newFields: [translated("title"), shared("text"), translated("x")],
          wasStored: true,
          isStored: true,
        })
      )
    ).toBe(false);
  });

  // A translation change is the file's: its companion files carry the values, and a translations
  // table the history does not describe is refused as drift before it runs.
  it.each([
    [
      "a translated field renamed",
      {
        oldFields: [translated("title"), shared("body")],
        newFields: [translated("headline"), shared("body")],
        renamed: { from: "title", to: "headline" },
      },
    ],
    [
      "a translated field removed",
      {
        oldFields: [translated("title"), shared("body")],
        newFields: [shared("body")],
      },
    ],
    [
      "translation turned on",
      {
        oldFields: [translated("heading")],
        newFields: [translated("heading")],
        wasStored: false,
      },
    ],
    [
      "translation turned off",
      {
        oldFields: [translated("heading")],
        newFields: [translated("heading")],
        isStored: false,
      },
    ],
    [
      "translation turned off over a Required translated field",
      {
        oldFields: [translated("heading")],
        newFields: [field("heading", { localized: true, required: true })],
        isStored: false,
      },
    ],
    [
      "a field joining translation",
      { oldFields: [shared("heading")], newFields: [translated("heading")] },
    ],
    [
      "a field leaving translation",
      { oldFields: [translated("title")], newFields: [shared("title")] },
    ],
    [
      "a field leaving translation under its rename",
      {
        oldFields: [translated("title")],
        newFields: [shared("headline")],
        renamed: { from: "title", to: "headline" },
      },
    ],
  ] as const)("runs the file for %s", async (_what, change) => {
    expect(
      await pushCarriesValues(
        save({ wasStored: true, isStored: true, ...change })
      )
    ).toBe(false);
  });

  // The push adds the shared column without the setting, copies the default language's values in,
  // then sets it; the file would add it with the setting over rows that hold no value yet.
  it.each([
    ["Required", "under its own name", "title", undefined],
    [
      "Required",
      "under its rename",
      "headline",
      { from: "title", to: "headline" },
    ],
    ["Unique", "under its own name", "title", undefined],
  ] as const)(
    "keeps the push for a %s field leaving translation %s",
    async (setting, _how, name, renamed) => {
      expect(
        await pushCarriesValues(
          save({
            oldFields: [translated("title")],
            newFields: [
              field(name, {
                localized: false,
                [setting === "Required" ? "required" : "unique"]: true,
              }),
            ],
            wasStored: true,
            isStored: true,
            renamed,
          })
        )
      ).toBe(true);
    }
  );

  describe("a field new to a Single's table, which its row is filled in", () => {
    const fills = (field: FieldDefinition) =>
      (field as { required?: boolean }).required === true ||
      (field as { default?: unknown }).default !== undefined;
    const added = (field: FieldDefinition, holds = true) =>
      save({
        oldFields: [shared("heading")],
        newFields: [shared("heading"), field],
        singleRow: {
          renamedTo: [],
          fills,
          holdsRow: () => Promise.resolve(holds),
        },
      });

    it.each([
      ["a required field", field("tagline", { required: true })],
      [
        "an optional field with a default",
        field("motto", { default: "Be kind" }),
      ],
    ])(
      "keeps the push for %s while the table holds its row",
      async (_what, f) => {
        expect(await pushCarriesValues(added(f))).toBe(true);
      }
    );

    it("runs the file for a field that fills nothing, or a table holding no row", async () => {
      expect(await pushCarriesValues(added(shared("plain")))).toBe(false);
      expect(
        await pushCarriesValues(
          added(field("tagline", { required: true }), false)
        )
      ).toBe(false);
    });

    it("runs the file for a field renamed onto a required one, its column keeping its value", async () => {
      expect(
        await pushCarriesValues(
          save({
            oldFields: [shared("heading")],
            newFields: [field("headline", { required: true })],
            singleRow: {
              renamedTo: ["headline"],
              fills,
              holdsRow: () => Promise.resolve(true),
            },
          })
        )
      ).toBe(false);
    });
  });

  describe("a field whose column changes type, where the push judges the stored values", () => {
    const onMySql = (field: FieldDefinition) =>
      getColumnDescriptor(field, "mysql", "fieldGroup");

    it("keeps the push for a shared text made Unique, which MySQL bounds to varchar(255)", async () => {
      const unique = save({
        oldFields: [shared("heading")],
        newFields: [field("heading", { localized: false, unique: true })],
        columnOf: onMySql,
      });
      expect(await pushCarriesValues(unique)).toBe(true);
      // Elsewhere the column stays text, and the file runs.
      expect(
        await pushCarriesValues({
          ...unique,
          columnOf: f => getColumnDescriptor(f, "postgresql", "fieldGroup"),
        })
      ).toBe(false);
    });

    it("keeps the push for a bounded text narrowed", async () => {
      const short = (maxLength: number) =>
        field("code", {
          localized: false,
          options: { variant: "short" },
          validation: { maxLength },
        });
      // A collection's or a Single's short text takes its width from `maxLength`.
      expect(
        await pushCarriesValues(
          save({
            oldFields: [short(120)],
            newFields: [short(40)],
            columnOf: f => getColumnDescriptor(f, "mysql", "collection"),
          })
        )
      ).toBe(true);
    });

    it("keeps the push for a field whose type changes, renamed or not", async () => {
      const typeChange = save({
        oldFields: [shared("views")],
        newFields: [field("views", { type: "number", localized: false })],
      });
      expect(await pushCarriesValues(typeChange)).toBe(true);
      expect(
        await pushCarriesValues({
          ...typeChange,
          newFields: [field("hits", { type: "number", localized: false })],
          renames: [{ from: "views", to: "hits" }],
        })
      ).toBe(true);
    });

    it("reads the fields a group with no name lays out, which its row stores", async () => {
      const laidOut = (inside: FieldDefinition) =>
        ({ type: "group", fields: [inside] }) as unknown as FieldDefinition;
      const kept = save({
        oldFields: [laidOut(shared("views"))],
        newFields: [laidOut(shared("views")), shared("extra")],
      });
      expect(await pushCarriesValues(kept)).toBe(false);
      expect(
        await pushCarriesValues({
          ...kept,
          newFields: [
            laidOut(field("views", { type: "number", localized: false })),
          ],
        })
      ).toBe(true);
    });

    it("runs the file for a field made required, whose column keeps its type", async () => {
      expect(
        await pushCarriesValues(
          save({
            oldFields: [shared("heading")],
            newFields: [field("heading", { localized: false, required: true })],
          })
        )
      ).toBe(false);
    });
  });

  it("keeps the push for a relationship switched between one entry and many", async () => {
    expect(
      await pushCarriesValues(
        save({
          oldFields: [
            field("author", { type: "relationship", relationTo: "authors" }),
          ],
          newFields: [
            field("author", {
              type: "relationship",
              relationTo: "authors",
              hasMany: true,
            }),
          ],
        })
      )
    ).toBe(true);
  });

  it("keeps the push for a relationship pointed elsewhere while its live column holds a key", async () => {
    const keyed = {
      foreignKeys: [{ columns: ["author"] }],
    } as unknown as TableSpec;
    const retarget = save({
      oldFields: [
        field("author", { type: "relationship", relationTo: "authors" }),
      ],
      newFields: [
        field("author", { type: "relationship", relationTo: "editors" }),
      ],
      liveTable: () => Promise.resolve(keyed),
    });
    expect(await pushCarriesValues(retarget)).toBe(true);
    expect(
      await pushCarriesValues({
        ...retarget,
        liveTable: () =>
          Promise.resolve({ foreignKeys: [] } as unknown as TableSpec),
      })
    ).toBe(false);
  });
});
