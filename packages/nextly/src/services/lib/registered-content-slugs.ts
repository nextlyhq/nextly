/**
 * Every content entity an install has registered, as slugs to be authorized.
 *
 * The candidate list for any read decision that spans the whole installation
 * rather than one named collection: the dashboard's readable-resources scope
 * asks it, and so does the `system:versions` widget source, which has to bound
 * a cross-document read by what its caller may see.
 *
 * 🔴 Candidates, not an answer. Nothing here decides anything -- each slug still
 * goes to `canReadEntity`, which is what makes the set agree with what a row
 * read would give. Filtering these names by permission SLUGS instead is the
 * mistake `readableEntities` documents: a collection authorized purely in code
 * has no permission row to find, and one REFUSED in code still has the row a
 * slug filter admits it on.
 *
 * A registry that cannot be reached contributes NOTHING rather than an unbounded
 * list. An empty candidate set admits nothing, which is visible and reportable;
 * the alternative is a surface that widens when the container is degraded.
 *
 * @module services/lib/registered-content-slugs
 */

import { container } from "../../di/container";

/** The registered collection slugs, or none when the registry is unreachable. */
async function collectionSlugs(): Promise<string[]> {
  try {
    const collections = await container
      .get<{
        getAllCollections: () => Promise<Array<{ slug: string }>>;
      }>("collectionRegistryService")
      .getAllCollections();
    return collections.map(collection => String(collection.slug));
  } catch {
    // Unreachable registry: contribute nothing rather than guess.
    return [];
  }
}

/** The registered single slugs, or none when the registry is unreachable. */
async function singleSlugs(): Promise<string[]> {
  try {
    const singles = await container
      .get<{
        getAllSingles: () => Promise<Array<{ slug: string }>>;
      }>("singleRegistryService")
      .getAllSingles();
    return singles.map(single => String(single.slug));
  } catch {
    // As above.
    return [];
  }
}

/**
 * The collections and singles this install has registered.
 *
 * Both registries, because a `scopeKind` of `single` names a slug that lives in
 * the second one -- enumerating collections alone would drop every single's
 * documents from a cross-entity read while reporting a smaller number as if it
 * were the whole answer.
 */
export async function registeredContentSlugs(): Promise<string[]> {
  const [collections, singles] = await Promise.all([
    collectionSlugs(),
    singleSlugs(),
  ]);
  return [...collections, ...singles];
}
