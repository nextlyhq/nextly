/**
 * A runtime table cached on another instance follows a change made on this one: a collection's
 * rename, and a Schema Builder save that changes its fields. The other instance is a collection
 * file manager with a cache of its own on the same database, as a second server holds one; a
 * change here moves the schema epoch, and once its interval is up that file manager drops what it
 * cached and rebuilds from the registry as it now is, telling the adapter's table registry of each
 * table it rebuilt.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getTableColumns, getTableName, type Table } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { seedBuilderCollection } from "../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import {
  CollectionFileManager,
  CollectionSchemaCache,
} from "../../../services/collection-file-manager";
import { _resetEnvCache } from "../../../shared/lib/env";
import { collectionMetadataFetcher } from "../../dynamic-collections/services/collection-metadata-fetcher";
import { DynamicCollectionRegistryService } from "../../dynamic-collections/services/dynamic-collection-registry-service";
import { SCHEMA_EPOCH_TTL_MS } from "../../dynamic-collections/services/schema-epoch";

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

let handle: TestNextly | undefined;
let scratch: string | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
  if (scratch) await rm(scratch, { recursive: true, force: true });
  scratch = undefined;
  vi.unstubAllEnvs();
  _resetEnvCache();
});

/** An instance where the Schema Builder runs its DDL, with `authors` and `posts` Builder-made. */
async function builderInstance(dialect: TestDialect): Promise<TestNextly> {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("DB_DIALECT", dialect);
  _resetEnvCache();
  handle = await createTestNextly({ dialect });
  await seedBuilderCollection(handle.adapter, {
    slug: "authors",
    fields: [{ name: "name", type: "text" }],
  });
  await seedBuilderCollection(handle.adapter, {
    slug: "posts",
    fields: [{ name: "title", type: "text" }],
  });
  handle.getService("collectionService");
  return handle;
}

/**
 * Another instance's file manager on the same database: a cache of its own, reading the registry
 * as every file manager does, and recording each table it reports rebuilt.
 */
async function otherInstance(t: TestNextly) {
  scratch = await mkdtemp(join(tmpdir(), "nextly-other-instance-"));
  const cache = new CollectionSchemaCache();
  const rebuilt: Array<{ tableName: string; table: unknown }> = [];
  cache.setRebuiltTableListener((tableName, table) =>
    rebuilt.push({ tableName, table })
  );
  const files = new CollectionFileManager(
    t.adapter.getDrizzle(),
    {
      schemasDir: join(scratch, "schemas"),
      migrationsDir: join(scratch, "migrations"),
    },
    cache
  );
  files.setAdapter(t.adapter);
  files.setMetadataFetcher(collectionMetadataFetcher(t.adapter, silentLogger));
  return { files, rebuilt };
}

/** Past the epoch's interval, the bound on how long another instance serves a stale table. */
const pastTheEpochInterval = () =>
  new Promise(resolve => setTimeout(resolve, SCHEMA_EPOCH_TTL_MS + 100));

const columnsOf = (table: unknown) =>
  Object.keys(getTableColumns(table as Table));

function cases(dialect: TestDialect): void {
  it("stops resolving a collection's old slug once it is renamed elsewhere, and resolves its new one", async () => {
    const t = await builderInstance(dialect);
    const other = await otherInstance(t);
    // The other instance has read `authors`, so holds its table under that slug.
    expect(getTableName(await other.files.loadDynamicSchema("authors"))).toBe(
      "dc_authors"
    );

    await new DynamicCollectionRegistryService(
      t.adapter,
      silentLogger
    ).updateCollectionMetadata("authors", { slug: "writers" });
    await pastTheEpochInterval();

    // No collection is called `authors` any more.
    await expect(other.files.loadDynamicSchema("authors")).rejects.toThrow();
    // `writers` is the renamed collection, in the table it kept.
    expect(getTableName(await other.files.loadDynamicSchema("writers"))).toBe(
      "dc_authors"
    );
  });

  it("rebuilds a collection's table once a Schema Builder save elsewhere changed its fields", async () => {
    const t = await builderInstance(dialect);
    const other = await otherInstance(t);
    expect(
      columnsOf(await other.files.loadDynamicSchema("posts"))
    ).not.toContain("body");

    await dispatchCollections(
      {} as ServiceContainer,
      "applySchemaChanges",
      { collectionName: "posts" },
      {
        fields: [
          { name: "title", type: "text" },
          { name: "body", type: "text" },
        ],
        confirmed: true,
        schemaVersion: 1,
      }
    );
    await pastTheEpochInterval();

    const rebuilt = await other.files.loadDynamicSchema("posts");
    expect(columnsOf(rebuilt)).toContain("body");
    // And the adapter's table registry is handed the same table.
    expect(other.rebuilt).toEqual([{ tableName: "dc_posts", table: rebuilt }]);
  });
}

describe.each(getConfiguredTestDialects())(
  "schema caches follow other instances (integration, %s)",
  dialect => cases(dialect)
);
