// A field change's answers are matched to the field whose own column an event names, so a
// camelCase field (one a plugin or the API declared) is filled or made optional by its own name,
// and an answer naming another table or no field of the collection is refused.

import { describe, expect, it } from "vitest";

import type { UiSchemaManifest } from "../../../../schemas/_zod/ui-schema";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import {
  saveOfSchemaChange,
  type SchemaChangeAnswers,
} from "../schema-change-save";

const definition: UiSchemaManifest = {
  version: 1,
  collections: [],
  singles: [],
  components: [],
};

const fields = [
  { name: "firstName", type: "text", required: true },
  { name: "lastName", type: "text", required: true },
] as FieldDefinition[];

const change = (answers: SchemaChangeAnswers) =>
  saveOfSchemaChange({
    slug: "people",
    table: "dc_people",
    definition,
    row: { fields: [] },
    fields,
    localized: false,
    answers,
    junctions: { up: [], down: [] },
    keys: { before: [], after: [] },
  });

describe("a field change's answers", () => {
  it("fill and make optional a field inside a group with no name, a column of the row", () => {
    const { save, fields: saved } = saveOfSchemaChange({
      slug: "people",
      table: "dc_people",
      definition,
      row: { fields: [] },
      fields: [
        {
          type: "group",
          label: "Name",
          fields: [
            { name: "firstName", type: "text", required: true },
            { name: "lastName", type: "text", required: true },
          ],
        } as unknown as FieldDefinition,
      ],
      localized: false,
      answers: {
        eventResolutions: [
          {
            kind: "provide_default",
            eventId: "add_required_field_no_default:dc_people.first_name",
            value: "Ann",
          },
          {
            kind: "make_optional",
            eventId: "add_required_field_no_default:dc_people.last_name",
          },
        ],
      },
      junctions: { up: [], down: [] },
      keys: { before: [], after: [] },
    });

    expect(save.resolutions).toEqual([
      { column: "firstName", kind: "fill", value: "Ann" },
    ]);
    const inside = (
      saved[0] as unknown as { fields: { name: string; required: boolean }[] }
    ).fields;
    expect(inside.find(f => f.name === "lastName")?.required).toBe(false);
    expect(inside.find(f => f.name === "firstName")?.required).toBe(true);
  });

  it("fill a camelCase field, and make one optional, by the field's own name", () => {
    const { save, fields: saved } = change({
      eventResolutions: [
        {
          kind: "provide_default",
          eventId: "add_required_field_no_default:dc_people.first_name",
          value: "Ann",
        },
        {
          kind: "make_optional",
          eventId: "add_required_field_no_default:dc_people.last_name",
        },
      ],
    });

    expect(save.resolutions).toEqual([
      { column: "firstName", kind: "fill", value: "Ann" },
    ]);
    expect(saved.find(f => f.name === "lastName")?.required).toBe(false);
    expect(saved.find(f => f.name === "firstName")?.required).toBe(true);
  });

  it("refuse an answer naming another table, no field, or a malformed event", () => {
    for (const eventId of [
      "add_required_field_no_default:dc_pages.first_name",
      "add_required_field_no_default:dc_people.nickname",
      "not-an-event",
    ]) {
      expect(() =>
        change({
          eventResolutions: [{ kind: "provide_default", eventId, value: "x" }],
        })
      ).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    }
  });

  it("take a drop's confirmation of a column no field declares, which writes nothing", () => {
    // A table made before its saves wrote migrations can hold a column the
    // registry no longer names; the Builder's prompt confirms its drop.
    const { save } = change({
      eventResolutions: [
        { kind: "confirm_drop", eventId: "destructive_drop:dc_people.extra" },
      ],
    });

    expect(save.resolutions ?? []).toEqual([]);
  });

  it("refuse a drop's confirmation naming another table, or a malformed event", () => {
    for (const eventId of ["destructive_drop:dc_pages.extra", "not-an-event"]) {
      expect(() =>
        change({ eventResolutions: [{ kind: "confirm_drop", eventId }] })
      ).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    }
  });
});
