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
  return [...(await registeredContentKinds()).keys()];
}

/**
 * The same slugs, each paired with the registry that owns it.
 *
 * 🔴 The kind is not decoration. A Single is read through its own service, so a
 * caller that authorizes one as a collection asks about a table that does not
 * hold the document — and deleting a collection leaves its history behind, so a
 * freed slug that a Single later takes leaves version rows whose own scope kind
 * disagrees with the registry. A surface holding only a slug and a recorded kind
 * needs this to tell a live subject from an orphaned one.
 *
 * A name in NEITHER registry is absent rather than defaulted: guessing a kind
 * for it would send a row to a read path that cannot answer about it.
 *
 * Collections are written last, so a slug claimed by both resolves to the
 * collection. The registries do not permit that overlap; stating the precedence
 * keeps this total rather than order-dependent if they ever do.
 */
export async function registeredContentKinds(): Promise<
  Map<string, "collection" | "single">
> {
  const [collections, singles] = await Promise.all([
    collectionSlugs(),
    singleSlugs(),
  ]);
  const kinds = new Map<string, "collection" | "single">();
  for (const slug of singles) kinds.set(slug, "single");
  for (const slug of collections) kinds.set(slug, "collection");
  return kinds;
}
