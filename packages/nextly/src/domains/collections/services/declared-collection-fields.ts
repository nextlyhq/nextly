/**
 * The fields each collection of the running configuration declares, by slug,
 * as the newest start published them.
 *
 * Kept apart from the registry rows, which are what an instance serves: a
 * production start does not write the configuration over them, so a field the
 * configuration declares can be missing from its row and from its table until
 * `nextly migrate` runs. A read or write that fails on a column the database
 * lacks is judged against these as well as the row, so such a field is named
 * as not migrated, as a Single's declared fields are.
 *
 * A module of its own, importing nothing, so the error mapping every entry
 * service uses can read it without loading the registry service.
 *
 * @module domains/collections/services/declared-collection-fields
 */

const declaredFields = new Map<string, readonly unknown[]>();

/**
 * Replace the declared fields with those `collections` declare. A replacement
 * rather than a merge: a collection the configuration no longer declares has
 * none.
 */
export function publishDeclaredCollectionFields(
  collections: ReadonlyArray<{ slug: string; fields?: readonly unknown[] }>
): void {
  declaredFields.clear();
  for (const { slug, fields } of collections) {
    declaredFields.set(slug, fields ?? []);
  }
}

/**
 * The fields the running configuration declares for a collection, or
 * undefined for one it does not declare, such as a Schema Builder collection.
 */
export function declaredCollectionFieldsOf(
  slug: string
): readonly unknown[] | undefined {
  return declaredFields.get(slug);
}
