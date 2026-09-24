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

/** Read the options off a collection definition, whatever else it carries. */
export function dbOptionsOf(collection: unknown): CollectionDbOptions {
  const db = (collection as { db?: unknown } | undefined)?.db;
  return typeof db === "object" && db !== null ? db : {};
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
export function resolveEntryId(collection: unknown, supplied: unknown): string {
  const options = dbOptionsOf(collection);
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
