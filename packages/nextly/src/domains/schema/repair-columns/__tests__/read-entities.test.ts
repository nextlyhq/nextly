/**
 * `readRepairEntities` reads each registry only where that registry's own table exists. A site can
 * have one registry and not another (a database from before Singles, or a field-group registry
 * under its newer name), and a missing registry must contribute no rows rather than fail the run.
 *
 * The registry services are replaced by ones that answer from fixtures, and the Singles service
 * throws if it is asked at all, so reading a registry whose table is missing fails this suite.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it, vi } from "vitest";

import { readRepairEntities } from "../read-entities";

const registry = vi.hoisted(() => ({
  collections: [] as unknown[],
  singles: [] as unknown[],
  fieldGroups: [] as unknown[],
}));

vi.mock("../../../collections/services/collection-registry-service", () => ({
  CollectionRegistryService: class {
    getAllCollections() {
      return Promise.resolve(registry.collections);
    }
  },
}));

vi.mock("../../../singles/services/single-registry-service", () => ({
  SingleRegistryService: class {
    getAllSingles() {
      if (registry.singles.length === 0) {
        return Promise.reject(
          new Error("read a Singles registry with no table")
        );
      }
      return Promise.resolve(registry.singles);
    }
  },
}));

vi.mock("../../../field-groups/services/field-group-registry-service", () => ({
  FieldGroupRegistryService: class {
    getAllComponents() {
      return Promise.resolve(registry.fieldGroups);
    }
  },
}));

const silent = { debug() {}, info() {}, warn() {}, error() {} };

/** An adapter whose database has exactly `tables`, and no ledger or user field definitions. */
function adapterWith(tables: readonly string[]): DrizzleAdapter {
  const present = new Set(tables);
  return {
    tableExists: (name: string) => Promise.resolve(present.has(name)),
  } as unknown as DrizzleAdapter;
}

const read = (tables: readonly string[]) =>
  readRepairEntities({
    adapter: adapterWith(tables),
    dialect: "sqlite",
    config: { collections: [] },
    migrationsDir: "/nonexistent",
    logger: silent,
  });

const kindsAndSlugs = (entities: Awaited<ReturnType<typeof read>>) =>
  entities.map(e => `${e.kind}:${e.slug}`);

describe("readRepairEntities: which registries are read", () => {
  it("skips the Singles registry where its table is missing and reads the others", async () => {
    registry.collections = [
      { slug: "rcposts", tableName: "dc_rcposts", fields: [], source: "ui" },
    ];
    registry.singles = [];
    registry.fieldGroups = [
      { slug: "card", tableName: "comp_card", fields: [], source: "ui" },
    ];
    expect(
      kindsAndSlugs(await read(["dynamic_collections", "dynamic_field_groups"]))
    ).toEqual(["collection:rcposts", "fieldGroup:card"]);
  });

  it("reads the Singles registry where only the collections registry is missing", async () => {
    registry.collections = [
      { slug: "rcposts", tableName: "dc_rcposts", fields: [], source: "ui" },
    ];
    registry.singles = [
      { slug: "home", tableName: "single_home", fields: [], source: "ui" },
    ];
    registry.fieldGroups = [];
    expect(kindsAndSlugs(await read(["dynamic_singles"]))).toEqual([
      "single:home",
    ]);
  });
});
