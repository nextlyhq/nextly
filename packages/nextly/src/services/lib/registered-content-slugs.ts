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

/** A registry's slugs, and whether they are all of them. */
interface RegistryRead {
  slugs: string[];
  reachable: boolean;
}

/**
 * One registry's slugs, separating "there is no such registry" from "it could
 * not answer".
 *
 * 🔴 Two failures that look identical and mean opposite things, and the split is
 * why they are attempted separately. A registry that is NOT REGISTERED describes
 * an install with none of that kind of content: contributing nothing is the
 * COMPLETE answer, and a caller that refuses on a floor must not refuse here or
 * it refuses forever. A registry that is registered and then THROWS has told us
 * nothing about how much it holds, so its empty result is a floor — and a
 * caller counting or authorizing against it would otherwise treat a transient
 * dependency failure as "there is nothing here".
 *
 * Told apart by which operation failed, not by `container.has`: a container may
 * answer `has` and `get` differently, and taking the presence check as the
 * discriminator emptied the candidate set for every caller rather than only the
 * one asking about degradation.
 */
async function registryRead<T>(
  service: string,
  enumerate: (registry: T) => Promise<Array<{ slug: string }>>
): Promise<RegistryRead> {
  let registry: T;
  try {
    registry = container.get<T>(service);
  } catch {
    // Absent: this install registers no content of that kind, and that is a
    // whole answer rather than a shortfall.
    return { slugs: [], reachable: true };
  }
  try {
    const entries = await enumerate(registry);
    return { slugs: entries.map(entry => String(entry.slug)), reachable: true };
  } catch {
    // Present but unreadable: contribute nothing, and SAY that it is a floor.
    return { slugs: [], reachable: false };
  }
}

/** The registered collection slugs, or none when the registry is unreachable. */
function collectionSlugs(): Promise<RegistryRead> {
  return registryRead<{
    getAllCollections: () => Promise<Array<{ slug: string }>>;
  }>("collectionRegistryService", registry => registry.getAllCollections());
}

/** The registered single slugs, or none when the registry is unreachable. */
function singleSlugs(): Promise<RegistryRead> {
  return registryRead<{
    getAllSingles: () => Promise<Array<{ slug: string }>>;
  }>("singleRegistryService", registry => registry.getAllSingles());
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
 * for it would send a row to a read path that cannot answer about it. The
 * activity log makes that concrete — it files settings mutations under
 * namespaces that are neither a collection nor a single, and its scope column
 * is free text, so a map that defaulted them would hand a settings row to a
 * content read path with nothing to say about it.
 *
 * Collections are written last, so a slug claimed by both resolves to the
 * collection. The registries do not permit that overlap; stating the precedence
 * keeps this total rather than order-dependent if they ever do.
 */
export async function registeredContentKinds(): Promise<
  Map<string, "collection" | "single">
> {
  return (await registeredContentSnapshot()).kinds;
}

/** What one registry enumeration saw, and whether it saw everything. */
export interface ContentRegistrySnapshot {
  kinds: Map<string, "collection" | "single">;
  /**
   * True when a registry could not be reached, so `kinds` is a FLOOR.
   *
   * 🔴 Reported rather than swallowed, because the two callers of this want
   * opposite things from the same failure. An access decision wants the
   * fail-closed empty set: admitting nothing is safe. A COUNT does not — "no
   * documents have pending edits" is a positive claim, and answering it from a
   * registry that could not be enumerated states as fact something never
   * observed. Both readings stay available; neither is imposed here.
   */
  degraded: boolean;
}

/**
 * One enumeration of both registries, with the kinds and the confidence.
 *
 * Resolved ONCE by a caller that makes several decisions from it. Asking again
 * per page let a transient failure answer differently mid-walk: the pages read
 * before it kept their rows, the page during it silently dropped every row it
 * held, and the walk went on to publish the shortfall as a whole number.
 */
export async function registeredContentSnapshot(): Promise<ContentRegistrySnapshot> {
  const [collections, singles] = await Promise.all([
    collectionSlugs(),
    singleSlugs(),
  ]);
  const kinds = new Map<string, "collection" | "single">();
  for (const slug of singles.slugs) kinds.set(slug, "single");
  for (const slug of collections.slugs) kinds.set(slug, "collection");
  return {
    kinds,
    degraded: !collections.reachable || !singles.reachable,
  };
}
