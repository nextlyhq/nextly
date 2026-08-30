/**
 * Which collections a widget may query, taken from the INITIALIZED collection
 * registry.
 *
 * The registry (`dynamic_collections`, read through `collectionRegistryService`)
 * is the one description of an install's collections that holds BOTH schema
 * modes. A code-first collection is synced into it at boot; a collection drawn
 * in the Schema Builder exists only there and has no entry in
 * `transformedConfig.collections` at all. Deriving widget sources from the
 * static config therefore covered exactly one of the framework's two primary
 * ways of defining a collection, and answered "unavailable source" for every
 * Builder-owned one -- while the Direct API read it fine and the dashboard
 * listed it, because both ask this same registry. Same question, one answer.
 *
 * Read at REQUEST time rather than snapshotted at boot. `registerServices()`
 * runs once per process and the registry is not populated when it does: the
 * container entry is registered in Layer 3 and code-first collections are
 * synced into the table in Layer 4, both after the point the widget wiring is
 * reached. Moving the read below them would fix that ordering and leave a
 * second staleness in its place -- the Schema Builder creates collections
 * while the process is running, and a boot snapshot would not see one until
 * the next restart, which in production means the next deploy. A read per
 * batch is the same read `api/dashboard` already performs per request.
 *
 * @module domains/widgets/collection-sources
 */

import { container } from "../../di/container";
import { getNextlyLogger } from "../../observability/logger";
import {
  addressableFields,
  type UnvalidatedContainer,
} from "../../shared/addressable-fields";

import { registerBuiltInSources } from "./built-in-sources";

/**
 * The slice of a `dynamic_collections` row this needs.
 *
 * Structural rather than the imported `DynamicCollectionRecord`, so the widget
 * domain names what it reads instead of depending on the collections domain's
 * whole record shape. `fields` is the author's own field configs, containers
 * included, so it is walked rather than read one level deep -- see
 * `readableFields` for which containers are transparent and why.
 */
interface RegisteredCollection {
  slug?: unknown;
  fields?: unknown;
  /**
   * The `timestamps` column pair. A required boolean on the stored record and
   * read defensively here, because the two values decide whether
   * `createdAt`/`updatedAt` exist as COLUMNS -- declaring them on a collection
   * that has none makes a query pass validation and fail in the read path.
   */
  timestamps?: unknown;
}

interface CollectionRegistrySurface {
  getAllCollections(): Promise<RegisteredCollection[]>;
}

/**
 * Whether an unnamed container's children are stored at ITS level, and so
 * belong in this collection's column list.
 *
 * An unnamed GROUP is layout: its children are stored at the level the group
 * sits in, which is exactly what a widget query addresses. An unnamed REPEATER
 * is not: its children are stored PER ROW, so declaring one would be a promise
 * the read path cannot keep -- the query passes validation and fails on a
 * missing column, the same failure declaring `createdAt` on a collection with
 * `timestamps: false` produces.
 *
 * Decided DURING the walk rather than filtered afterwards, because it cannot be
 * done afterwards: the walk emits the children themselves, so a field reached
 * through an unnamed repeater is the same object as one reached through an
 * unnamed group and ancestry is gone by the time a predicate could read it.
 */
function storedAtThisLevel(container: UnvalidatedContainer): boolean {
  return container.type === "group";
}

/**
 * The fields stored at this collection's own level, with presentational groups
 * flattened, keeping only entries that carry both a name and a type.
 *
 * Uses the shared `addressableFields` walk rather than a second traversal.
 * "Which fields are addressable at this level" is one question with one
 * implementation, and it is the one that already knows a named group stores its
 * children under itself while an unnamed one does not -- the distinction that,
 * missing here, made every field inside an unnamed group unreachable to
 * `select`, `sort` and `where` even though the collection stores it at the top
 * level. That walk is also iterative and cycle-guarded, so a group that
 * contains itself terminates instead of overflowing the stack.
 */
function readableFields(
  fields: unknown
): Array<{ name: string; type: string }> {
  const usable: Array<{ name: string; type: string }> = [];
  for (const raw of addressableFields(fields, {
    descendInto: storedAtThisLevel,
  })) {
    const field = raw as { name?: unknown; type?: unknown };
    if (typeof field.name === "string" && typeof field.type === "string") {
      usable.push({ name: field.name, type: field.type });
    }
  }
  return usable;
}

/**
 * The registry's collections, or `undefined` when it could not be reached.
 *
 * The two outcomes are kept apart deliberately. An install with no collections
 * legitimately answers with an empty list, and a container that is not up yet
 * or a registry read that failed is not an answer at all -- collapsing them
 * would let a transient database failure publish "this install has no
 * collections" and blank every widget on the dashboard.
 */
async function readRegisteredCollections(): Promise<
  RegisteredCollection[] | undefined
> {
  try {
    const registry = container.get<CollectionRegistrySurface>(
      "collectionRegistryService"
    );
    return await registry.getAllCollections();
  } catch (error) {
    getNextlyLogger().error({
      kind: "widget-collection-sources-unavailable",
      err: error instanceof Error ? error.stack : String(error),
    });
    return undefined;
  }
}

/**
 * Rebuild the `collection:` sources from the live registry.
 *
 * On an unreachable registry the previously published sources are LEFT
 * STANDING rather than cleared. That is not a widening: a source declares what
 * a query may NAME, and every execution still runs through the ordinary
 * access-controlled read path with `overrideAccess: false` plus the requesting
 * caller, so a stale entry cannot return a row its caller could not have
 * listed. Clearing on a transient failure, by contrast, turns one bad database
 * read into a dashboard of broken cards.
 */
export async function refreshCollectionSources(): Promise<void> {
  const collections = await readRegisteredCollections();
  if (!collections) return;

  registerBuiltInSources(
    collections
      .filter(
        (collection): collection is RegisteredCollection & { slug: string } =>
          typeof collection.slug === "string" && collection.slug !== ""
      )
      .map(collection => ({
        slug: collection.slug,
        fields: readableFields(collection.fields),
        // Only an explicit `false` turns them off; absent means on, the way
        // `defineCollection` normalizes it and the registry stores it.
        timestamps: collection.timestamps !== false,
      }))
  );
}
