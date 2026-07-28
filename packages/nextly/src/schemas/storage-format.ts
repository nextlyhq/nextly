/**
 * The on-disk spellings for component (field group) storage.
 *
 * Every value here describes data that already exists in deployed databases:
 * table names, the prefix generated names carry, the system columns embedded
 * instances are keyed by, and the discriminators written into stored JSON.
 * Code that creates, addresses, or migrates that storage reads these constants
 * instead of spelling the identifier inline, so the wording cannot drift
 * between the path that writes a table and the path that later reads it.
 *
 * Changing a value here is not an edit — it is a schema migration for every
 * existing database, and only the migration engine may make one. Renaming the
 * concept in the public API does NOT change these; the vocabulary users see and
 * the vocabulary on disk are separate contracts, and they move at different
 * times for exactly that reason.
 *
 * @module schemas/storage-format
 */

export const STORAGE_FORMAT = {
  /** Registry table holding one row per component, including its table name. */
  registryTable: "dynamic_components",

  /** Prefix every generated component table name carries. */
  tablePrefix: "comp_",

  /** Suffix identifying a localization companion of a main table. */
  companionSuffix: "_locales",

  /**
   * System columns on a component data table. Embedded instances carry no
   * foreign key back to their parent; these three string columns plus the
   * ordinal are the whole association, which is why nothing cascades and the
   * teardown sweep has to walk them explicitly.
   */
  columns: {
    parentId: "_parent_id",
    parentTable: "_parent_table",
    parentField: "_parent_field",
    order: "_order",
    /** Type discriminator, written only for dynamic-zone rows. */
    type: "_component_type",
  },

  /**
   * Prefixes for generated index and unique-index names.
   *
   * Shared with collection and single tables rather than owned by components,
   * so they name no concept and do not move when the concept is renamed. They
   * live here because they are still on-disk spellings: changing one renames
   * an index in every existing database.
   */
  indexPrefix: "idx_",
  uniqueIndexPrefix: "uq_",

  /** Directory segment recorded in a registry row's `config_path`. */
  configPathDir: "components",
} as const;

/** The on-disk spelling of a component's type discriminator column. */
export type ComponentTypeColumn = typeof STORAGE_FORMAT.columns.type;
