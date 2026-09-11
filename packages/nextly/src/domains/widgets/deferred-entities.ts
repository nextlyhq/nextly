/**
 * Content entities whose stored metadata and table are known to DISAGREE.
 *
 * 🔴 The one thing table existence cannot tell you, and the reason existence
 * alone is not enough. A reload writes the new field list to the registry for
 * EVERY configured entity -- the sync payload is built from the whole config
 * and knows nothing about what applied -- while refusing the DDL for an entity
 * whose change it classified unsafe. That entity then keeps its OLD table,
 * which exists, alongside a NEW field list that the table never received.
 *
 * The reload records the other direction here too: an entity whose DDL applied
 * while its metadata write failed keeps the OLD field list over a table that
 * has already moved. A source built from either describes a shape the database
 * does not have.
 *
 * Verified structurally, such an entity publishes a widget source naming
 * columns the database does not have, and a widget query validates against
 * the source and then fails against the table. Withholding it is the older,
 * duller outcome and the right one: a card that is missing is better than a
 * card that errors.
 *
 * This is the "applied-schema signal" that `migration_status` is trying and
 * failing to be. It is deliberately NOT read from that column: the label is
 * also set by writers that never deferred anything, which is what made it
 * unusable in the first place. The reload knows which entities it refused, so
 * it says so directly.
 *
 * One store for both kinds of content, keyed by kind, because the reload
 * decides both in one pass and a collection and a single may share a slug.
 * Pinned to `globalThis` like every other widget store, so it survives the
 * module re-evaluation Next.js and Turbopack perform.
 *
 * @module domains/widgets/deferred-entities
 */

/** The two kinds of content a reload can defer DDL for. */
export type DeferrableEntityKind = "collection" | "single";

const globalForDeferred = globalThis as unknown as {
  __nextly_widgetDeferredEntities?: Map<DeferrableEntityKind, Set<string>>;
};

function store(): Map<DeferrableEntityKind, Set<string>> {
  globalForDeferred.__nextly_widgetDeferredEntities ??= new Map();
  return globalForDeferred.__nextly_widgetDeferredEntities;
}

/** The slugs of one kind whose stored description the reload knows to be wrong. */
export function deferredEntities(
  kind: DeferrableEntityKind
): ReadonlySet<string> {
  return store().get(kind) ?? new Set();
}

/**
 * Record which entities of one kind a reload declined to apply DDL for.
 *
 * Replaces that kind's set rather than adding to it, so an entity whose later
 * reload succeeds stops being deferred without anyone having to remember to
 * clear it. Per kind, because the reload learns whether each kind's metadata
 * sync succeeded separately, and a refusal recorded for a single must not be
 * cleared by a collection sync that says nothing about singles.
 */
export function setDeferredEntities(
  kind: DeferrableEntityKind,
  slugs: readonly string[]
): void {
  store().set(kind, new Set(slugs));
}

/**
 * Forget every kind's refusals, for a boot that is about to establish its own.
 *
 * 🔴 A refusal is a statement about ONE process's reloads, and this store
 * outlives the process's services: it is pinned to `globalThis`, so
 * `clearServices()` and a fresh `registerServices()` left the previous boot's
 * refusals standing. The new boot re-syncs every entity's metadata from the
 * config it was given, so nothing it registers is known to disagree with its
 * table -- and a slug held over from the last boot withheld a source and its
 * generated cards for good, since only a later reload replaces a kind's set.
 *
 * Called from `resetWidgetRegistries`, with the widget and source stores it
 * belongs beside: all three are the same boot's registration, and a reset that
 * took two of them left the third answering for a boot that is over.
 */
export function clearDeferredEntities(): void {
  store().clear();
}
