/**
 * `nextly migrate`'s check before it records metadata (`beforeMetadata`): a translations column
 * that cannot hold a field the configuration newly translates refuses the run. A collection a
 * demote handed to the Schema Builder keeps its translations table as the Builder has it, so its
 * code entry, still in the configuration, is not judged: the check is given the configuration code
 * still owns, as the run's translations-table pass is. Before, it was given the whole configuration,
 * and the ignored entry could refuse the run.
 */
import { describe, expect, it, vi } from "vitest";

const judged = vi.hoisted(() => ({ configs: [] as unknown[] }));

vi.mock("../../../../cli/commands/migrate", () => ({
  // No migration file is pending, so the check runs.
  findPendingFiles: async () => [],
}));
vi.mock("../../../i18n/runtime/companion-io", () => ({
  refuseCompanionColumnsThatCannotHold: async (
    _adapter: unknown,
    config: unknown
  ) => {
    judged.configs.push(config);
  },
}));

import { DEMOTED_FROM_CODE } from "../../pipeline/demoted-from-code";
import { deployStepDeps } from "../deploy-step-deps";

/** An adapter whose collection registry holds `posts`, handed over by a demote, and `notes`. */
function adapterHoldingHandedOverPosts() {
  return {
    executeQuery: async (sql: string) =>
      sql.includes("dynamic_collections")
        ? [
            {
              slug: "posts",
              table_name: "dc_posts",
              fields: "[]",
              status: 0,
              source: "ui",
              config_path: DEMOTED_FROM_CODE,
            },
            {
              slug: "notes",
              table_name: "dc_notes",
              fields: "[]",
              status: 0,
              source: "code",
              config_path: "nextly.config.ts",
            },
          ]
        : [],
  };
}

describe("nextly migrate's check before it records metadata", () => {
  it("judges the configuration code still owns, without a handed-over collection's code entry", async () => {
    judged.configs = [];
    const posts = { slug: "posts", localized: true, fields: [] };
    const notes = { slug: "notes", localized: true, fields: [] };
    const deps = deployStepDeps({
      adapter: adapterHoldingHandedOverPosts() as never,
      db: {},
      dialect: "sqlite",
      migrationsDir: "/virtual/migrations",
      logger: {} as never,
      config: { collections: [posts, notes] } as never,
      recordedBefore: { entities: {} } as never,
    });

    await deps.beforeMetadata?.();

    expect(judged.configs).toHaveLength(1);
    expect(
      (judged.configs[0] as { collections: unknown[] }).collections
    ).toEqual([notes]);
  });
});
