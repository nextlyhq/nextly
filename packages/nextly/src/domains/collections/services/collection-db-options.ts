/**
 * A collection's `db` options: their names, the id types they offer and their
 * shape.
 *
 * A module with no imports, on purpose. The config validator reads it, and
 * `defineCollection` runs the validator inside the client-safe `nextly/config`
 * entry, which a browser bundle may load. The id generator that also reads
 * these options (`collection-id`) imports `node:crypto`, so the vocabulary
 * lives here rather than beside the generator, where reading it would pull a
 * Node built-in into every client graph that defines a collection.
 *
 * @module domains/collections/services/collection-db-options
 * @since 1.0.0
 */

/**
 * The id generators a collection may choose between: one list, which the
 * type below and the config check (`validateCollectionConfig`) both read.
 *
 * There is no `serial`. A collection's id is text, which every relation, API
 * path and admin screen reads, and a database-assigned integer key belongs on
 * a table declared with `col.serial()` instead.
 */
export const COLLECTION_ID_TYPES = ["uuid", "uuidv7"] as const;

/** One of {@link COLLECTION_ID_TYPES}. */
export type CollectionIdType = (typeof COLLECTION_ID_TYPES)[number];

/** The per-collection database options. */
export interface CollectionDbOptions {
  /**
   * Which id a create generates. Defaults to `uuid`.
   *
   * `uuidv7` is time-ordered, so inserts land at the end of the primary-key
   * index rather than scattered through it — the reason a large table wants
   * it. Same 36-character storage either way.
   */
  idType?: CollectionIdType;
  /**
   * Whether a create may supply its own `id`. Defaults to false.
   *
   * False by default because an id the caller chooses is an id the caller can
   * GUESS: a collection whose rows are addressable by a value an attacker
   * picked is a different security question from one whose ids are random,
   * and that has to be opted into rather than inherited.
   */
  allowIdOnCreate?: boolean;
  /**
   * Whether an entry's `slug` may hold several `/`-separated segments, such
   * as `docs/getting-started/install`, so the entry is served at an address
   * beneath another. Defaults to false: a slug is one segment, and a `/` in
   * it is stripped as before.
   *
   * Each segment is normalised as a one-segment slug is, and a slug with an
   * empty segment (`docs//install`), a `.` or `..` segment or a segment that
   * normalises to nothing is refused rather than rewritten, and so is any
   * slug, one segment or several, that names a reserved path (`admin`,
   * `api/...`) or runs past 255 characters. A one-segment slug is otherwise
   * normalised exactly as without the option, and turning it on rewrites no
   * stored address. The value stays one column, so no migration follows.
   *
   * @experimental Settles with multi-segment page addresses.
   */
  slugPaths?: boolean;
}

// Keyed by every option and nothing else, so adding an option to the
// interface without naming it here fails to compile, and the list of names
// below cannot fall behind the shape it describes.
const OPTION_NAMES: Record<keyof CollectionDbOptions, true> = {
  idType: true,
  allowIdOnCreate: true,
  slugPaths: true,
};

/**
 * The names a collection's `db` options may use. Any other name is a
 * misspelling the write path would ignore, so the config check refuses it.
 */
export const COLLECTION_DB_OPTION_NAMES = Object.keys(
  OPTION_NAMES
) as ReadonlyArray<keyof CollectionDbOptions>;
