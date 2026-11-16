// Which Single and field-group saves keep the dialog's push, and which run the migration file they
// write: a save that carries values across its change keeps the push.
import { describe, expect, it, vi } from "vitest";

import type { TableSpec } from "../../../domains/schema/pipeline/diff/types";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
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

  it("runs the file for a translated entity's field added, renamed or kept translated", async () => {
    expect(
      await pushCarriesValues(
        save({
          oldFields: [translated("title"), shared("body")],
          newFields: [translated("headline"), shared("body"), translated("x")],
          wasStored: true,
          isStored: true,
          renamed: { from: "title", to: "headline" },
        })
      )
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

  it("keeps the push for a field leaving translation under its rename, judged as the preflight judges it", async () => {
    const leaving = save({
      oldFields: [translated("title")],
      newFields: [shared("headline")],
      wasStored: true,
      isStored: true,
      renamed: { from: "title", to: "headline" },
    });
    expect(await pushCarriesValues(leaving)).toBe(true);
    // Without the rename the shared field is a new one, and no field leaves: the rename is what
    // tells the move.
    expect(await pushCarriesValues({ ...leaving, renamed: undefined })).toBe(
      false
    );
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
