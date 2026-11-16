/**
 * A Single's or a field group's junction tables, relationship keys and moved
 * nested field-group rows, before a save and after it, for the Builder save
 * writer, which writes none of them itself (`CollectionSave.junctions`,
 * `CollectionSave.keys`). Their tables hold these fields as a collection's
 * does, so their saves' migrations carry the same statements, read by the same
 * reading (`writerRelations`), and a migration replayed on a fresh database
 * ends as the Builder left it.
 *
 * @module domains/schema/builder-save/single-relations
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { Logger } from "../../../shared/types";

import type { CollectionSave } from "./collection-save";

/** The junction and association statements and relationship keys a save changes. */
export async function entityRelations(
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
