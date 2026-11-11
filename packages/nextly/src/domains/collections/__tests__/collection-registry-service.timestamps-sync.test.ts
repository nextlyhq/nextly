/**
 * A collection's timestamp columns are part of its table, and the schema hash
 * omits them, so the code-first decision compares the switch itself: turning
 * it off in code is a change the registry row must follow, and a stored flag
 * read back as 0/1 is not one.
 */
import { describe, expect, it, vi } from "vitest";

import type { DynamicCollectionRecord } from "../../../schemas/dynamic-collections/types";
import { calculateSchemaHash } from "../../schema/services/schema-hash";
import { CollectionRegistryService } from "../services/collection-registry-service";
import { toCodeFirstCollectionConfig } from "../services/collection-sync-service";

import { silentLogger } from "./collection-test-helpers";

const declared = (timestamps?: boolean) =>
  toCodeFirstCollectionConfig({
    slug: "notes",
    fields: [{ name: "title", type: "text" }],
    ...(timestamps === undefined ? {} : { timestamps }),
  });

/** A registry whose stored row for `notes` matches `declared()` but for `timestamps`. */
function registryHolding(
  timestamps: DynamicCollectionRecord["timestamps"] | number
): CollectionRegistryService {
  const refuse = vi.fn(async () => {
    throw new Error("no storage in this test");
  });
  const adapter = {
    dialect: "sqlite",
    getCapabilities: vi.fn(() => ({ dialect: "sqlite" })),
    selectOne: refuse,
    select: refuse,
    insert: refuse,
    update: refuse,
    delete: refuse,
    executeQuery: refuse,
  };
  const registry = new CollectionRegistryService(
    adapter as never,
    silentLogger as never
  );
  const config = declared();
  const stored = {
    slug: "notes",
    tableName: "dc_notes",
    labels: config.labels,
    fields: config.fields,
    schemaHash: calculateSchemaHash(config.fields),
    admin: config.admin,
    status: false,
    localized: false,
    versions: config.versions,
    revalidate: config.revalidate,
    webhooks: config.webhooks,
    // As SQLite and MySQL read the flag back: a number.
    timestamps,
  } as unknown as DynamicCollectionRecord;
  vi.spyOn(registry, "getCollectionBySlug").mockResolvedValue(stored);
  return registry;
}

describe("the code-first decision on a collection's timestamps", () => {
  it("leaves a row whose stored flag reads back as 1", async () => {
    const plan = await registryHolding(1).planCodeFirstCollections([
      declared(),
    ]);
    expect(plan.unchanged).toEqual(["notes"]);
  });

  it("writes a row whose collection turned its timestamps off", async () => {
    const plan = await registryHolding(1).planCodeFirstCollections([
      declared(false),
    ]);
    expect(plan.updated).toEqual(["notes"]);
  });

  it("writes a row whose collection turned them back on", async () => {
    const plan = await registryHolding(0).planCodeFirstCollections([
      declared(),
    ]);
    expect(plan.updated).toEqual(["notes"]);
  });
});
