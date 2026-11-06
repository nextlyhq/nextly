/**
 * A plugin's read of the stored form of an entry's fields, and its write of a
 * field only if the stored value is still the one it read.
 *
 * A plugin that rewrites content site-wide (converting a component's copies
 * into plain blocks, say) reads a field, computes its replacement and writes
 * it. Two things go wrong through the ordinary Direct API:
 *
 * - **What it reads.** A read runs the collection's and the field's `afterRead`
 *   hooks, so a site's hook can hide or reshape the value. The stored value is
 *   still what a page is built from, and what the write replaces.
 * - **When it checks.** A check made before the write's transaction opens
 *   leaves a gap in which an author's save commits and is then overwritten by
 *   a value computed from what was there before it.
 *
 * {@link readStoredFields} answers the first: the stored values, read as the
 * write path reads them, with no read hook. {@link updateIfUnchanged} answers
 * the second: the write path reads the value again inside its own
 * transaction, once it holds the entry's row lock, and refuses the write with
 * a conflict where it no longer hashes to what the plugin read
 * ({@link storedValueHash}). Both are made as the person the plugin acts for
 * and judged by the same gates their ordinary read and update are.
 *
 * @module plugins/stored-fields
 * @experimental
 */

import { z } from "zod";

import {
  registeredReadLanguagesFor,
  registeredWriteLanguagesFor,
  withRuleLanguage,
  type RuleLanguage,
} from "../auth/access/rule-language";
import { readAccessCaller, entityReadFor } from "../auth/entity-read-access";
import type { FieldConfig } from "../collections/fields/types";
import { getService } from "../di";
import { requireNextly } from "../direct-api/nextly";
import {
  expectStoredValue,
  prepareStoredRead,
  readStoredFieldsOn,
  showsUnpublished,
  STORED_FORMS,
  storesJson,
  type StoredFieldsRead,
  type FieldScope,
} from "../domains/collections/services/stored-field-read";
import { appLocalization } from "../domains/i18n/configured-locales";
import { isLocaleSelector } from "../domains/i18n/locale-selector";
import { getFieldType } from "../domains/schema/field-types/field-type-registry";
import { singleDocumentEditable } from "../domains/singles/services/single-document-access";
import { fieldsCarryingReadRules } from "../domains/versions/component-read-access";
import { NextlyError } from "../errors";
import { resolveStatusFilter } from "../lib/status-filter";

import type { PluginStoredValue } from "./contributions";
import type { PluginRouteIdentity } from "./routes/route-types";

/**
 * @experimental The document a stored read or a conditional write names: one
 * entry of a collection, or a Single.
 */
export type PluginStoredDocument =
  | {
      readonly collection: string;
      readonly id: string;
      readonly single?: never;
    }
  | {
      readonly single: string;
      readonly collection?: never;
      readonly id?: never;
    };

/**
 * @experimental The system: trusted server code, such as a plugin's own job
 * that no person started. Judged as a Direct API call made with
 * `overrideAccess: true` is: no access rule, no draft gate and no lifecycle
 * visibility is asked of it, as none is of that call. Everything else holds:
 * the request is parsed alike, the read runs no hook, and a conditional
 * write's expectation is judged under the write's own row lock.
 */
export interface PluginSystemIdentity {
  readonly overrideAccess: true;
  /** The system is no caller: one carrying a user is refused. */
  readonly user?: never;
  readonly authenticatedScope?: never;
}

/**
 * @experimental Who a stored read or a conditional write is made as: a route's
 * caller, as `ctx.caller.identity()` resolved them and judged as their own
 * read or update is, or the system. The two never mix: a caller carrying
 * `overrideAccess` is neither, and is refused.
 */
export type PluginStoredIdentity =
  | (PluginRouteIdentity & { readonly overrideAccess?: never })
  | PluginSystemIdentity;

/** @experimental A read of the stored form of some of a document's fields. */
export type PluginStoredFieldsRequest = PluginStoredDocument & {
  /**
   * The fields to read, each by its name at top level or its path through
   * named groups (`hero.body`). Only these are read and returned.
   */
  readonly fields: readonly string[];
  /**
   * `published` reads the live row. `draft` reads what an editor's preview
   * shows: the pending working draft where there is one, else the live row.
   */
  readonly form: "published" | "draft";
  /**
   * The language to read, for a field stored per language; the default
   * language where none is named, or where the site configures no such
   * language, as an ordinary read resolves it. One language: a selector
   * such as `all` is refused. A language that stores nothing for the field
   * reads as absent, never as another language's value.
   */
  readonly locale?: string;
};

/**
 * @experimental What a stored read found: nothing, where the document is not
 * stored, or each field asked for, by the name or path it was asked by.
 */
export type PluginStoredFields =
  | { readonly kind: "absent" }
  | {
      readonly kind: "found";
      readonly values: Readonly<Record<string, PluginStoredValue>>;
      /**
       * The live row's lifecycle, read with the values in the same snapshot
       * and with no read hook. Answered to the system alone: a person's read
       * leaves it out.
       */
      readonly live?: PluginStoredLifecycle;
    };

/**
 * @experimental A stored document's lifecycle in the language read, as the
 * stored read gives it to the system.
 */
export interface PluginStoredLifecycle {
  /**
   * The live row's state where it is one the workflow calls public, as
   * stored (`published`, or whatever the workflow names a public state);
   * `null` where the row is in another state or the document has no
   * lifecycle. Writing a public row means publishing it again in that state.
   */
  readonly publicState: string | null;
  /** Whether a working draft is pending in the language read. */
  readonly workingDraft: boolean;
}

/**
 * @experimental What a conditional write expects to find stored, judged under
 * the write's own row lock.
 */
export interface PluginWriteExpectation {
  /**
   * The field read, by its top-level name. A field inside a named group is
   * refused: an update writes a group's whole value, so an expectation on one
   * field of it would not guard the siblings the write replaces.
   */
  readonly field: string;
  /** The form it was read in, as {@link PluginStoredFieldsRequest.form}. */
  readonly form: "published" | "draft";
  /** {@link storedValueHash} of the value {@link readStoredFields} returned. */
  readonly hash: string;
  /**
   * Refuse the write where a working draft is pending. Set it on a write that
   * publishes: the publish would put a pending draft live with it, and a draft
   * that leaves this field alone reads the same as the live row.
   */
  readonly noPendingDraft?: boolean;
}

/** @experimental A write of a document's fields, made only if one is unchanged. */
export type PluginConditionalUpdate = PluginStoredDocument & {
  /** The values to write, as an ordinary update takes them. */
  readonly data: Record<string, unknown>;
  /** The language written, and the one the expectation is judged in. */
  readonly locale?: string;
  readonly expect: PluginWriteExpectation;
};

/**
 * The fields a plugin may read the stored form of: those of a plugin field
 * type stored as JSON, which is what a read hook can reshape and a rewrite
 * replaces whole. Built-in types are not (a password's stored hash among
 * them), and neither is a field a field-level read rule governs, since its
 * stored form is not judged per caller here: refused, never answered.
 */
const PLUGIN_JSON_FIELDS: FieldScope = {
  only: "Only fields of a plugin field type stored as JSON, at top level or inside named groups, can be read.",
  admits: field => getFieldType(field.type)?.storage === "json",
  refusal: (entity, topLevel) =>
    fieldsCarryingReadRules(
      entity.kind,
      entity.fields as unknown as FieldConfig[],
      // No component map: a field this scope admits stores no component
      // instance, so only a rule on the field or a group holding it matters.
      new Map(),
      entity.slug
    ).includes(topLevel)
      ? "is governed by a field read rule"
      : undefined,
};

/**
 * The fields the system may read the stored form of: every field stored as
 * JSON, built-in (a repeater, a named group, `json`) or a plugin's. A field
 * read rule does not refuse one, as no field rule is asked of a Direct API
 * read made with `overrideAccess: true`; a field stored any other way still
 * is refused.
 */
const SYSTEM_JSON_FIELDS: FieldScope = {
  only: "Only fields stored as JSON, at top level or inside named groups, can be read.",
  admits: storesJson,
};

/**
 * @experimental The stored form of some of a document's fields, as the
 * person `identity` names may read them, or as the system, with no read hook
 * run.
 *
 * Read as a write path reads them: the live row, or the working draft a
 * preview shows, in one language, with no `afterRead` hook of the collection
 * or of a field and no population. Only the fields named are returned, and
 * each must be of a plugin field type stored as JSON and governed by no
 * field-level read rule; any other is refused by name. The system may read
 * any field stored as JSON, whatever field rule governs it, and is also told
 * the live row's lifecycle (`live`).
 *
 * Judged as their ordinary read is: the person must be able to read the
 * collection or Single, asked of the one read decision through
 * `readAccessCaller`, with a key judged on its own scope. A read rule that
 * allows only the entries a filter matches is refused rather than matched
 * here. The `draft` form shows unpublished work, so it is read only by a
 * person who may update the document, as a preview is. So does a `published`
 * read whose live row, in the language read, is in a state an ordinary read
 * would not show them (one the workflow does not call public): to anyone else
 * it answers `absent`, as the ordinary read answers not found. The system is
 * judged as an `overrideAccess: true` read: none of this, and no field read
 * rule, is asked of it.
 */
export async function readStoredFields(
  identity: PluginStoredIdentity,
  request: PluginStoredFieldsRequest
): Promise<PluginStoredFields> {
  const person = personOf(identity);
  const named = parsedRequest(STORED_READ, request, READ_REFUSAL);
  const document = documentOf(named);
  // The language is resolved once, as the gate's own reads resolve it, and
  // that one code is what the gate is told and what the read queries.
  const language = oneLanguage(named.locale);
  const asked: PluginStoredFieldsRequest = {
    ...targetOf(document),
    fields: named.fields,
    form: named.form,
    ...(language.locale === undefined ? {} : { locale: language.locale }),
  };
  if (person !== undefined) {
    await assertMayRead(person, document, asked, language.rule);
  }

  const read = await storedSnapshot(document, asked, person === undefined);
  if (!read.found) return { kind: "absent" };
  const values = Object.fromEntries(read.values);
  if (person === undefined) {
    return {
      kind: "found",
      values,
      live: {
        publicState: publicStateOf(read.liveState),
        workingDraft: read.workingDraft,
      },
    };
  }
  if (!(await liveFormShown(person, document, asked, read.liveState))) {
    return { kind: "absent" };
  }
  return { kind: "found", values };
}

/**
 * The one language a stored read or a conditional write is made in, resolved
 * as an ordinary read resolves it (`registeredReadLanguagesFor`, with no
 * fallback): a language the site does not configure resolves to its default.
 * A selector naming several languages (`all`, `*`) is refused, since this
 * reads and writes one.
 */
function oneLanguage(requested: string | undefined): {
  readonly rule: RuleLanguage;
  readonly locale: string | undefined;
} {
  if (requested !== undefined && isLocaleSelector(requested)) {
    throw NextlyError.invalidInput({
      message: `A stored read or a conditional write is made in one language, and '${requested}' names more than one.`,
    });
  }
  const rule = registeredReadLanguagesFor(requested, false);
  return { rule, locale: rule.locale };
}

/**
 * The read itself, in one snapshot: the live row's state and every value are
 * read inside one read-only transaction, at REPEATABLE READ on PostgreSQL and
 * MySQL and in SQLite's one transaction at a time, so a write committing
 * between the main row and its language row cannot pair one's state with the
 * other's value. What a read inside a transaction can only remember is
 * settled on the pool first. The system's read takes its own scope, and asks
 * the live state and whether a working draft is pending in the same snapshot.
 */
async function storedSnapshot(
  document: ReturnType<typeof documentOf>,
  request: PluginStoredFieldsRequest,
  asSystem: boolean
): Promise<StoredFieldsRead> {
  const scope = asSystem ? SYSTEM_JSON_FIELDS : PLUGIN_JSON_FIELDS;
  const adapter = getService("adapter");
  const defaultLocale = appLocalization()?.defaultLocale ?? null;
  const target = {
    ...targetOf(document),
    fields: request.fields,
    form: request.form,
    ...(request.locale === undefined ? {} : { locale: request.locale }),
  };
  await prepareStoredRead(
    { db: adapter, executor: undefined, defaultLocale },
    scope,
    target
  );
  return adapter.transaction(
    tx =>
      readStoredFieldsOn(
        { db: tx, executor: tx.getDrizzle(), defaultLocale },
        scope,
        target,
        asSystem
          ? { askState: true, askDraft: true }
          : { askState: !showsUnpublished(request.form) }
      ),
    { isolationLevel: "repeatable read", readOnly: true }
  );
}

/**
 * Whether the live row, in the language read, is one this person would be
 * shown. An ordinary read that names no status shows an untrusted reader the
 * workflow's public states alone, as core's status filter decides; a row in
 * any other state (a draft never published, a translation not yet released)
 * is not found for them. The same holds here, unless the person may update
 * the document, as an editor's own reads may show it. The `draft` form has
 * required that already.
 */
async function liveFormShown(
  identity: PluginRouteIdentity,
  document: ReturnType<typeof documentOf>,
  request: PluginStoredFieldsRequest,
  liveState: string | null | undefined
): Promise<boolean> {
  if (showsUnpublished(request.form) || liveState === undefined) return true;
  const shown = publicStates();
  if (shown === null) return true;
  if (liveState !== null && shown.includes(liveState)) return true;
  return mayEdit(identity, document, request.locale);
}

/**
 * The states the workflow calls public, as core's status filter answers for
 * a reader who may not see unpublished work; `null` where it filters nothing.
 */
function publicStates(): readonly string[] | null {
  return (
    resolveStatusFilter({ collectionHasStatus: true, overrideAccess: false })
      ?.values ?? null
  );
}

/**
 * The live state where it is one {@link publicStates} names; `null` for any
 * other state, a row storing none, or a document with no lifecycle
 * (`undefined`).
 */
function publicStateOf(liveState: string | null | undefined): string | null {
  if (liveState === undefined || liveState === null) return null;
  const shown = publicStates();
  return shown === null || shown.includes(liveState) ? liveState : null;
}

/**
 * @experimental Update a document's fields only if one of them still holds
 * what the plugin read.
 *
 * The update is the ordinary one, made as the person `identity` names under
 * access rules: refused where they may not update the document (or publish
 * it, where `data` publishes). Made as the system, it is an
 * `overrideAccess: true` update, judged by no access rule. The expectation is
 * judged inside the update's own transaction, once it holds the entry's row
 * lock, against the value as committed then; where it no longer hashes to
 * `expect.hash`, or a working draft is pending under `noPendingDraft`, the
 * update is refused with a `CONFLICT` error and changes nothing. Read the
 * document again and decide again.
 *
 * The expectation reads a stored value, so it is first judged as
 * {@link readStoredFields} is: a field that read could not return cannot be
 * the subject of one, and nothing is written. It names a top-level field; a
 * field inside a named group is refused with `INVALID_INPUT`, because an
 * update writes the group's whole value and would replace siblings the
 * expectation never compared.
 */
export async function updateIfUnchanged(
  identity: PluginStoredIdentity,
  update: PluginConditionalUpdate
): Promise<void> {
  const person = personOf(identity);
  const named = parsedRequest(CONDITIONAL_UPDATE, update, WRITE_REFUSAL);
  const expected = expectationOf(named.expect);
  const language = oneLanguage(named.locale);
  if (expected.field.includes(".")) {
    throw NextlyError.invalidInput({
      message: `A conditional write expects a top-level field, and "${expected.field}" is inside a group: an update writes the group's whole value, so an expectation on one field of it would not guard the rest.`,
    });
  }
  const document = documentOf(named);
  // The resolved code, for the read and the update alike, so the update is
  // judged in the very language its expectation was read in.
  const inLocale =
    language.locale === undefined ? {} : { locale: language.locale };
  // The read half first: a precondition, so before anything is written.
  await readStoredFields(identity, {
    ...targetOf(document),
    fields: [expected.field],
    form: expected.form,
    ...inLocale,
  });

  // The expectation travels with this one write: registered against a
  // context object no other call is handed, which the write path receives
  // as its own and its hooks only as a copy.
  const context: Record<string, unknown> = {};
  const pin = { document, expect: expected, checked: false };
  expectStoredValue(context, pin);
  // As the person under access rules, or as the system, which the Direct
  // API's own `overrideAccess: true` call is.
  const as =
    person === undefined
      ? { overrideAccess: true as const, context }
      : {
          user: person.user,
          overrideAccess: false as const,
          context,
          ...(person.authenticatedScope === undefined
            ? {}
            : { actor: person.authenticatedScope }),
        };
  const nextly = requireNextly();
  if (document.kind === "single") {
    await nextly.updateSingle({
      slug: document.slug,
      data: named.data,
      depth: 0,
      ...inLocale,
      ...as,
    });
  } else {
    await nextly.update({
      collection: document.slug,
      id: document.id,
      data: named.data,
      depth: 0,
      ...inLocale,
      ...as,
    });
  }
  // A write that succeeded without its write path judging the expectation
  // was not conditional: said loudly rather than reported as one that was.
  if (!pin.checked) {
    throw NextlyError.internal({
      logContext: {
        reason: "conditional-write-not-judged",
        kind: document.kind,
        slug: document.slug,
      },
    });
  }
}

/**
 * `input` as `schema` parses it, or refused with `INVALID_INPUT` naming what a
 * request of its kind holds. A plugin's call is outside input as far as its
 * types go: plain JavaScript, or an object passed on unchecked, can carry any
 * shape, and a value no branch below expects must be refused here, before any
 * gate is asked or anything is read, rather than read as one it resembles.
 */
function parsedRequest<T>(
  schema: z.ZodType<T>,
  input: unknown,
  refusal: string
): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw NextlyError.invalidInput({ message: refusal });
  return parsed.data;
}

/**
 * The person or key `identity` names, or `undefined` for the system. Parsed at
 * the boundary with the request it comes with: `overrideAccess` is the
 * system's alone, and only as `true`, so a caller carrying one of its own, or
 * anything that is neither, is refused rather than read as either.
 */
function personOf(
  identity: PluginStoredIdentity
): PluginRouteIdentity | undefined {
  if (!STORED_IDENTITY.safeParse(identity).success) {
    throw NextlyError.invalidInput({ message: IDENTITY_REFUSAL });
  }
  return identity.overrideAccess === true ? undefined : identity;
}

const IDENTITY_REFUSAL =
  "A stored read or a conditional write is made as a route's caller, as `ctx.caller.identity()` resolved them, or as the system, `{ overrideAccess: true }`.";

const READ_REFUSAL =
  "A stored read names one document (a collection and an entry id, or a Single, and not both), at least one field, and the form `published` or `draft`.";

const WRITE_REFUSAL =
  "A conditional write names one document (a collection and an entry id, or a Single, and not both), the data to write, and what it expects: a field, the form `published` or `draft` it was read in, and its hash.";

/** The document a parsed request names, as the write path matches it. */
function documentOf(named: {
  readonly single?: string | undefined;
  readonly collection?: string | undefined;
  readonly id?: string | undefined;
}):
  | { readonly kind: "single"; readonly slug: string }
  | {
      readonly kind: "collection";
      readonly slug: string;
      readonly id: string;
    } {
  return named.single !== undefined
    ? { kind: "single", slug: named.single }
    : { kind: "collection", slug: named.collection ?? "", id: named.id ?? "" };
}

/** A parsed expectation, with only the keys it was given. */
function expectationOf(
  expect: z.infer<typeof EXPECTATION>
): PluginWriteExpectation {
  return {
    field: expect.field,
    form: expect.form,
    hash: expect.hash,
    ...(expect.noPendingDraft === undefined
      ? {}
      : { noPendingDraft: expect.noPendingDraft }),
  };
}

/**
 * The one document a request may name: an entry, by its collection and id
 * with no Single beside them, or a Single with neither. Choosing either of a
 * request naming both would read or write a document the caller did not mean.
 */
const AN_ENTRY = {
  collection: z.string().min(1),
  id: z.string().min(1),
  single: z.undefined().optional(),
};
const A_SINGLE = {
  single: z.string().min(1),
  collection: z.undefined().optional(),
  id: z.undefined().optional(),
};

/** A form, one of the forms every branch on a form names. */
const STORED_FORM = z.enum(STORED_FORMS);

/** The rest of a stored read: its fields, form and language. */
const READ_PARTS = {
  fields: z.array(z.string().min(1)).min(1),
  form: STORED_FORM,
  locale: z.string().optional(),
};

/** A whole stored read, parsed as one before anything is asked or read. */
const STORED_READ = z.union([
  z.object({ ...AN_ENTRY, ...READ_PARTS }),
  z.object({ ...A_SINGLE, ...READ_PARTS }),
]);

/** What a conditional write expects, in the form it was read in. */
const EXPECTATION = z.object({
  field: z.string().min(1),
  form: STORED_FORM,
  hash: z.string().min(1),
  noPendingDraft: z.boolean().optional(),
});

/** The rest of a conditional write: its data, language and expectation. */
const UPDATE_PARTS = {
  data: z.record(z.string(), z.unknown()),
  locale: z.string().optional(),
  expect: EXPECTATION,
};

/**
 * Who a stored read or a conditional write is made as: the system exactly, or
 * a caller with a user and no `overrideAccess` of its own.
 */
const STORED_IDENTITY = z.union([
  z.strictObject({ overrideAccess: z.literal(true) }),
  z.looseObject({
    user: z.looseObject({ id: z.string().min(1) }),
    overrideAccess: z.undefined().optional(),
  }),
]);

/** A whole conditional write, parsed as one before anything is asked or read. */
const CONDITIONAL_UPDATE = z.union([
  z.object({ ...AN_ENTRY, ...UPDATE_PARTS }),
  z.object({ ...A_SINGLE, ...UPDATE_PARTS }),
]);

/** A document as a request names it, and nothing else of the request. */
function targetOf(
  document: ReturnType<typeof documentOf>
):
  | { readonly single: string }
  | { readonly collection: string; readonly id: string } {
  return document.kind === "single"
    ? { single: document.slug }
    : { collection: document.slug, id: document.id };
}

/**
 * Refuse a stored read the person may not make: the entity's read decision,
 * and for the `draft` form the document's update gate too.
 */
async function assertMayRead(
  identity: PluginRouteIdentity,
  document: ReturnType<typeof documentOf>,
  request: PluginStoredFieldsRequest,
  language: RuleLanguage
): Promise<void> {
  // Each gate is told the languages its ordinary counterpart is: a read in
  // the one language named, with no fallback, as this read makes none; an
  // update as an update in that language. A rule answering by language then
  // answers here as it does there.
  const read = await withRuleLanguage(language, () =>
    entityReadFor(document.slug, readAccessCaller(identity))
  );
  const refuse = (reason: string) =>
    NextlyError.forbidden({
      logContext: {
        reason,
        kind: document.kind,
        slug: document.slug,
        userId: identity.user.id,
      },
    });
  if (!read.allowed) throw refuse("stored-read-not-readable");
  if (!showsUnpublished(request.form)) return;
  if (!(await mayEdit(identity, document, request.locale))) {
    throw refuse("stored-draft-not-editable");
  }
}

/**
 * Whether the person may update the document, asked of the gate the update
 * itself asks, in the language an update in `locale` is judged in.
 */
function mayEdit(
  identity: PluginRouteIdentity,
  document: ReturnType<typeof documentOf>,
  locale: string | undefined
): Promise<boolean> {
  const inLocale = locale === undefined ? {} : { locale };
  return withRuleLanguage(registeredWriteLanguagesFor(locale), () =>
    document.kind === "single"
      ? singleDocumentEditable(document.slug, {
          user: identity.user,
          routeAuthorized: false,
          ...(identity.authenticatedScope === undefined
            ? {}
            : { actor: identity.authenticatedScope }),
          ...inLocale,
        })
      : getService("collectionsHandler").canUpdateEntry({
          collectionName: document.slug,
          entryId: document.id,
          user: identity.user,
          ...(identity.authenticatedScope === undefined
            ? {}
            : { authenticatedScope: identity.authenticatedScope }),
          ...inLocale,
        })
  );
}
