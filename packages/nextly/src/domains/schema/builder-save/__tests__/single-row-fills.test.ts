/**
 * What a Single's dialog save hands on for its row (`dialogRowAnswers`): which fields are new to
 * its table, which the person has answered themselves, and which the push asks about.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { dialogRowAnswers } from "../single-row-fills";

const TABLE = "single_srf_home";

const answersFor = (
  oldFields: unknown[],
  fields: unknown[],
  answers: {
    resolutions?: Record<string, { action: "provide_default"; value: unknown }>;
    eventResolutions?: { kind: string; eventId: string; value?: unknown }[];
  } = {}
) =>
  dialogRowAnswers({
    single: { tableName: TABLE, fields: oldFields },
    fields: fields as FieldDefinition[],
    renameResolutions: undefined,
    resolutions: answers.resolutions,
    eventResolutions: answers.eventResolutions as never,
    dialect: "sqlite",
    translatedAfter: false,
  });

const BODY = { name: "body", type: "text" };

describe("a Single's row answers", () => {
  // A field inside a group with no name is stored on the row like one beside it.
  it("asks the push about a required field inside a group with no name", () => {
    const { legacyBundle } = answersFor(
      [BODY],
      [
        BODY,
        {
          type: "group",
          fields: [
            {
              name: "tagline",
              type: "text",
              required: true,
              defaultValue: "Draft",
            },
          ],
        },
      ]
    );
    expect(legacyBundle?.byFieldName.tagline).toEqual({
      action: "provide_default",
      value: "Draft",
    });
  });

  it("leaves a field the person answered with a typed answer to that answer", () => {
    const { fileAnswers, legacyBundle } = answersFor(
      [BODY],
      [
        BODY,
        {
          name: "tagline",
          type: "text",
          required: true,
          defaultValue: "Draft",
        },
      ],
      {
        eventResolutions: [
          {
            kind: "make_optional",
            eventId: `add_required_field_no_default:${TABLE}.tagline`,
          },
        ],
      }
    );
    expect(fileAnswers.rowFills ?? []).toEqual([]);
    expect(legacyBundle?.byFieldName.tagline).toBeUndefined();
  });

  // A many-to-many keeps its links in a table of its own, so the row has no column for it: a
  // field of the same name stored on the row is new to the table, and its row is filled.
  it("fills a field of a name that had no column on the row", () => {
    const { fileAnswers } = answersFor(
      [
        BODY,
        {
          name: "topic",
          type: "relationship",
          relationTo: "tags",
          options: { target: "tags", relationType: "manyToMany" },
        },
      ],
      [BODY, { name: "topic", type: "text", defaultValue: "General" }]
    );
    expect(fileAnswers.rowFills).toEqual([
      { field: "topic", value: "General" },
    ]);
  });
});
