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
});
