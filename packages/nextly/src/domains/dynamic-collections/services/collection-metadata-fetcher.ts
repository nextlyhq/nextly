/**
 * The collection metadata a collection file manager builds a runtime schema and a translations
 * table from, read as `DynamicCollectionRegistryService.getCollection` reads a registry row: from
 * the row cache outside a transaction, so a read that loads its translations table pays no
 * registry round trip of its own, and on the caller's transaction connection inside one,
 * uncached, so it sees its own writes. Every file manager is handed this one, so they all answer
 * a collection the same way.
 *
 * @module domains/dynamic-collections/services/collection-metadata-fetcher
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../errors/nextly-error";
import type { CollectionMetadataFetcher } from "../../../services/collection-file-manager";
import type { Logger } from "../../../shared/types";

import { DynamicCollectionRegistryService } from "./dynamic-collection-registry-service";

export function collectionMetadataFetcher(
  adapter: DrizzleAdapter,
  logger: Logger
): CollectionMetadataFetcher {
  const registry = new DynamicCollectionRegistryService(adapter, logger);
  return async (collectionName, executor) => {
    try {
      const row = (await registry.getCollection(collectionName, executor)) as {
        fields: unknown;
        tableName: string;
        status: boolean;
        localized: boolean;
      };
      return {
        fields:
          typeof row.fields === "string" ? JSON.parse(row.fields) : row.fields,
        tableName: row.tableName,
        // Normalized to booleans by `getCollection` on every dialect.
        status: row.status === true,
        // Forwarded so the file manager builds the translations table of a localized collection.
        localized: row.localized === true,
      };
    } catch (error) {
      // A collection the registry does not hold has no metadata: not a failure.
      if (!NextlyError.isNotFound(error)) {
        logger.error("Failed to fetch collection metadata", {
          collection: collectionName,
          error,
        });
      }
      return null;
    }
  };
}
