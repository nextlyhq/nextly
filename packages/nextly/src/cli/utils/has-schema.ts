/**
 * Whether a config declares anything the schema commands act on.
 *
 * `nextly build` and `db:sync` both need this, and both had grown their own
 * spelling of it from the counts each happened to have in scope. They agreed
 * only by coincidence: gating on collections alone is what left a project made
 * of singles or user fields with no generated types, and then with a watcher
 * that never re-synced. One named predicate is what keeps a fifth entity kind
 * from being added to one list and not the other.
 *
 * @module cli/utils/has-schema
 */

/** The parts of a config that decide whether there is work to do. */
export interface SchemaBearingConfig {
  collections?: readonly unknown[];
  singles?: readonly unknown[];
  fieldGroups?: readonly unknown[];
  users?: { fields?: readonly unknown[] };
}

/**
 * True when the config declares at least one entity these commands generate
 * for or materialize. Every kind counts equally: removing the last collection
 * from a project that still has singles does not make it empty.
 */
export function hasSchemaToSync(config: SchemaBearingConfig): boolean {
  return (
    (config.collections?.length ?? 0) > 0 ||
    (config.singles?.length ?? 0) > 0 ||
    (config.fieldGroups?.length ?? 0) > 0 ||
    (config.users?.fields?.length ?? 0) > 0
  );
}
