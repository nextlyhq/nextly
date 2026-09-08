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
   * How far this collection's table has got, as a LABEL rather than as the
   * answer. See {@link statusClaimsPresent} for what it may be believed about,
   * and {@link usableCollections} for the question that actually decides.
   */
  migrationStatus?: unknown;
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
): Array<{ name: string; type: string; label?: string; hasMany?: boolean }> {
  const usable: Array<{
    name: string;
    type: string;
    label?: string;
    hasMany?: boolean;
  }> = [];
  for (const raw of addressableFields(fields, {
    descendInto: storedAtThisLevel,
  })) {
    const field = raw as {
      name?: unknown;
      type?: unknown;
      label?: unknown;
      hasMany?: unknown;
    };
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
        // 🔴 CARDINALITY, carried rather than dropped. A `text` or `select`
        // field with `hasMany` stores an ARRAY, and a scalar type is not the
        // same claim as a scalar value -- so a title chosen on type alone can
        // still resolve to an array, which the row renderer declines to print.
        ...(field.hasMany === true && { hasMany: true }),
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
 * Whether the STATUS LABEL claims this collection's table is present.
 *
 * 🔴 A label, not the answer. `migration_status` is written by several code
 * paths and they do not agree: the HMR reload marks an edited collection
 * `pending` after successfully applying its DDL, and `nextly migrate` applies a
 * Builder collection's SQL in production without marking anything at all --
 * `registerFromMigrations`, the one writer that records `applied`, runs only
 * from the development boot path. So a table that is present and queryable can
 * carry a label saying it is not, permanently.
 *
 * This is therefore kept as the FAST PATH only, and {@link usableCollections}
 * asks the structural question when the label declines. The distinction is the
 * repository's own rule about identifying by structure rather than by someone
 * else's spelling: the label is a claim maintained by writers this module does
 * not control, while the table's existence is the thing itself.
 *
 * The allowlist is what the label may be BELIEVED about, and it is deliberately
 * one-directional. `synced` and `applied` are trusted outright: a writer that
 * went to the trouble of recording one had the table in hand, so a false
 * positive here would need a writer lying rather than merely falling behind,
 * and no path does that. `pending`, `generated` and `failed` are trusted for
 * NOTHING -- they mean only that no writer has said otherwise yet, which is a
 * statement about the writers rather than about the database.
 *
 * That asymmetry is what makes the fast path safe to take. A label claiming
 * presence ends the question; a label declining is referred to the database.
 *
 * An ABSENT status is treated as usable, which is the one place this reads
 * generously rather than closed. The field was added after rows existed, so a
 * row predating it says nothing about its table — and those tables do exist.
 * Refusing them would take widgets away from every collection an older install
 * already had, to protect against a state they are not in.
 */
const TABLE_PRESENT_STATUSES: ReadonlySet<string> = new Set([
  "synced",
  "applied",
]);

function statusClaimsPresent(collection: RegisteredCollection): boolean {
  const status = (collection as { migrationStatus?: unknown }).migrationStatus;
  if (status === undefined) return true;
  return typeof status === "string" && TABLE_PRESENT_STATUSES.has(status);
}

/**
 * Collections whose stored metadata is known to be AHEAD of their table.
 *
 * 🔴 The one thing table existence cannot tell you, and the reason existence
 * alone is not enough. A reload writes the new field list to
 * `dynamic_collections` for EVERY configured collection -- the sync payload is
 * built from the whole config and knows nothing about what applied -- while
 * refusing the DDL for a collection whose change it classified unsafe. That
 * collection then keeps its OLD table, which exists, alongside a NEW field list
 * that the table never received.
 *
 * Verified structurally, such a collection publishes a source naming columns
 * the database does not have, and a widget query validates against the source
 * and then fails against the table. Withholding it is the older, duller outcome
 * and the right one: a card that is missing is better than a card that errors.
 *
 * This is the "applied-schema signal" that `migration_status` is trying and
 * failing to be. It is deliberately NOT read from that column: the label is
 * also set by writers that never deferred anything, which is what made it
 * unusable in the first place. The reload knows which collections it refused,
 * so it says so directly.
 */
const globalForDeferred = globalThis as unknown as {
  __nextly_widgetDeferredCollections?: Set<string>;
};

function deferredCollections(): ReadonlySet<string> {
  return globalForDeferred.__nextly_widgetDeferredCollections ?? new Set();
}

/**
 * Record which collections a reload declined to apply DDL for.
 *
 * Replaces the set rather than adding to it, so a collection whose later reload
 * succeeds stops being deferred without anyone having to remember to clear it.
 */
export function setDeferredCollections(slugs: readonly string[]): void {
  globalForDeferred.__nextly_widgetDeferredCollections = new Set(slugs);
}

/**
 * The collections a widget source may be built from.
 *
 * 🔴 NEITHER refusal probes the database, and the omission is deliberate.
 * Whether a collection's stored shape is LIVE is a schema question, and
 * answering it here means re-deriving something this module does not own. Three
 * properties make that unattractive:
 *
 * - Table EXISTENCE is the wrong question. A reload that refuses a collection's
 *   DDL writes its new field list anyway, so the OLD table stands beside NEW
 *   metadata, and a source published on existence alone names columns that were
 *   never created.
 * - A probe is dialect-sensitive. `listTables` resolves against `public`, while
 *   unqualified DML follows the whole search path -- which is why `tableExists`
 *   reaches for `to_regclass` instead.
 * - The property that WOULD decide -- whether the physical columns cover the
 *   fields this source declares -- needs a field-to-column mapping that already
 *   has several implementations in this repository awaiting convergence. A
 *   fourth, partial one, owned by the widget domain, answers none of that.
 *
 * So this asks only what it can answer from what it holds:
 *
 * - `statusClaimsPresent` believes a label that CLAIMS presence and believes
 *   nothing from one that declines. Its weakness is a false NEGATIVE: a
 *   deployed Builder collection whose migration ran but whose row nobody marked
 *   keeps its cards hidden. A hidden card is quiet and recoverable; a card
 *   querying a column the table lacks is neither.
 * - {@link setDeferredCollections} covers what the label cannot -- a reload that
 *   refused a collection's DDL while its metadata was written regardless.
 *
 * That false negative is a defect in the WRITERS of `migration_status`, and it
 * is closed by making them correct rather than by second-guessing them here.
 */
function usableCollections<T extends RegisteredCollection>(
  collections: T[]
): T[] {
  const deferred = deferredCollections();
  return collections.filter(
    collection =>
      !(typeof collection.slug === "string" && deferred.has(collection.slug)) &&
      statusClaimsPresent(collection)
  );
}

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

  const named = collections.filter(
    (collection): collection is RegisteredCollection & { slug: string } =>
      typeof collection.slug === "string" && collection.slug !== ""
  );

  registerBuiltInSources(
    usableCollections(named).map(collection => ({
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
