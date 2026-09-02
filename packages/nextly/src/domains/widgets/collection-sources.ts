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
   * The author's own answer to which field names an entry, under `admin`.
   *
   * Read defensively like the flags below: the row is stored JSON, so the shape
   * is checked at the point of use rather than assumed from the record type.
   */
  admin?: unknown;
  /**
   * The singular/plural display names. Read defensively for the same reason as
   * `admin`: the row is stored JSON.
   */
  labels?: unknown;
  /**
   * The `timestamps` column pair. A required boolean on the stored record and
   * read defensively here, because the two values decide whether
   * `createdAt`/`updatedAt` exist as COLUMNS -- declaring them on a collection
   * that has none makes a query pass validation and fail in the read path.
   */
  timestamps?: unknown;
  /**
   * The Draft/Published `status` column. Read defensively for the same reason
   * `timestamps` is, and carried for the same reason: the flag decides whether
   * `status` exists as a COLUMN, and a source that omits a column the table has
   * refuses a query the read path would have answered.
   */
  status?: unknown;
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
): Array<{ name: string; type: string; label?: string }> {
  const usable: Array<{ name: string; type: string; label?: string }> = [];
  for (const raw of addressableFields(fields, {
    descendInto: storedAtThisLevel,
  })) {
    const field = raw as { name?: unknown; type?: unknown; label?: unknown };
    if (typeof field.name === "string" && typeof field.type === "string") {
      // The label is carried when the field has a usable one, and omitted
      // otherwise -- a blank or whitespace label is not a heading, and passing
      // it on would put an empty column head above real data. `label` is
      // optional on a field config, so its absence is ordinary rather than a
      // fault.
      const label =
        typeof field.label === "string" && field.label.trim() !== ""
          ? field.label
          : undefined;
      usable.push({
        name: field.name,
        type: field.type,
        ...(label && { label }),
      });
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
/**
 * What a human calls this collection, when the stored row carries a usable
 * plural label. PLURAL because a source and its cards name a set of entries.
 */
function pluralLabelOf(collection: RegisteredCollection): string | undefined {
  const labels = collection.labels;
  if (typeof labels !== "object" || labels === null) return undefined;
  const plural = (labels as { plural?: unknown }).plural;
  if (typeof plural !== "string") return undefined;
  // 🔴 TRIMMED, and the trim is what keeps a bad label from taking the install
  // down. `validateSource` refuses a label that is empty AFTER trimming, and
  // `defineCollection` preserves `labels.plural: "   "` as written -- so a
  // check for `!== ""` accepts it, `registerSource` throws, and
  // `refreshCollectionSources` runs on every workspace, layout and widget-query
  // request. One whitespace label would fail all three for everybody.
  //
  // Falling back to the slug rather than passing the trimmed value on: a label
  // of spaces names nothing, and the slug is the answer a collection with no
  // label already gets.
  const trimmed = plural.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * The author's nominated title field, when the stored row carries a usable one.
 *
 * The row is JSON, so `admin` may be anything; a non-string nomination is read
 * as no nomination rather than passed on, because the shared rule would then be
 * comparing a number against a list of field names.
 */
function useAsTitleOf(collection: RegisteredCollection): string | undefined {
  const admin = collection.admin;
  if (typeof admin !== "object" || admin === null) return undefined;
  const nominated = (admin as { useAsTitle?: unknown }).useAsTitle;
  if (typeof nominated !== "string") return undefined;
  // Trimmed for the same reason, though this one fails softly: a nomination of
  // spaces matches no field name, so the shared rule falls back rather than
  // refusing. Normalised anyway, so the two readings of "the author stated
  // nothing" agree.
  const trimmed = nominated.trim();
  return trimmed === "" ? undefined : trimmed;
}

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
        ...(pluralLabelOf(collection) === undefined
          ? {}
          : { label: pluralLabelOf(collection) }),
        ...(useAsTitleOf(collection) === undefined
          ? {}
          : { useAsTitle: useAsTitleOf(collection) }),
        timestamps: collection.timestamps !== false,
        // The opposite default: only an explicit `true` turns Draft/Published
        // on, matching `DynamicCollectionRecord.status` (required, defaults to
        // false) and the `config.status === true` reading every other consumer
        // of this flag takes.
        status: collection.status === true,
      }))
  );
}
