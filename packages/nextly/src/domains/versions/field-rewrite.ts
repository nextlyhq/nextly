/**
 * A field rewrite: one field of a document changed on its live copy and on
 * every pending draft that holds it, in one transaction, without a save of
 * either and without publishing anything.
 *
 * A plugin sometimes has to change one value on many documents on nobody's
 * behalf: moving pages off a layout before it is deleted, or turning the
 * copies of a deleted component into plain blocks. An ordinary update can't:
 * on a published document with a pending draft, an update that names no status
 * is held as the draft and never reaches the live copy, and one that names a
 * status publishes the draft. So the job either leaves the live copy naming the
 * old value or publishes an author's unfinished work.
 *
 * This module holds what a rewrite decides alone, whatever it rewrites: what a
 * request is, which fields it may name, which drafts it reaches, and each
 * copy's new value. The write path that holds the document's row lock does the
 * rest.
 *
 * @module domains/versions/field-rewrite
 * @experimental
 */

import { z } from "zod";

import { isVirtualField } from "../../collections/fields/virtual";
import { NextlyError } from "../../errors";
import { DOCUMENT_VERSION_KEY } from "../../lib/system-columns";

import { snapshotRecord } from "./shared-publish-base";
import type { VersionRow } from "./versions-repository";

/**
 * @experimental One copy of a document a rewrite changed: the live copy, or a
 * pending draft (`locale` names a language's draft; `null` the draft every
 * language shares, or the only one a document without languages has).
 */
export type FieldRewriteCopy =
  | { readonly form: "live"; readonly locale: string | null }
  | { readonly form: "draft"; readonly locale: string | null };

/**
 * @experimental The new value of a rewritten field: the value itself, the same
 * for every copy, or a function of each copy's own current value, called once
 * per copy and deciding that copy's value. A function is handed a copy of the
 * stored value (as a version snapshot holds it: a JSON field parsed, a
 * relationship as the id it stores), never the stored object itself.
 */
export type FieldRewriteValue =
  | { readonly value: unknown }
  | {
      // May answer at once or with a promise: a promise is awaited.
      readonly from: (current: unknown, copy: FieldRewriteCopy) => unknown;
    };

/**
 * @experimental A rewrite of one field of one collection entry.
 */
export interface FieldRewriteRequest {
  readonly collection: string;
  readonly id: string;
  /** A top-level field, by name. */
  readonly field: string;
  /**
   * The language a translated field is rewritten in: its live value in that
   * language and that language's draft. Omitted for a shared field, or for
   * a translated one in the default language.
   */
  readonly locale?: string;
  /**
   * The version the caller read the document at (`_rev`, as every read
   * returns it). The rewrite is refused with `STALE_VERSION` unless the
   * document is still at that version: there is no overwrite.
   */
  readonly expectedVersion: string;
  /** The new value, or how to compute it from each copy's own. */
  readonly set: FieldRewriteValue;
  /**
   * Why, in words an editor reading the document's history will understand:
   * kept as the history event's note. Required.
   */
  readonly reason: string;
}

/**
 * @experimental What a rewrite did: the version the document is now at, which
 * a further rewrite or update gives as the one it read, and every copy it
 * changed, the live copy first.
 */
export interface FieldRewriteResult {
  readonly version: string;
  readonly copies: readonly FieldRewriteCopy[];
}

/** The longest reason a rewrite keeps: what the history's note column holds. */
const MAX_REWRITE_REASON = 4000;

const REQUEST = z.strictObject({
  collection: z.string().trim().min(1),
  id: z.string().trim().min(1),
  field: z.string().min(1),
  locale: z.string().min(1).optional(),
  expectedVersion: z.string().min(1),
  set: z.union([
    z.strictObject({ value: z.unknown() }),
    z.strictObject({
      from: z.custom<(...args: never[]) => unknown>(
        value => typeof value === "function"
      ),
    }),
  ]),
  reason: z.string().trim().min(1).max(MAX_REWRITE_REASON),
});

const REQUEST_REFUSAL =
  "A field rewrite names one entry (`collection` and `id`), one top-level `field`, the `expectedVersion` the entry was read at, the new value as `set: { value }` or `set: { from(current, copy) }`, and a `reason` of at most 4,000 characters; `locale` is optional.";

/**
 * A request as the write path takes it, or `INVALID_INPUT` saying what one
 * holds. A plugin's call is outside input whatever its types say, so the shape
 * is checked here before anything is read.
 */
export function parseFieldRewrite(input: unknown): FieldRewriteRequest {
  const parsed = REQUEST.safeParse(input);
  if (!parsed.success) {
    throw NextlyError.invalidInput({ message: REQUEST_REFUSAL });
  }
  const request = parsed.data as FieldRewriteRequest;
  // A rewrite that clears a field gives `null`. A missing value is a mistake
  // (a key misspelled, a variable unset), refused rather than written.
  if (!computesFromCurrent(request.set) && request.set.value === undefined) {
    throw NextlyError.invalidInput({
      message:
        "A field rewrite's `set.value` is the new value; to clear the field, give `null`.",
    });
  }
  if (request.field.includes(".")) {
    throw NextlyError.invalidInput({
      message: `A field rewrite names a top-level field, and "${request.field}" is inside a group: rewrite the group's whole value instead.`,
    });
  }
  return request;
}

/** The version a request gives, as the update path's version check reads one. */
export function versionBodyOf(
  request: Pick<FieldRewriteRequest, "expectedVersion">
): Record<string, unknown> {
  return { [DOCUMENT_VERSION_KEY]: request.expectedVersion };
}

/** What {@link assertRewritableField} reads of a field. */
export interface RewritableFieldShape {
  readonly name?: string;
  readonly type: string;
  readonly unique?: boolean;
  readonly virtual?: boolean;
  readonly hasMany?: boolean;
  readonly options?: { readonly relationType?: string } & Record<
    string,
    unknown
  >;
}

/**
 * The fields a rewrite never names, whatever a collection declares: the ones
 * the system keeps. Each has its own path (a publish, a slug change), and a
 * rewrite that set one would bypass it.
 */
const SYSTEM_FIELDS: ReadonlySet<string> = new Set([
  "id",
  "status",
  "slug",
  "createdAt",
  "updatedAt",
  "created_at",
  "updated_at",
  "firstPublishedAt",
  "first_published_at",
  "_rev",
  "_overwrite",
  "_revision",
]);

function refuseField(field: string, why: string): never {
  throw NextlyError.invalidInput({
    message: `The field "${field}" can't be rewritten: ${why}`,
  });
}

/**
 * The field a rewrite names, or `INVALID_INPUT` saying why it can't be
 * rewritten. A rewrite replaces one value stored on the document's own row
 * (or its language's row) and in each draft:
 *
 * - **not a field the system keeps** (id, status, slug, timestamps);
 * - **not a field whose values must be unique**: uniqueness is checked against
 *   live rows only, and a draft is never checked, so a rewritten value could
 *   collide only at the next publish;
 * - **not a field stored in tables of its own** (a field group's rows, a
 *   many-to-many relationship's join rows), which need row edits rather than a
 *   value swap; nor a password, which no copy holds; nor a virtual field,
 *   which nothing stores.
 *
 * @param separatelyStored Whether the write path keeps the field in tables of
 *   its own: the same predicate its own writes split a payload by.
 */
export function assertRewritableField<F extends RewritableFieldShape>(
  fields: readonly F[],
  name: string,
  separatelyStored: (field: F) => boolean
): F {
  if (SYSTEM_FIELDS.has(name)) {
    refuseField(name, "the system keeps it, and it has a path of its own.");
  }
  const field = fields.find(f => f.name === name);
  if (!field) refuseField(name, "the collection has no field of that name.");
  if (isVirtualField(field)) {
    refuseField(name, "it is virtual, so nothing stores it.");
  }
  if (field.type === "password") {
    refuseField(name, "it is a password, which no copy of a document holds.");
  }
  if (field.unique === true) {
    refuseField(
      name,
      "its values must be unique, and a draft's value is never checked for that."
    );
  }
  if (separatelyStored(field)) {
    refuseField(
      name,
      "it is stored in tables of its own, which a value swap doesn't reach."
    );
  }
  return field;
}

/** One pending draft of a document, as a rewrite reads it. */
export interface DraftSlot {
  /** The language it is kept under; `null` for the shared or only draft. */
  readonly locale: string | null;
  readonly snapshot: Record<string, unknown>;
  /** Who last wrote it, kept when a rewrite saves it: still its author's work. */
  readonly createdBy: string | null;
}

/** Every pending draft a document holds, its snapshot read. */
export function draftSlotsOf(rows: readonly VersionRow[]): DraftSlot[] {
  return rows.map(row => ({
    locale: row.locale ?? null,
    snapshot: snapshotRecord(row.snapshot),
    createdBy: row.createdBy ?? null,
  }));
}

/**
 * The drafts a rewrite of `field` changes: each that holds the field. A shared
 * field is held by every draft that carries the shared values (each language's
 * whole document, or the one shared draft where drafts are kept by part); a
 * translated field only by its language's draft, so another language's draft
 * keeps its own value of it.
 */
export function draftSlotsHolding(
  slots: readonly DraftSlot[],
  field: string,
  translated: { readonly locale: string } | null
): DraftSlot[] {
  return slots.filter(
    slot =>
      Object.hasOwn(slot.snapshot, field) &&
      (translated === null || slot.locale === translated.locale)
  );
}

/**
 * The value a copy takes: the request's value, or its function's answer for
 * that copy's own current value, handed a copy so it can't change the stored
 * one in place.
 */
export async function rewrittenValue(
  set: FieldRewriteValue,
  current: unknown,
  copy: FieldRewriteCopy
): Promise<unknown> {
  const answer = !computesFromCurrent(set)
    ? set.value
    : await set.from(
        current === undefined ? undefined : structuredClone(current),
        copy
      );
  if (answer === undefined) {
    throw NextlyError.invalidInput({
      message: `A field rewrite's \`set.from\` answered nothing for the ${copyWords(copy)}; to clear the field, answer \`null\`.`,
    });
  }
  return answer;
}

/** Whether a new value is computed from each copy's own, rather than given. */
function computesFromCurrent(
  set: FieldRewriteValue
): set is Extract<FieldRewriteValue, { from: unknown }> {
  return "from" in set && typeof set.from === "function";
}

/** A copy in words, for a refusal: "live copy", "draft", "es draft". */
export function copyWords(copy: FieldRewriteCopy): string {
  if (copy.form === "live") return "live copy";
  return copy.locale === null ? "draft" : `${copy.locale} draft`;
}

/** A copy as history's payload names it: `live`, `draft` or `draft:<language>`. */
export function copyLabel(copy: FieldRewriteCopy): string {
  if (copy.form === "live") return "live";
  return copy.locale === null ? "draft" : `draft:${copy.locale}`;
}
