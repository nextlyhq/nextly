/**
 * How `migrate:create` plans the moves a code-first config makes (`planCodeMoves`): what it says of
 * an entity the latest snapshot cannot show moves for, and what it refuses as the Schema Builder's
 * save refuses it.
 */
import { describe, expect, it } from "vitest";

import { planCodeMoves } from "../code-moves";
import type { EntitySettingsRecord } from "../entity-settings";
import type { MinimalConfigEntity } from "../generate";

const text = (name: string) => ({ name, type: "text" });
const group = (name: string, fields: object[]) => ({
  name,
  type: "group",
  fields,
});

/** An entity of the config, with its declaration recorded as `migrate:create` records it. */
function entity(
  slug: string,
  fields: object[],
  admin?: Record<string, unknown>
): MinimalConfigEntity {
  return {
    slug,
    tableName: `dc_${slug}`,
    fields: fields as MinimalConfigEntity["fields"],
    settings: {
      source: "code",
      settings: { slug, fields, ...(admin === undefined ? {} : { admin }) },
    } as MinimalConfigEntity["settings"],
  };
}

/** A snapshot's record holding `fields` for one entity of `kind`. */
function recorded(
  kind: "collections" | "fieldGroups",
  slug: string,
  fields: object[]
): EntitySettingsRecord {
  return {
    collections: {},
    singles: {},
    fieldGroups: {},
    [kind]: { [slug]: { source: "code", settings: { slug, fields } } },
  } as EntitySettingsRecord;
}

/** The run's other inputs: every move accepted, no column changes, warnings kept. */
function run(warned: string[]) {
  return {
    dialect: "postgresql" as const,
    originOf: () => "codeFirst" as const,
    decide: async (candidates: { from: readonly string[] }[]) =>
      candidates.map(candidate => ({
        candidate: candidate as never,
        accepted: true,
      })),
    interactive: false,
    warn: (message: string) => {
      warned.push(message);
    },
  };
}

describe("planCodeMoves", () => {
  it("says an entity the latest snapshot holds no fields for cannot show its moves, though no column changes", async () => {
    // A field moved between two groups changes the groups' JSON alone: no column is added or
    // dropped, so the table diff shows nothing, and only this warning says it was not checked.
    const warned: string[] = [];
    const plan = await planCodeMoves({
      ...run(warned),
      entities: [
        {
          kind: "collection",
          entity: entity("posts", [group("a", []), group("b", [text("x")])]),
        },
      ],
      previous: undefined,
      previousTables: new Set(["dc_posts"]),
    });
    expect(warned).toEqual([
      expect.stringMatching(/^Moves can't be detected for "posts":/),
    ]);
    expect(plan.appended.up.first).toEqual([]);
  });

  it("refuses moving a field the admin settings name into a group, as the Builder's save does", async () => {
    const warned: string[] = [];
    await expect(
      planCodeMoves({
        ...run(warned),
        entities: [
          {
            kind: "collection",
            entity: entity("posts", [group("meta", [text("subtitle")])], {
              useAsTitle: "subtitle",
            }),
          },
        ],
        previous: recorded("collections", "posts", [
          text("subtitle"),
          group("meta", []),
        ]),
        previousTables: new Set(["dc_posts"]),
      })
    ).rejects.toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "FIELD_MOVE_REFUSED",
              message: expect.stringMatching(
                /subtitle is named in the admin settings \(useAsTitle\)/
              ),
            }),
          ],
        },
      })
    );
  });

  it("says what to do instead when the planner refuses a move: decline it", async () => {
    const warned: string[] = [];
    await expect(
      planCodeMoves({
        ...run(warned),
        entities: [
          {
            kind: "collection",
            entity: entity("posts", [group("meta", [text("subtitle")])], {
              useAsTitle: "subtitle",
            }),
          },
        ],
        previous: recorded("collections", "posts", [
          text("subtitle"),
          group("meta", []),
        ]),
        previousTables: new Set(["dc_posts"]),
      })
    ).rejects.toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              message: expect.stringMatching(
                /To write it as a delete at the old place and an empty field at the new one instead, which loses its values, answer no when nextly migrate:create asks, or leave out --accept-moves\.$/
              ),
            }),
          ],
        },
      })
    );
  });

  // The DOWN moves the value back from the new place, so a working draft written there after the
  // UP holds a pending change the DOWN would drop, as one at the old place does for the UP.
  it("stops the DOWN where a working draft holds the field at its new place", async () => {
    const warned: string[] = [];
    const plan = await planCodeMoves({
      ...run(warned),
      entities: [
        {
          kind: "collection",
          entity: entity("posts", [group("meta", [text("subtitle")])]),
        },
      ],
      previous: recorded("collections", "posts", [
        text("subtitle"),
        group("meta", []),
      ]),
      previousTables: new Set(["dc_posts"]),
    });
    const stopsAt = (statements: readonly string[]) =>
      statements.flatMap(s => {
        const m = /^INSERT INTO "nextly_drafted_([a-z_]+)"/.exec(s);
        return m ? [m[1]] : [];
      });
    expect(stopsAt(plan.appended.up.first)).toEqual(["subtitle"]);
    expect(stopsAt(plan.appended.down.first)).toEqual(["meta_subtitle"]);
    // Each stop leads its side, before the side moves any value.
    expect(plan.appended.down.first[0]).toMatch(
      /^CREATE TEMP TABLE "nextly_drafted_meta_subtitle"/
    );
  });
});
