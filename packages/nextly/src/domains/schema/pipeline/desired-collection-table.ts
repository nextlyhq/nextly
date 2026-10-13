/**
 * The table a desired collection describes.
 *
 * Three readers turn a `DesiredCollection` into the table the diff compares
 * against: the apply, the schema preview and the hot reload's per-collection
 * change gate. Each used to build it on its own, and each forwarded its own
 * subset of the entry: the apply passed the collection's declared `indexes`,
 * the other two did not. So a preview showed a migration-created index as
 * one to drop, and a reload that only added an index found nothing to do.
 * Building it here, once, keeps every key an entry carries in all three.
 *
 * What hooks contribute to the table is not applied here. The apply merges it
 * against the live table it introspected, which only the apply holds.
 *
 * @module domains/schema/pipeline/desired-collection-table
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { buildDesiredTableFromFields } from "./diff/build-from-fields";
import type { TableSpec } from "./diff/types";
import { builtByFor } from "./registered-collections";
import type { DesiredCollection } from "./types";

export function desiredCollectionTable(
  collection: DesiredCollection,
  dialect: SupportedDialect
): TableSpec {
  return buildDesiredTableFromFields(
    collection.tableName,
    // FieldConfig has the shape buildDesiredTableFromFields reads; cast through
    // unknown for the structural-vs-nominal type gap.
    collection.fields as unknown as Parameters<
      typeof buildDesiredTableFromFields
    >[1],
    dialect,
    {
      builtBy: builtByFor("collection", collection.builderOwned),
      // The status system column exists only while Draft/Published is on.
      hasStatus: collection.status === true,
      // A localized collection's translatable columns live in its `_locales`
      // companion, so they are left off the main table.
      localized: collection.localized === true,
      // Config-declared compound indexes, which name FIELDS.
      indexes: [...(collection.indexes ?? [])],
    }
  );
}
