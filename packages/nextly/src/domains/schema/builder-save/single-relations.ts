/**
 * A Single's many-to-many junction tables and relationship keys, before a
 * save and after it, for the Builder save writer, which writes no junction
 * table itself (`CollectionSave.junctions`, `CollectionSave.keys`). A Single's
 * table holds relationship fields as a collection's does, so its save's
 * migration carries the same statements, read by the same reading, and a
 * migration replayed on a fresh database makes the junctions the Builder made.
 *
 * @module domains/schema/builder-save/single-relations
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { Logger } from "../../../shared/types";

import type { CollectionSave } from "./collection-save";

/** The junction statements and relationship keys a Single's save changes. */
export async function singleRelations(
  adapter: DrizzleAdapter,
  logger: Logger,
  tableName: string,
  before: readonly FieldDefinition[],
  after: readonly FieldDefinition[]
): Promise<{
  junctions: NonNullable<CollectionSave["junctions"]>;
  keys: NonNullable<CollectionSave["keys"]>;
}> {
  // Loaded on demand: the collection service reaches much of the schema
  // machinery, and a static import would pull it into every Single path.
  const { DynamicCollectionService } = await import(
    "../../dynamic-collections/services/dynamic-collection-service"
  );
  return new DynamicCollectionService(adapter, logger).writerRelations(
    tableName,
    [...before],
    [...after]
  );
}
