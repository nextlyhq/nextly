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

import { isFieldGroupField } from "../../collections/fields/guards";
import { isVirtualField } from "../../collections/fields/virtual";
import { NextlyError } from "../../errors";
import { DOCUMENT_VERSION_KEY } from "../../lib/system-columns";
import type { ValidationIssue } from "../../shared/lib/entry-validation";
import type { SanitizedLocalizationConfig } from "../i18n/config/types";
import { isLocaleSelector } from "../i18n/locale-selector";
import { isValidLocale } from "../i18n/resolve-locale";

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

/** What every rewrite names, whether of an entry or of a Single. */
interface FieldRewriteRequestBase {
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

/** @experimental A rewrite of one field of one collection entry. */
export interface FieldRewriteRequest extends FieldRewriteRequestBase {
  readonly collection: string;
  readonly id: string;
}

/** @experimental A rewrite of one field of a Single, which is one document. */
export interface SingleFieldRewriteRequest extends FieldRewriteRequestBase {
  readonly single: string;
}

/**
 * @experimental A rewrite of one field of one document: a collection entry
 * (`collection` and `id`, {@link FieldRewriteRequest}) or a Single (`single`,
 * {@link SingleFieldRewriteRequest}).
 */
export type DocumentFieldRewriteRequest =
  | FieldRewriteRequest
  | SingleFieldRewriteRequest;

/** Whether a request rewrites a Single rather than a collection entry. */
export function rewritesSingle(
  request: DocumentFieldRewriteRequest
): request is SingleFieldRewriteRequest {
  return "single" in request;
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

const REQUEST_FIELDS = {
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
};

const REQUEST = z.union([
  z.strictObject({
    collection: z.string().trim().min(1),
    id: z.string().trim().min(1),
    ...REQUEST_FIELDS,
  }),
  z.strictObject({ single: z.string().trim().min(1), ...REQUEST_FIELDS }),
]);

const REQUEST_REFUSAL =
  "A field rewrite names one entry (`collection` and `id`) or one Single (`single`), one top-level `field`, the `expectedVersion` the entry was read at, the new value as `set: { value }` or `set: { from(current, copy) }`, and a `reason` of at most 4,000 characters; `locale` is optional.";

/**
 * A request as the write path takes it, or `INVALID_INPUT` saying what one
 * holds. A plugin's call is outside input whatever its types say, so the shape
 * is checked here before anything is read.
 */
export function parseFieldRewrite(input: unknown): DocumentFieldRewriteRequest {
  const parsed = REQUEST.safeParse(input);
  if (!parsed.success) {
    throw NextlyError.invalidInput({ message: REQUEST_REFUSAL });
  }
  const request = parsed.data as DocumentFieldRewriteRequest;
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

/**
 * Who a rewrite made through a service's request context is made as. The
 * language is the request's own: a context naming another one would leave two
 * answers to which language is rewritten, so it is refused.
 */
export function rewriteCallerOf<
  C extends {
    locale?: string;
    user?: unknown;
    overrideAccess?: boolean;
    authenticatedScope?: unknown;
    actor?: unknown;
  },
>(
  context: C,
  plugin: string | undefined
): {
  user: C["user"];
  overrideAccess: C["overrideAccess"];
  authenticatedScope: C["authenticatedScope"];
  actor?: NonNullable<C["actor"]>;
  plugin?: string;
} {
  if (context.locale !== undefined) {
    throw NextlyError.invalidInput({
      message:
        "A field rewrite names its language as the request's `locale`, not in the call's options.",
    });
  }
  return {
    user: context.user,
    overrideAccess: context.overrideAccess,
    authenticatedScope: context.authenticatedScope,
    ...(context.actor === undefined || context.actor === null
      ? {}
      : { actor: context.actor }),
    ...(plugin === undefined ? {} : { plugin }),
  };
}

/** The version a request gives, as the update path's version check reads one. */
export function versionBodyOf(
  request: Pick<DocumentFieldRewriteRequest, "expectedVersion">
): Record<string, unknown> {
  return { [DOCUMENT_VERSION_KEY]: request.expectedVersion };
}

/**
 * The language a rewrite of a field reaches: the one named, or the default,
 * for a translated field; none for a shared field, which every language holds
 * alike, so naming one is refused rather than ignored. A language the site
 * does not configure is refused too: written, it would be read as the default,
 * rewriting another language than the one named.
 */
export function rewriteLocaleFor(
  request: Pick<DocumentFieldRewriteRequest, "field" | "locale">,
  translated: boolean,
  localization: SanitizedLocalizationConfig | undefined
): string | undefined {
  if (!translated) {
    if (request.locale !== undefined) {
      throw NextlyError.invalidInput({
        message: `The field "${request.field}" is shared by every language, so a rewrite of it names no locale.`,
      });
    }
    return undefined;
  }
  const locale = request.locale ?? localization?.defaultLocale;
  if (locale === undefined || isLocaleSelector(locale)) {
    throw NextlyError.invalidInput({
      message: `The field "${request.field}" is translated, so a rewrite of it names one language.`,
    });
  }
  if (localization && !isValidLocale(localization, locale)) {
    throw NextlyError.invalidInput({
      message: `Unknown locale '${locale}'. Configured locales: ${localization.locales
        .map(l => l.code)
        .join(", ")}.`,
    });
  }
  return locale;
}

/** What {@link assertRewritableField} reads of a field. */
export interface RewritableFieldShape {
  readonly name?: string;
  readonly type: string;
  /** A group's or repeater's own fields. */
  readonly fields?: readonly RewritableFieldShape[];
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
 *   value swap; nor a group or repeater holding a field group, whose own
 *   rules and type a save judges; nor a password, which no copy holds, or a
 *   field holding one;
 *   nor a virtual field, which nothing stores.
 *
 * @param separatelyStored Whether the write path keeps the field in tables of
 *   its own: the same predicate its own writes split a payload by.
 * @param holdsPassword Whether the field holds a password at any depth, as
 *   the write path's password walk reaches one.
 */
export function assertRewritableField<F extends RewritableFieldShape>(
  fields: readonly F[],
  name: string,
  separatelyStored: (field: F) => boolean,
  holdsPassword: (field: F) => boolean = () => false
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
  // A group or repeater holding a password: a read gives it without the
  // password, so writing it back would drop the stored hash, and a draft
  // would keep a given one as written.
  if (holdsPassword(field)) {
    refuseField(
      name,
      "it holds a password, which a read leaves out and a draft would keep as written."
    );
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
  // A field group held inline in a group or repeater has write rules and a
  // type of its own, which a save judges and records and a value swap
  // doesn't.
  if (holdsFieldGroup(field.fields ?? [])) {
    refuseField(
      name,
      "it holds a field group, whose own rules and type a value swap doesn't judge."
    );
  }
  return field;
}

/** Whether any of `fields`, at any depth, is a field group. */
function holdsFieldGroup(fields: readonly RewritableFieldShape[]): boolean {
  return fields.some(
    field => isFieldGroupField(field) || holdsFieldGroup(field.fields ?? [])
  );
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

/**
 * Refuse a copy's new value with the issues a save's checks found in it, each
 * naming the copy it was for; nothing when there are none.
 */
export function refuseRewrittenValue(
  issues: readonly ValidationIssue[],
  copy: FieldRewriteCopy
): void {
  if (issues.length === 0) return;
  throw NextlyError.validation({
    errors: issues.map(issue => ({
      ...issue,
      message: `${issue.message} (the ${copyWords(copy)})`,
    })),
  });
}

/** A copy as history's payload names it: `live`, `draft` or `draft:<language>`. */
export function copyLabel(copy: FieldRewriteCopy): string {
  if (copy.form === "live") return "live";
  return copy.locale === null ? "draft" : `draft:${copy.locale}`;
}
