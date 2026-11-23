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
});
