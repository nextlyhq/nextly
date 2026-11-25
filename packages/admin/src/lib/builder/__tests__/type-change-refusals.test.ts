/**
 * A save's refusals of its type changes, shown at the changed fields: each read by the path the
 * server names the field by, from the draft's own type changes, with the message as written.
 */
import { describe, expect, it } from "vitest";

import type { BuilderField } from "@admin/components/features/schema-builder/types";
import { parseApiError } from "@admin/lib/api/parseApiError";

import { pendingChanges } from "../pending-changes";
import { refusedTypeChangesOf } from "../type-change-refusals";

const field = (
  id: string,
  type: string,
  overrides: Partial<BuilderField> = {}
) => ({ id, name: id, label: id, type, ...overrides }) as BuilderField;

const saved = [
  field("v", "text"),
  field("meta", "group", { fields: [field("rating", "number")] }),
  // A layout group holds no value of its own, so it is no step of a path.
  field("", "group", { id: "layout", fields: [field("note", "text")] }),
];
const draft = [
  field("v", "number"),
  field("meta", "group", { fields: [field("rating", "text")] }),
  field("", "group", { id: "layout", fields: [field("note", "textarea")] }),
];
const changes = pendingChanges(saved, draft);

const refusal = (
  errors: { path?: string; code?: string; message?: string }[]
) =>
  parseApiError(
    {
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed.",
        requestId: "req_x",
        data: { errors },
      },
    },
    400
  );

describe("a save's refusals of its type changes", () => {
  it("names each changed field by its path through the groups holding values", () => {
    expect(
      changes
        .filter(change => change.kind === "typeChanged")
        .map(change => change.path)
    ).toEqual([["v"], ["meta", "rating"], ["note"]]);
  });

  it("marks each refused field, by the path the server names, with the message as written", () => {
    const refused = refusedTypeChangesOf(
      refusal([
        {
          path: "fields.v",
          code: "RESHAPED_FIELD_LEAVES_TRANSLATION",
          message: "Its type changes as it stops being translated.",
        },
        {
          path: "fields.meta.rating",
          code: "TYPE_CHANGE_LOSES_VALUES",
          message: "Some ratings are no text.",
        },
        {
          path: "fields.note",
          code: "TYPE_CHANGE_BLOCKED",
          message: "It is kept per language.",
        },
      ]),
      changes
    );
    expect([...refused]).toEqual([
      ["v", "Its type changes as it stops being translated."],
      ["rating", "Some ratings are no text."],
      ["note", "It is kept per language."],
    ]);
  });

  it("marks no field for another kind of refusal, a path no type change names, or a failed request", () => {
    const refused = refusedTypeChangesOf(
      refusal([
        { path: "fields.v", code: "FIELD_MOVE_REFUSED", message: "No." },
        { path: "fields.title", code: "TYPE_CHANGE_BLOCKED", message: "No." },
      ]),
      changes
    );
    expect(refused.size).toBe(0);
    expect(
      refusedTypeChangesOf(new TypeError("Failed to fetch"), changes).size
    ).toBe(0);
  });
});
