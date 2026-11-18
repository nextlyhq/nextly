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

const base = {
  table: "dc_posts",
  dialect: "sqlite" as const,
  localized: false,
};

describe("planEntityMoves", () => {
  it("copies a field into an existing group before the file drops its column, and back on the way down", () => {
    const planned = planEntityMoves({
      ...base,
      before: [text("title"), group("meta", [])],
      after: [group("meta", [text("title")])],
      moves: [{ from: ["title"], to: ["meta", "title"] }],
    });
    // An empty column carried as JSON null (over any stale key), then the copy.
    expect(planned.up.first).toHaveLength(2);
    expect(planned.up.first[0]).toContain(`json('null')`);
    expect(planned.up.first[1]).toContain(
      `UPDATE "dc_posts" SET "meta" = json_set`
    );
    expect(planned.up.last).toEqual([]);
    // Down: the file re-adds the column first; the value comes back after it, and the key goes.
    expect(planned.down.first).toEqual([]);
    expect(planned.down.last.join("\n")).toContain(
      `SET "title" = json_extract`
    );
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

  it("refuses a move naming a field other than the one that moved, before it copies over that field", () => {
    // `title` moved to `meta.title`, but the move names `meta.other`, a field the group had.
    expect(() =>
      planEntityMoves({
        ...base,
        before: [text("title"), group("meta", [text("other")])],
        after: [group("meta", [text("other"), text("title")])],
        moves: [{ from: ["title"], to: ["meta", "other"] }],
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "FIELD_MOVE_REFUSED",
              message: expect.stringContaining(
                "does not match the save's fields"
              ),
            }),
          ],
        },
      })
    );
  });

  it("refuses a group moved beside a field inside it, which the group's clearing would strand", () => {
    const details = (fields: FieldDefinition[]) => group("details", fields);
    expect(() =>
      planEntityMoves({
        ...base,
        before: [group("a", [details([text("title")])]), group("b", [])],
        after: [text("title"), group("a", []), group("b", [details([])])],
        moves: [
          { from: ["a", "details"], to: ["b", "details"] },
          { from: ["a", "details", "title"], to: ["title"] },
        ],
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              message: expect.stringContaining("Save each move on its own."),
            }),
          ],
        },
      })
    );
  });

  it("plans nothing for a field keeping its path, into or out of a group with no name", () => {
    const nameless = (fields: FieldDefinition[]) =>
      ({ label: "Box", type: "group", fields }) as FieldDefinition;
    expect(
      planEntityMoves({
        ...base,
        before: [text("title")],
        after: [nameless([text("title")])],
        moves: [{ from: ["title"], to: ["title"] }],
      }).up
    ).toEqual({ first: [], last: [] });
  });

  it("refuses a move into a group that replaces a virtual group of its name, which made no column", () => {
    const virtualMeta = {
      ...group("meta", []),
      virtual: true,
    } as FieldDefinition;
    expect(() =>
      planEntityMoves({
        ...base,
        before: [text("title"), virtualMeta],
        after: [group("meta", [text("title")])],
        moves: [{ from: ["title"], to: ["meta", "title"] }],
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              message: expect.stringContaining("Save the new group first"),
            }),
          ],
        },
      })
    );
  });

  it("refuses a move out onto a column a deleted field of another name still holds", () => {
    // `fooBar` and `foo_bar` share the column `foo_bar`: deleted beside the move, its values
    // would stay on every entry the move has nothing to carry for.
    expect(() =>
      planEntityMoves({
        ...base,
        before: [text("fooBar"), group("meta", [text("foo_bar")])],
        after: [text("foo_bar"), group("meta", [])],
        moves: [{ from: ["meta", "foo_bar"], to: ["foo_bar"] }],
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "FIELD_MOVE_REFUSED",
              message: expect.stringContaining(
                "still holds another field before this save"
              ),
            }),
          ],
        },
      })
    );
  });

  it("refuses a move into a group whose old column another field takes in the same save", () => {
    expect(() =>
      planEntityMoves({
        ...base,
        before: [text("foo_bar"), group("meta", [])],
        after: [text("fooBar"), group("meta", [text("foo_bar")])],
        moves: [{ from: ["foo_bar"], to: ["meta", "foo_bar"] }],
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "FIELD_MOVE_REFUSED",
              message: expect.stringContaining(
                "is taken by another field in this save"
              ),
            }),
          ],
        },
      })
    );
  });

  it("refuses a field moved into a group of its own name in its place, whose making would overwrite it first", () => {
    expect(() =>
      planEntityMoves({
        ...base,
        before: [group("g", [text("a")])],
        after: [group("g", [group("a", [text("a")])])],
        moves: [{ from: ["g", "a"], to: ["g", "a", "a"] }],
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "FIELD_MOVE_REFUSED",
              message: expect.stringMatching(
                /^a cannot be moved .*inside its own place.*Move a somewhere else first, then into its new place in a later save\.$/
              ),
            }),
          ],
        },
      })
    );
  });

  it("refuses a field moved up into the place of the group that held it", () => {
    expect(() =>
      planEntityMoves({
        ...base,
        before: [group("g", [group("a", [text("a")])])],
        after: [group("g", [text("a")])],
        moves: [{ from: ["g", "a", "a"], to: ["g", "a"] }],
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              message: expect.stringMatching(
                /^a cannot be moved .*inside its own place.*Move a somewhere else first, then into its new place in a later save\.$/
              ),
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
      refilledColumns: [],
    });
  });
});
