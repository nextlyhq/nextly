/**
 * The names storage moves to.
 *
 * ## Why this is its own module
 *
 * It is a declaration, not machinery, and it is read by callers that have nothing to do with
 * running a migration — the accessor that reads a stored instance's type has to know the spelling
 * the rename moves toward, so that a database already rewritten still reads.
 *
 * Left inside `manifest.ts` those callers inherit that module's dependencies: `node:crypto`,
 * identifier resolution, the error type. A constant costs nothing to import; a planner does. That
 * matters concretely rather than aesthetically, because one of the callers is reachable from
 * browser code, where a `node:` builtin is not a heavier import but an unresolvable one.
 *
 * `manifest.ts` re-exports this, so every existing importer is unaffected and there is one
 * definition rather than two.
 *
 * The pairing with `schemas/storage-format.ts` is the point of both files: that one is what a
 * database says today, this one is what it says afterwards, and each entry here is the counterpart
 * of an entry there. Both are leaves for the same reason.
 *
 * @module domains/field-groups/migration/target
 */

/**
 * `dynamic_field_groups` is parallel to `dynamic_collections` and `dynamic_singles`. `fg_` is
 * deliberately shorter than the prefix it replaces, so no name that fits an identifier limit today
 * can overflow one by migrating.
 */
export const MIGRATION_TARGET = {
  registryTable: "dynamic_field_groups",
  tablePrefix: "fg_",
  columnType: "_field_group_type",

  /** Directory segment a registry row's `config_path` records. */
  configPathDir: "field-groups",

  /** Discriminator a stored field definition's `type` carries. */
  fieldType: "fieldGroup",

  /**
   * The key a dynamic-zone instance announces its type under once it is JSON.
   *
   * Read by user application code out of a dynamic zone, so this is a public
   * contract and not only an on-disk one. It pairs with `columnType`: the same
   * value, spelled for the database and spelled for the wire.
   */
  wireTypeKey: "_fieldGroupType",

  /**
   * Property names a stored field definition uses to reference a field group.
   *
   * There is no counterpart to `STORAGE_FORMAT.refKeys.legacy`, deliberately.
   * That spelling is read-only compatibility — nothing writes it — so renaming
   * it would mint a fresh obsolete key that nothing writes either. Rows
   * carrying it are normalised onto `single` instead, which retires the concept
   * rather than translating it.
   */
  refKeys: {
    single: "fieldGroup",
    many: "fieldGroups",
  },

  /** Scope kind a schema event carries when it concerns a field group. */
  schemaEventScope: "fieldGroup",
} as const;
