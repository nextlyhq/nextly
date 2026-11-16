// Which Single and field-group saves keep the dialog's push, and which run the migration file they
// write: a save that carries values across its change keeps the push.
import { describe, expect, it, vi } from "vitest";

import type { TableSpec } from "../../pipeline/diff/types";
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

  it("keeps the push for a translated field renamed, its companion column renamed", async () => {
    expect(
      await pushCarriesValues(
        save({
          oldFields: [translated("title"), shared("body")],
          newFields: [translated("headline"), shared("body")],
          wasStored: true,
          isStored: true,
          renamed: { from: "title", to: "headline" },
        })
      )
    ).toBe(true);
  });

  it("keeps the push for a translated field removed, its companion column dropped", async () => {
    const removed = save({
      oldFields: [translated("title"), shared("body")],
      newFields: [translated("headline"), shared("body")],
      wasStored: true,
      isStored: true,
    });
    expect(await pushCarriesValues(removed)).toBe(true);
    // A shared field removed leaves the companion alone.
    expect(
      await pushCarriesValues({
        ...removed,
        oldFields: [translated("title"), shared("body")],
        newFields: [translated("title")],
      })
    ).toBe(false);
  });

  it.each([
    ["turned on", false, true],
    ["turned off", true, false],
  ])(
    "keeps the push when translation is %s",
    async (_what, wasStored, isStored) => {
      expect(
        await pushCarriesValues(
          save({
            oldFields: [translated("heading")],
            newFields: [translated("heading")],
            wasStored,
            isStored,
          })
        )
      ).toBe(true);
    }
  );

  it("keeps the push when per-language Draft/Published changes on a translated entity", async () => {
    expect(
      await pushCarriesValues(
        save({
          wasStored: true,
          isStored: true,
          wasStatus: false,
          status: true,
        })
      )
    ).toBe(true);
  });

  it("keeps the push for a field joining translation", async () => {
    expect(
      await pushCarriesValues(
        save({
          oldFields: [shared("heading")],
          newFields: [translated("heading")],
          wasStored: true,
          isStored: true,
        })
      )
    ).toBe(true);
  });

  it.each([
    ["under its own name", "title", undefined],
    ["under its rename", "headline", { from: "title", to: "headline" }],
  ] as const)(
    "keeps the push for a field leaving translation %s",
    async (_how, name, renamed) => {
      expect(
        await pushCarriesValues(
          save({
            oldFields: [translated("title")],
            newFields: [shared(name)],
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
