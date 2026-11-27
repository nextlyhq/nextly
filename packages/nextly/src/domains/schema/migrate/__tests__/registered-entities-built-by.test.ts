/**
 * Which builder made the table of each collection and Single the registry records: the code-first
 * one for what code or a plugin declares, the Schema Builder for the rest.
 */
import { expect, it, vi } from "vitest";

vi.mock("../../pipeline/diff/introspect-live", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../pipeline/diff/introspect-live")
  >()),
  introspectTableNames: async () => ["dynamic_collections", "dynamic_singles"],
}));

vi.mock("../../pipeline/classifier/count-helpers", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../pipeline/classifier/count-helpers")
  >()),
  querySqlRows: async () =>
    ["code", "plugin:@acme/shop", "ui", "built-in"].map(source => ({
      slug: source,
      table_name: "t",
      fields: "[]",
      localized: false,
      source,
      migration_status: "applied",
    })),
}));

vi.mock("../../required-column-registries", () => ({
  requiredColumnRegistries: async () => [
    ["collection", "dynamic_collections"],
    ["single", "dynamic_singles"],
  ],
}));

import { registeredEntities } from "../unique-column-guard";

it("is the code-first builder for what code or a plugin declares, and the Schema Builder for the rest", async () => {
  const entities = await registeredEntities({}, "sqlite");

  for (const kind of ["collection", "single"] as const) {
    expect(
      Object.fromEntries(
        entities
          .filter(({ entity }) => entity.kind === kind)
          .map(({ entity, builtBy }) => [entity.slug, builtBy])
      )
    ).toEqual({
      code: "codeFirst",
      "plugin:@acme/shop": "codeFirst",
      ui: "collection",
      "built-in": "collection",
    });
  }
});
