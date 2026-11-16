/**
 * A save's moves, planned whole: each checked against the definitions before and after, refused
 * before anything is written where it cannot keep the values, and otherwise turned into the
 * statements its migration file carries, in the places of the file that keep every value.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { planEntityMoves } from "../plan-moves";

const text = (name: string, extra: Record<string, unknown> = {}) =>
  ({ name, label: name, type: "text", ...extra }) as FieldDefinition;
const group = (name: string, fields: FieldDefinition[]) =>
  ({ name, label: name, type: "group", fields }) as FieldDefinition;

const base = { table: "dc_posts", dialect: "sqlite" as const, localized: false };

describe("planEntityMoves", () => {
  it("copies a field into an existing group before the file drops its column, and back on the way down", () => {
    const planned = planEntityMoves({
      ...base,
      before: [text("title"), group("meta", [])],
      after: [group("meta", [text("title")])],
      moves: [{ from: ["title"], to: ["meta", "title"] }],
    });
    expect(planned.up.first).toHaveLength(1);
    expect(planned.up.first[0]).toContain(`UPDATE "dc_posts" SET "meta" = json_set`);
    expect(planned.up.last).toEqual([]);
    // Down: the file re-adds the column first; the value comes back after it, and the key goes.
    expect(planned.down.first).toEqual([]);
    expect(planned.down.last.join("\n")).toContain(`SET "title" = json_extract`);
    expect(planned.down.last.join("\n")).toContain(`json_remove`);
    expect(planned.movedColumns).toEqual([
      { table: "dc_posts", column: "title", into: "meta" },
    ]);
  });

  it("copies a field out of a group after the file adds its column, then clears the key", () => {
    const planned = planEntityMoves({
      ...base,
      before: [group("meta", [text("title")])],
      after: [text("title"), group("meta", [])],
      moves: [{ from: ["meta", "title"], to: ["title"] }],
    });
    expect(planned.up.first).toEqual([]);
    expect(planned.up.last.join("\n")).toContain(`SET "title" = json_extract`);
    expect(planned.up.last.join("\n")).toContain(`json_remove`);
    // Down: before the file's down drops the column again, its value goes back into the group.
    expect(planned.down.first.join("\n")).toContain(`SET "meta" = json_set`);
    expect(planned.movedColumns).toEqual([]);
  });

  it("refuses a move into a group the same save creates, before anything is written", () => {
    expect(() =>
      planEntityMoves({
        ...base,
        before: [text("title")],
        after: [group("meta", [text("title")])],
        moves: [{ from: ["title"], to: ["meta", "title"] }],
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "FIELD_MOVE_REFUSED",
              message: expect.stringContaining(
                "Save the new group first, then move the field into it."
              ),
            }),
          ],
        },
      })
    );
  });

  it("refuses a move out of a group the same save deletes, before anything is written", () => {
    expect(() =>
      planEntityMoves({
        ...base,
        before: [group("meta", [text("title")])],
        after: [text("title")],
        moves: [{ from: ["meta", "title"], to: ["title"] }],
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              message: expect.stringContaining(
                "Move the field out first, then delete the group."
              ),
            }),
          ],
        },
      })
    );
  });

  it("refuses a move the rule refuses, with the rule's own message", () => {
    expect(() =>
      planEntityMoves({
        ...base,
        before: [text("slug", { unique: true }), group("meta", [])],
        after: [group("meta", [text("slug", { unique: true })])],
        moves: [{ from: ["slug"], to: ["meta", "slug"] }],
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "FIELD_MOVE_REFUSED",
              message: expect.stringContaining("cannot be kept unique"),
            }),
          ],
        },
      })
    );
  });

  it("plans nothing for a save that moves nothing", () => {
    expect(
      planEntityMoves({
        ...base,
        before: [text("title")],
        after: [text("title")],
        moves: [],
      })
    ).toEqual({
      up: { first: [], last: [] },
      down: { first: [], last: [] },
      movedColumns: [],
    });
  });
});
