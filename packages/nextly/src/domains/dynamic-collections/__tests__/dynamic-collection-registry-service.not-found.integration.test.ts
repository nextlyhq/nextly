/**
 * What the registry raises when a collection does not exist.
 *
 * 🔴 Pinned against the REAL producer, because a consumer guard was written
 * against the wrong one. `getAccessQueryConstraint` decides "does this
 * collection exist" from this error, and a typed guard asking
 * `NextlyError.isNotFound` silently missed a bare `Error` here -- turning a
 * missing collection into a 500 rather than the 404 the read paths give it. A
 * unit test that mocked the error shape could not see that; only asking the
 * producer can.
 *
 * The MESSAGE is asserted beside the code on purpose: an older caller still
 * matches on that wording, so it is part of the contract until that caller
 * changes too.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it, afterEach, beforeEach } from "vitest";

import { sqliteTableDdl } from "../../../__tests__/fixtures/sqlite-table-ddl";
import { NextlyError } from "../../../errors/nextly-error";
import { dynamicCollectionsSqlite } from "../../../schemas/dynamic-collections/sqlite";
import { DynamicCollectionRegistryService } from "../services/dynamic-collection-registry-service";

type RegistryLogger = ConstructorParameters<
  typeof DynamicCollectionRegistryService
>[1];

const noopLogger: RegistryLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as RegistryLogger;

describe("DynamicCollectionRegistryService — a collection that is not there", () => {
  let sqlite: Database.Database;
  let registry: DynamicCollectionRegistryService;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = OFF");
    for (const statement of sqliteTableDdl(dynamicCollectionsSqlite)) {
      sqlite.exec(statement);
    }

    const db = drizzle({ client: sqlite });
    const adapter = {
      getDrizzle: <T>() => db as T,
      getCapabilities: () => ({
        dialect: "sqlite" as const,
        supportsJsonb: false,
        supportsJson: true,
        supportsArrays: false,
        supportsGeneratedColumns: true,
        supportsFts: true,
        supportsIlike: false,
        supportsReturning: true,
        supportsSavepoints: true,
        supportsOnConflict: true,
        maxParamsPerQuery: 999,
        maxIdentifierLength: 128,
      }),
    } satisfies Pick<DrizzleAdapter, "getDrizzle" | "getCapabilities">;

    registry = new DynamicCollectionRegistryService(
      adapter as unknown as DrizzleAdapter,
      noopLogger
    );
  });

  afterEach(() => {
    sqlite.close();
  });

  it("raises a TYPED not-found, so a guard can ask what it is", async () => {
    await expect(registry.getCollection("ghosts")).rejects.toSatisfy(
      (error: unknown) => NextlyError.isNotFound(error)
    );
  });

  it("keeps the wording an older caller still matches on", async () => {
    // `collection-query-service` maps a read failure to 404 by reading this
    // text. Changing the message while adding the code would have moved the
    // break rather than closed it.
    await expect(registry.getCollection("ghosts")).rejects.toThrow(
      /Collection "ghosts" not found/
    );
  });

  it("CONTROL: a collection that IS there does not raise", async () => {
    sqlite
      .prepare(
        `INSERT INTO dynamic_collections
           (id, slug, table_name, labels, fields, timestamps, status, localized,
            source, locked, schema_hash, schema_version, migration_status,
            created_at, updated_at)
         VALUES ('id-real', 'real', 'dc_real', @labels, '[]', 1, 0, 0,
            'ui', 0, 'h1', 1, 'pending', 1700000000, 1700000000)`
      )
      .run({ labels: JSON.stringify({ singular: "real", plural: "reals" }) });

    await expect(registry.getCollection("real")).resolves.toBeDefined();
  });
});
