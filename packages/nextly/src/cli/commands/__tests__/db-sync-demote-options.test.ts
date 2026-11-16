/**
 * A demoted collection is written to the Schema Builder's registry with every option the
 * code-first sync stores for it: its names, description, table and admin options, and every
 * collection-level option that changes how it behaves, its Draft/Published lifecycle first. So the
 * record is the one the collection had while code owned it, and promoting it again prints the same
 * collection. What a record cannot hold is named before the write.
 *
 * The schema lock is stood in for: what is asserted is the record handed to the registry.
 */
import { describe, expect, it, vi } from "vitest";

import { defineCollection } from "../../../collections/config/define-collection";
import { toCodeFirstCollectionConfig } from "../../../domains/collections/services/collection-sync-service";
import { serializeCollection } from "../../../domains/schema/services/code-generator";
import { resolveVersionsConfig } from "../../../domains/versions/resolve-config";
import type {
  DynamicCollectionInsert,
  DynamicCollectionRecord,
} from "../../../schemas/dynamic-collections";
import type { CollectionRegistryService } from "../../../services/collections/collection-registry-service";
import { createLogger } from "../../utils/logger";
import { demoteCollection, type DemotedCollection } from "../db-sync-demote";
import { promotedCollection } from "../db-sync-promote-collection";

vi.mock("../db-sync-registry", async importOriginal => ({
  ...(await importOriginal<typeof import("../db-sync-registry")>()),
  withCollectionRegistryWrite: (_args: unknown, work: () => Promise<unknown>) =>
    work(),
}));

/** What a demote of `collection` writes, with `existing` the record already registered. */
async function demoted(
  collection: DemotedCollection,
  existing: DynamicCollectionRecord | null = null
) {
  const registered: DynamicCollectionInsert[] = [];
  const updated: Partial<DynamicCollectionInsert>[] = [];
  let shown = "";
  const registry = {
    getCollectionBySlug: async () => existing,
    registerCollection: async (data: DynamicCollectionInsert) => {
      registered.push(data);
      return data;
    },
    updateCollection: async (
      _slug: string,
      data: Partial<DynamicCollectionInsert>
    ) => {
      updated.push(data);
      return data;
    },
  } as unknown as CollectionRegistryService;
  const outcome = await demoteCollection({
    collection,
    logger: createLogger({ quiet: true }),
    registry,
    adapter: {} as never,
    confirm: async code => {
      shown = code;
      return true;
    },
  });
  expect(outcome).toBe("demoted");
  return { registered, updated, shown };
}

/** The one record a demote with nothing registered writes. */
async function registeredFor(
  collection: DemotedCollection
): Promise<DynamicCollectionInsert> {
  const { registered, updated } = await demoted(collection);
  expect(updated).toEqual([]);
  expect(registered).toHaveLength(1);
  return registered[0];
}

const FIELDS = [{ name: "body", type: "text" as const }];

/** A collection as the config defines it. */
function coded(options: Record<string, unknown> = {}): DemotedCollection {
  // Options of every shape, from one table of cases, so the call is not narrowed to one of them.
  return defineCollection({
    slug: "articles",
    fields: FIELDS,
    ...options,
  } as Parameters<typeof defineCollection>[0]) as DemotedCollection;
}

/** The registered record, as the registry reads it back and a promote then prints it. */
function asRecord(insert: DynamicCollectionInsert): DynamicCollectionRecord {
  return {
    id: "record-id",
    schemaVersion: 1,
    migrationStatus: "pending",
    locked: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    timestamps: true,
    status: false,
    localized: false,
    ...insert,
  } as DynamicCollectionRecord;
}

/** The printed code of a promote of `record`, evaluated: an object literal of plain values. */
function promotedFrom(record: DynamicCollectionRecord) {
  const code = serializeCollection(promotedCollection(record));
  return new Function(`return (${code});`)() as Parameters<
    typeof toCodeFirstCollectionConfig
  >[0];
}

describe("a demoted collection's record", () => {
  it("keeps the Draft/Published lifecycle", async () => {
    const record = await registeredFor(coded({ status: true }));
    expect(record.status).toBe(true);
    expect(record.versions).toEqual(resolveVersionsConfig(undefined, true));
  });

  it("keeps the lifecycle when it replaces a record already registered", async () => {
    const existing = asRecord({
      slug: "articles",
      labels: { singular: "Article", plural: "Articles" },
      tableName: "dc_articles",
      fields: [],
      source: "ui",
      schemaHash: "older",
    });
    const { registered, updated } = await demoted(
      coded({ status: true }),
      existing
    );
    expect(registered).toEqual([]);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      status: true,
      versions: resolveVersionsConfig(undefined, true),
      source: "ui",
    });
  });

  it.each([
    ["the lifecycle", { status: true }],
    [
      "drafts kept beside the live row",
      { status: true, versions: { drafts: { autosave: false }, maxPerDoc: 5 } },
    ],
    ["history alone", { versions: true }],
    ["translations", { localized: true }],
    ["no timestamps", { timestamps: false }],
    ["the cache opt-out", { revalidate: { disable: true } }],
    ["the webhook opt-out", { webhooks: { record: false } }],
    ["a table of its own", { dbName: "legacy_articles" }],
    [
      "names, a description and admin options",
      {
        labels: { singular: "Story", plural: "Stories" },
        description: "News and features.",
        admin: {
          group: "Content",
          icon: "FileText",
          useAsTitle: "slug",
          defaultColumns: ["title", "slug"],
          order: 3,
        },
      },
    ],
    ["no options", {}],
  ])(
    "promotes back to the collection it came from: %s",
    async (_what, options) => {
      const collection = coded(options);
      const record = asRecord(await registeredFor(collection));
      expect(toCodeFirstCollectionConfig(promotedFrom(record))).toEqual(
        toCodeFirstCollectionConfig(collection)
      );
    }
  );

  it("writes its fields, names and table", async () => {
    const collection = coded();
    const record = await registeredFor(collection);
    expect(record).toMatchObject({
      slug: "articles",
      labels: collection.labels,
      tableName: "dc_articles",
      source: "ui",
    });
    expect(record.fields.map(field => field.name)).toEqual([
      "title",
      "slug",
      "body",
    ]);
  });
});

describe("a demoted collection's code-only options", () => {
  it("are named before the write, since a record cannot hold them", async () => {
    const { shown } = await demoted(
      coded({
        hooks: { beforeCreate: [() => undefined] },
        indexes: [{ fields: ["body"], unique: true }],
      })
    );
    expect(shown).toContain("hooks, indexes.");
  });

  it("are not mentioned for a collection without any", async () => {
    const { shown } = await demoted(coded());
    expect(shown).not.toContain("Schema Builder cannot hold");
  });
});
