/**
 * A table declared through a hook must reach the plugin's migration.
 *
 * `schema.addTable()` inside `schema.extend` is a documented way to declare
 * one, and boot compiles and pushes whatever the hook produces.
 * `migrate:create --plugin` passed only the declarative `schema.tables` to the
 * compiler, so a plugin using the hook form generated an empty module: the
 * table existed after a dev push and was missing after a production
 * migration, which is the one difference migrations exist to prevent.
 */
import { describe, expect, it } from "vitest";

import { buildExtensionSchema } from "../build-extension-schema";
import { col, defineTable } from "../dsl";

const notes = defineTable("notes", { id: col.id(), title: col.shortText() });

/** What `migrate:create --plugin` compiles, with and without the hooks. */
async function compiled(contribution: {
  tables?: unknown[];
  extend?: unknown[];
}) {
  const built = await buildExtensionSchema({
    dialect: "postgresql",
    coreTableNames: ["users", "media"],
    entities: [],
    pluginPrefixes: new Map([["@acme/fx", "fx"]]),
    plugins: [
      { owner: { kind: "plugin", id: "@acme/fx" }, ...contribution },
    ] as never,
  });
  return built.tables.map(t => t.name);
}

describe("what a plugin's migration is generated from", () => {
  it("includes a table the plugin DECLARED", async () => {
    expect(await compiled({ tables: [notes] })).toEqual(["fx__notes"]);
  });

  it("includes a table a HOOK added", async () => {
    // The defect: this compiled to nothing, so the module was empty.
    expect(
      await compiled({
        extend: [
          ({ schema }: { schema: { addTable(d: unknown): void } }) => {
            schema.addTable(notes);
          },
        ],
      })
    ).toEqual(["fx__notes"]);
  });

  it("includes both when the plugin uses both forms", async () => {
    const tags = defineTable("tags", { id: col.id(), label: col.shortText() });
    expect(
      (
        await compiled({
          tables: [notes],
          extend: [
            ({ schema }: { schema: { addTable(d: unknown): void } }) => {
              schema.addTable(tags);
            },
          ],
        })
      ).sort()
    ).toEqual(["fx__notes", "fx__tags"]);
  });

  it("compiles nothing when the plugin declares nothing", async () => {
    // The control: the empty module was the SYMPTOM, so a test that cannot
    // tell "declared nothing" from "declared through a hook" proves neither.
    expect(await compiled({})).toEqual([]);
  });
});
