/**
 * The development start's warning of translated unique fields without their per-language index
 * (`warnAboutUnindexedTranslatedUnique`) judges the configuration code still owns. A collection a
 * demote handed to the Schema Builder is left out of it, so the warning judges the Builder's stored
 * entity for that address by the Builder's rules, rather than the code entry the schema roads
 * ignore. Before, it was given the whole configuration, and the stored entity was skipped as
 * configured.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const judged = vi.hoisted(() => ({ configs: [] as unknown[] }));

vi.mock("../../domains/i18n/runtime/translated-unique-boot-check", () => ({
  storedLocalizableEntities: async () => [],
  warnAboutUnindexedTranslatedUnique: async (
    _adapter: unknown,
    config: unknown
  ) => {
    judged.configs.push(config);
  },
}));

const services = vi.hoisted(() => ({ map: new Map<string, unknown>() }));
vi.mock("../../di/service-access", () => ({
  getService: (name: string) => {
    if (!services.map.has(name)) throw new Error(`${name} is not registered`);
    return services.map.get(name);
  },
}));

import { DEMOTED_FROM_CODE } from "../../domains/schema/pipeline/demoted-from-code";
import { runPostInitTasks } from "../post-init-tasks";

/** An adapter whose collection registry holds `posts`, handed over by a demote, and `notes`. */
const adapter = {
  dialect: "postgresql",
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

describe("the development start's warning of translated unique fields", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    services.map.clear();
    judged.configs = [];
  });

  it("judges the configuration code still owns, without a handed-over collection's code entry", async () => {
    const posts = { slug: "posts", fields: [] };
    const notes = { slug: "notes", fields: [] };
    services.map.set("adapter", adapter);
    services.map.set("config", { collections: [posts, notes] });
    services.map.set("logger", { warn: () => {}, info: () => {} });
    // The registries the warning reads the Builder's stored entities from (stubbed above).
    for (const name of [
      "collectionRegistryService",
      "singleRegistryService",
      "fieldGroupRegistryService",
    ]) {
      services.map.set(name, {});
    }
    vi.stubEnv("NODE_ENV", "development");

    await runPostInitTasks();

    expect(judged.configs).toHaveLength(1);
    expect(
      (judged.configs[0] as { collections: unknown[] }).collections
    ).toEqual([notes]);
  });
});
