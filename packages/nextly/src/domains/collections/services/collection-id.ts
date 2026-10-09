/**
 * Which id a new entry gets, and whether the caller may choose it.
 *
 * Both are per-collection decisions Payload exposes and Nextly did not: the
 * id GENERATOR (`db.idType`) and whether a create may carry one
 * (`db.allowIdOnCreate`). Kept together because they are two halves of one
 * question — a collection that accepts a client id has to validate it as the
 * kind of id it would have generated, or the two sources produce ids of
 * different shapes in one table.
 *
 * Storage is deliberately untouched: both kinds are 36 characters, so the
 * column stays varchar(36)/text and every relation pointing at it is
 * unaffected. The choice is about the VALUE, which is why it needs no
 * migration.
 *
 * @module domains/collections/services/collection-id
 * @since 1.0.0
 */
import { randomUUID } from "node:crypto";

import { NextlyError } from "../../../errors/nextly-error";
import { uuidV7 } from "../../../utils/uuid-v7";

/** The id generators a collection may choose between. */
export type CollectionIdType = "uuid" | "uuidv7";

/** The per-collection database options this module reads. */
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
}

/** Any UUID, as the two generators both produce. */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-([1-8])[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// The options each code-first collection declares, keyed by slug.
//
// Held in memory rather than on the registry row because the code config is
// their only source: it is loaded on every boot, reload and CLI run, and a
// Builder collection has no way to set them. Each lifecycle publishes them
// once, from its own config, at the point that config takes effect: boot in
// `registerServices`, an HMR reload when it commits (and puts the previous set
// back when it is refused). The registry sync does not publish them — it runs
// mid-reload, before the reload knows whether it will land. A write reads the
// options the running config declares rather than a copy that could fall
// behind it.
//
// On `globalThis` for the reason the webhook recording policy is: Next.js can
// evaluate this module in more than one server module graph, and a
// module-local map would let the sync populate one instance while the write
// path reads another — where an empty entry silently means UUIDv4 and a
// discarded client id.
const globalForDbOptions = globalThis as unknown as {
  __nextly_collectionDbOptions?: Map<string, CollectionDbOptions>;
};
if (!globalForDbOptions.__nextly_collectionDbOptions) {
  globalForDbOptions.__nextly_collectionDbOptions = new Map();
}
const publishedDbOptions = globalForDbOptions.__nextly_collectionDbOptions;

/**
 * The published options, as the entries `publishCollectionDbOptions` takes.
 *
 * For a caller that publishes provisionally and may have to put the previous
 * set back — an HMR reload that is later refused keeps the previous config,
 * and with it the previous options.
 */
export function publishedCollectionDbOptions(): Array<{
  slug: string;
  db: CollectionDbOptions;
}> {
  return [...publishedDbOptions].map(([slug, db]) => ({ slug, db }));
}

/**
 * Replace the published options with those the given collections declare.
 *
 * A replacement rather than a merge: a collection whose `db` block was removed
 * from the config, or that is gone altogether, must stop being read with its
 * old options on the next write.
 */
export function publishCollectionDbOptions(
  collections: Iterable<{ slug: string; db?: CollectionDbOptions }>
): void {
  publishedDbOptions.clear();
  for (const { slug, db } of collections) {
    if (db !== undefined) publishedDbOptions.set(slug, db);
  }
}

/**
 * The options a collection's writes follow: what its code config declares, or
 * none — the defaults — for a collection that declares none, which includes
 * every collection built in the admin.
 */
export function collectionDbOptions(slug: string): CollectionDbOptions {
  return publishedDbOptions.get(slug) ?? {};
}

/** The id a new entry gets on this collection. */
export function generateEntryId(options: CollectionDbOptions): string {
  return options.idType === "uuidv7" ? uuidV7() : randomUUID();
}

/**
 * The id a create should use: the caller's when it is allowed and valid,
 * otherwise a fresh one.
 *
 * A supplied id on a collection that did not opt in is IGNORED rather than
 * refused, which is what `stripImmutableSystemFields` already does to every
 * other client-supplied system column — refusing would make an ordinary
 * round-trip (read an entry, edit it, post it back) fail on a field the
 * caller never meant to set.
 */
export function resolveEntryId(
  /** The collection's options; see `collectionDbOptions`. */
  options: CollectionDbOptions,
  supplied: unknown
): string {
  if (options.allowIdOnCreate !== true) return generateEntryId(options);
  if (supplied === undefined || supplied === null) {
    return generateEntryId(options);
  }
  return assertSuppliedId(supplied, options);
}

/**
 * Validate a client-supplied id as the kind this collection generates.
 *
 * Checked rather than trusted because the column is the primary key and every
 * relation resolves through it: a value that is not a UUID would be stored,
 * returned, and then fail to match anything a UUID-shaped filter looks for.
 * The VERSION is checked too — a collection that chose time-ordered ids to
 * keep its index append-only gains nothing if callers may insert random ones.
 */
function assertSuppliedId(
  supplied: unknown,
  options: CollectionDbOptions
): string {
  const wanted = options.idType === "uuidv7" ? "7" : "4";
  const match = typeof supplied === "string" ? UUID.exec(supplied) : null;
  if (match === null || match[1] !== wanted) {
    throw NextlyError.validation({
      errors: [
        {
          path: "id",
          code: "INVALID",
          message: `id must be a UUIDv${wanted}.`,
        },
      ],
      logContext: { reason: "client-supplied-id-invalid" },
    });
  }
  return supplied as string;
}
