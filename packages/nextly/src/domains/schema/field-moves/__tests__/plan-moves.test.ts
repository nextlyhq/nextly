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
const group = (
  name: string,
  fields: FieldDefinition[],
  extra: Record<string, unknown> = {}
) =>
  ({ name, label: name, type: "group", fields, ...extra }) as FieldDefinition;

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
      // A name no system column holds: the table's own `title` is refused as a destination.
      before: [group("meta", [text("subtitle")])],
      after: [text("subtitle"), group("meta", [])],
      moves: [{ from: ["meta", "subtitle"], to: ["subtitle"] }],
    });
    expect(planned.up.first).toEqual([]);
    expect(planned.up.last.join("\n")).toContain(
      `SET "subtitle" = json_extract`
    );
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
              message: expect.stringContaining("a field of another name"),
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

  it("refuses two fields whose moves swap their places, each move keeping its field's own name", () => {
    expect(() =>
      planEntityMoves({
        ...base,
        before: [text("title"), text("subtitle"), group("meta", [])],
        after: [group("meta", [text("title"), text("subtitle")])],
        moves: [
          { from: ["title"], to: ["meta", "subtitle"] },
          { from: ["subtitle"], to: ["meta", "title"] },
        ],
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "FIELD_MOVE_REFUSED",
              message: expect.stringContaining("keeps its name"),
            }),
          ],
        },
      })
    );
  });

  it("refuses a move into a group that was another kind of field before this save", () => {
    const json = (name: string) =>
      ({ name, label: name, type: "json" }) as FieldDefinition;
    expect(() =>
      planEntityMoves({
        ...base,
        before: [text("title"), json("meta")],
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
                "was not a group before this save"
              ),
            }),
          ],
        },
      })
    );
  });

  it("refuses a move whose field the same save also renames", () => {
    expect(() =>
      planEntityMoves({
        ...base,
        before: [text("title"), group("meta", [])],
        after: [text("subtitle"), group("meta", [text("title")])],
        moves: [{ from: ["title"], to: ["meta", "title"] }],
        renames: [{ from: "title", to: "subtitle" }],
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "FIELD_MOVE_REFUSED",
              message: expect.stringContaining("also renamed"),
            }),
          ],
        },
      })
    );
  });

  it("refuses a move whose values are kept for each language, which this kind of save does not carry yet", () => {
    expect(() =>
      planEntityMoves({
        ...base,
        localized: true,
        before: [
          text("tagline", { localized: true }),
          group("meta", [], { localized: true }),
        ],
        after: [
          group("meta", [text("tagline", { localized: true })], {
            localized: true,
          }),
        ],
        moves: [{ from: ["tagline"], to: ["meta", "tagline"] }],
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "FIELD_MOVE_REFUSED",
              message: expect.stringContaining("kept for each language"),
            }),
          ],
        },
      })
    );
  });

  it("refuses two moved fields of one name, whose places a swap could exchange", () => {
    expect(() =>
      planEntityMoves({
        ...base,
        before: [
          group("a", [text("title")]),
          group("b", [text("title")]),
          group("c", []),
          group("d", []),
        ],
        after: [
          group("a", []),
          group("b", []),
          group("c", [text("title")]),
          group("d", [text("title")]),
        ],
        moves: [
          { from: ["a", "title"], to: ["d", "title"] },
          { from: ["b", "title"], to: ["c", "title"] },
        ],
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "FIELD_MOVE_REFUSED",
              message: expect.stringContaining("Two fields named title"),
            }),
          ],
        },
      })
    );
  });

  it("refuses a move whose name another field also leaves its place with, which no move pairs", () => {
    // Which `title` went where is not known from the definitions; one hint leaves the other
    // field's values at a place nothing reads.
    const before = [
      group("a", [text("title")]),
      group("b", [text("title")]),
      group("c", []),
      group("d", []),
    ];
    const after = [
      group("a", []),
      group("b", []),
      group("c", [text("title")]),
      group("d", [text("title")]),
    ];
    expect(() =>
      planEntityMoves({
        ...base,
        before,
        after,
        moves: [{ from: ["a", "title"], to: ["d", "title"] }],
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "FIELD_MOVE_REFUSED",
              message: expect.stringContaining(
                "Another field named title (b.title) also leaves its place"
              ),
            }),
          ],
        },
      })
    );
    // A field of that name leaving with a field at its own path still there is no rival.
    expect(() =>
      planEntityMoves({
        ...base,
        before: [group("a", [text("title")]), group("d", []), text("title")],
        after: [group("a", []), group("d", [text("title")]), text("title")],
        moves: [{ from: ["a", "title"], to: ["d", "title"] }],
      })
    ).not.toThrow();
  });

  it("refuses moving into a group a top-level field the entity's admin settings name", () => {
    // The definition file holds the admin settings beside the fields, and is read again only
    // where they name a top-level field: one moved into a group would leave it unreadable.
    const moveTitle = (admin: {
      useAsTitle?: string;
      defaultColumns?: string[];
    }) =>
      planEntityMoves({
        ...base,
        before: [text("title"), group("meta", [])],
        after: [group("meta", [text("title")])],
        moves: [{ from: ["title"], to: ["meta", "title"] }],
        admin,
      });
    for (const admin of [
      { useAsTitle: "title" },
      { defaultColumns: ["slug", "title"] },
    ]) {
      expect(() => moveTitle(admin)).toThrow(
        expect.objectContaining({
          publicData: {
            errors: [
              expect.objectContaining({
                code: "FIELD_MOVE_REFUSED",
                message: expect.stringContaining(
                  "title is named in the admin settings"
                ),
              }),
            ],
          },
        })
      );
    }
    expect(() =>
      moveTitle({ useAsTitle: "slug", defaultColumns: ["slug"] })
    ).not.toThrow();
  });

  it("refuses moving into a group a top-level field an enabled stored hook names", () => {
    // The executor hands a hook its stored config, whose settings name top-level fields.
    const moveSummary = (
      hooks: {
        hookId: string;
        enabled: boolean;
        config: Record<string, unknown>;
      }[]
    ) =>
      planEntityMoves({
        ...base,
        before: [text("summary"), group("meta", [])],
        after: [group("meta", [text("summary")])],
        moves: [{ from: ["summary"], to: ["meta", "summary"] }],
        hooks,
      });
    expect(() =>
      moveSummary([
        {
          hookId: "auto-slug",
          enabled: true,
          config: { sourceField: "summary", targetField: "slug" },
        },
      ])
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "FIELD_MOVE_REFUSED",
              message:
                "summary is named by the Auto-generate Slug hook (sourceField), which reads and writes only top-level fields. Update the hook first, then move summary.",
            }),
          ],
        },
      })
    );
    // A disabled hook, one the executor does not know, and one naming another field run nothing.
    expect(() =>
      moveSummary([
        {
          hookId: "auto-slug",
          enabled: false,
          config: { sourceField: "summary" },
        },
        { hookId: "not-a-hook", enabled: true, config: { field: "summary" } },
        {
          hookId: "unique-validation",
          enabled: true,
          config: { field: "slug" },
        },
      ])
    ).not.toThrow();
  });

  it("refuses a move out of a group onto the title or slug every entry keeps while no field takes it", () => {
    // With no top-level field of the name, the table keeps its own `title` and `slug` columns.
    for (const name of ["title", "slug"]) {
      const moveOut = (before: FieldDefinition[]) =>
        planEntityMoves({
          ...base,
          before,
          after: [text(name), group("meta", [])],
          moves: [{ from: ["meta", name], to: [name] }],
        });
      expect(() => moveOut([group("meta", [text(name)])]), name).toThrow(
        expect.objectContaining({
          publicData: {
            errors: [
              expect.objectContaining({
                code: "FIELD_MOVE_REFUSED",
                message: `Every entry already keeps its own ${name} while no field is named ${name}, and moving ${name} there would write over it. Rename ${name} inside the group first, then move it out.`,
              }),
            ],
          },
        })
      );
    }
    // A column no system column holds moves as before.
    expect(() =>
      planEntityMoves({
        ...base,
        before: [group("meta", [text("summary")])],
        after: [text("summary"), group("meta", [])],
        moves: [{ from: ["meta", "summary"], to: ["summary"] }],
      })
    ).not.toThrow();
  });

  it("refuses a group that takes the column of a JSON field it replaces, under a name of another spelling", () => {
    // `seoMeta` and `seo_meta` share one column: the JSON field's keys would stay in the group.
    const json = (name: string) =>
      ({ name, label: name, type: "json" }) as FieldDefinition;
    expect(() =>
      planEntityMoves({
        ...base,
        before: [text("title"), json("seoMeta")],
        after: [group("seo_meta", [text("title")])],
        moves: [{ from: ["title"], to: ["seo_meta", "title"] }],
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              message: expect.stringContaining(
                "seo_meta was not a group before this save"
              ),
            }),
          ],
        },
      })
    );
  });

  it("refuses a move whose name another field also arrives with, which no move pairs", () => {
    // One `title` left and two arrived: which one it became is not known from the definitions,
    // and the hint could carry its values to the field that was only added.
    const after = [
      group("a", []),
      group("c", [text("title")]),
      group("d", [text("title")]),
    ];
    expect(() =>
      planEntityMoves({
        ...base,
        before: [group("a", [text("title")]), group("c", []), group("d", [])],
        after,
        moves: [{ from: ["a", "title"], to: ["d", "title"] }],
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "FIELD_MOVE_REFUSED",
              message: expect.stringContaining(
                "Another field named title (c.title) also arrives in this save"
              ),
            }),
          ],
        },
      })
    );
    // A field renamed to that name at the top arrives under it without being a rival.
    expect(() =>
      planEntityMoves({
        ...base,
        before: [group("a", [text("title")]), group("d", []), text("headline")],
        after: [group("a", []), group("d", [text("title")]), text("title")],
        moves: [{ from: ["a", "title"], to: ["d", "title"] }],
        renames: [{ from: "headline", to: "title" }],
      })
    ).not.toThrow();
  });

  it("refuses a move into a nested group that was another kind of field before this save", () => {
    const json = (name: string) =>
      ({ name, label: name, type: "json" }) as FieldDefinition;
    expect(() =>
      planEntityMoves({
        ...base,
        before: [text("title"), group("g", [json("meta")])],
        after: [group("g", [group("meta", [text("title")])])],
        moves: [{ from: ["title"], to: ["g", "meta", "title"] }],
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "FIELD_MOVE_REFUSED",
              message: expect.stringContaining(
                "g.meta was not a group before this save"
              ),
            }),
          ],
        },
      })
    );
  });

  it("does not refuse a move between groups beside a rename of an unrelated column of its field's name", () => {
    const planned = planEntityMoves({
      ...base,
      before: [
        text("title"),
        group("meta", [text("title")]),
        group("extra", []),
      ],
      after: [
        text("subtitle"),
        group("meta", []),
        group("extra", [text("title")]),
      ],
      moves: [{ from: ["meta", "title"], to: ["extra", "title"] }],
      renames: [{ from: "title", to: "subtitle" }],
    });
    expect(planned.up.first.join("\n")).toContain(`"extra"`);
  });

  it("refuses an optional field made required as it moves into a group", () => {
    expect(() =>
      planEntityMoves({
        ...base,
        before: [text("title"), group("meta", [])],
        after: [group("meta", [text("title", { required: true })])],
        moves: [{ from: ["title"], to: ["meta", "title"] }],
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "FIELD_MOVE_REFUSED",
              message: expect.stringContaining("made required as it moves"),
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
