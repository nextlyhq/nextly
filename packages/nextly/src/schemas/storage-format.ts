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

  /**
   * Suffix identifying a localization companion of a main table.
   *
   * Shared with collection and single tables, like the index prefixes below:
   * the localization layer applies it to every entity kind, so it names no
   * concept and does not move when the concept is renamed.
   */
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

  /**
   * Columns of the one index every component data table carries, in index order.
   *
   * ORDERED deliberately: this arrangement is what serves a lookup by parent id, and a differently
   * ordered index over the same three columns does not. Stated once here because two very different
   * consumers need the same answer — the DDL that CREATES the index, and any check asking whether a
   * live table still has it — and a check that restated the list would agree until one side moved.
   *
   * Deliberately NOT the whole set of indexes a component table can carry: per-field indexes come
   * from the field definitions, and the migrate snapshot builder additionally models a `created_at`
   * index that the table-creating DDL does not emit. This is only the structural one.
   */
  parentIndexColumns: ["_parent_id", "_parent_table", "_parent_field"],

  /** Directory segment recorded in a registry row's `config_path`. */
  configPathDir: "components",

  /**
   * Discriminator written into a stored field definition's `type`.
   *
   * Persisted inside the `fields` JSON of every collection, single and
   * component registry row, and inside `ui-schema.json`, so it is on-disk data
   * rather than an in-memory tag.
   */
  fieldType: "component",

  /**
   * Discriminator naming which component a dynamic-zone instance is.
   *
   * Distinct from `columns.type`: that is the database column, this is the key
   * the same value travels under once it is JSON — entry reads, version
   * snapshots, webhook envelopes, generated types and query filters. The two
   * spell the concept differently and are migrated separately.
   */
  wireTypeKey: "_componentType",

  /**
   * Property names a stored field definition uses to reference components.
   *
   * `single` embeds one named component; `many` is the whitelist a dynamic
   * zone accepts. `legacy` predates both and is still read from rows written
   * by older versions, so it is a read-only compatibility spelling — nothing
   * writes it.
   */
  refKeys: {
    single: "component",
    many: "components",
    legacy: "componentSlug",
  },

  /**
   * The `ui-schema.json` manifest contract.
   *
   * `key` is the top-level array of component definitions and `entityKind` is
   * how one entity announces itself inside that file. Both are read by the
   * Schema Builder and by every CLI path that diffs a manifest, so they change
   * only in lockstep with the file's `version`.
   */
  manifest: {
    key: "components",
    entityKind: "component",
    version: 1,
    schemaUrl: "https://nextlyhq.com/schemas/ui-schema.v1.json",
  },

  /** Scope kind a schema event carries when it concerns a component. */
  schemaEventScope: "component",
} as const;
