/**
 * Judging a Single's pending change before it is published.
 *
 * A publish folds a held draft into the live row. Field access and validation
 * run when the caller's payload arrives, and for a publish that payload is
 * just the new status, so without this the draft's content reaches the live
 * row having been judged only when it was SAVED. Two things can have changed
 * since: the publisher may not be the author, so a field rule can deny them a
 * value the author was allowed to write; and the schema can have tightened
 * under a value that was legal when it was held.
 *
 * One module because there are two publish paths. `SingleMutationService`
 * promotes one language's draft on an ordinary publish, and
 * `SinglePublishAllService` promotes every language's in its own loop. Two
 * gates would be two answers to one question, and the second would be the one
 * nobody remembered to update.
 *
 * Called INSIDE the write transaction, on the draft that transaction has
 * locked. Judged before it, the gate can only judge a copy of the world as it
 * was: another writer saving a draft in between, a `beforeChange` hook
 * rewriting the status, or the fold merging several languages onto one row all
 * make the checked document and the written document different documents. The
 * one thing that cannot be done inside the transaction is resolve the caller's
 * grants, which queries the pooled connection the transaction is holding, so
 * that is resolved by the caller beforehand and handed in.
 *
 * @module domains/singles/services/promote-gate
 */

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { AuthenticatedScope } from "../../../auth/authenticated-scope";
import type { FieldConfig } from "../../../collections/fields/types";
import { NextlyError } from "../../../errors";
import type { FieldGroupDataService } from "../../../services/field-groups/field-group-data-service";
import {
  declaredFieldNames,
  keepDeniedAtStored,
  resolvePromotedDocument,
} from "../../../shared/lib/denied-change";
import {
  validateEntryData,
  type EntryWriteContext,
  type ValidationIssue,
} from "../../../shared/lib/entry-validation";
import {
  applyFieldWriteAccess,
  attachFieldValidators,
  type CallerGrants,
} from "../../../shared/lib/field-level-registry";
import { relationshipValidationView } from "../../../shared/lib/field-transform";
import { entryWriteContext } from "../../collections/services/stored-field-read";
import { applyFieldGroupWriteAccessToDocument } from "../../field-groups/field-group-write-access";
import { readComponentSubtrees } from "../../field-groups/read-component-subtrees";
import { fieldGroupWriteAccessOf } from "../../field-groups/services/field-group-mutation-service";
import { referencedFieldGroupFields } from "../../field-groups/storage/field-group-field-type";
import type { CompanionSchema } from "../../i18n/runtime/companion-io";
import {
  type ComponentFieldResolver,
  resolveComponentFieldMap,
  stripSingleComponentTags,
  tagComponentTypes,
} from "../../versions/tag-component-types";

import { readCompanionValuesInTx } from "./apply-pending-change";

/** One language's pending change, as the versions repository stores it. */
export interface PromotableDraft {
  /** The language it is keyed under; `null` for an unlocalized Single. */
  locale: string | null;
  /** The stored snapshot, in write shape. */
  snapshot: unknown;
}

/**
 * Who a Single's promotion is judged for, and the write it is part of, on the
 * promoting transaction. One builder for both publish paths, so the update and
 * `publishAllLocales` cannot come to judge one caller differently.
 */
export function promoteCallerFor(args: {
  tx: TransactionContext;
  slug: string;
  defaultLocale: string | null;
  fields: FieldConfig[];
  /** See {@link PromoteGateContext.componentFields}. */
  componentFields?: ComponentFieldResolver;
  options: {
    user?: Record<string, unknown>;
    overrideAccess?: boolean;
    authenticatedScope?: AuthenticatedScope;
  };
  grants?: () => Promise<CallerGrants>;
}): Pick<
  PromoteGateContext,
  | "slug"
  | "write"
  | "fields"
  | "componentFields"
  | "user"
  | "overrideAccess"
  | "authenticatedScope"
  | "grants"
> {
  return {
    slug: args.slug,
    write: entryWriteContext({
      kind: "single",
      slug: args.slug,
      connection: {
        db: args.tx,
        executor: args.tx.getDrizzle(),
        defaultLocale: args.defaultLocale,
      },
    }),
    fields: args.fields,
    componentFields: args.componentFields,
    user: args.options.user,
    overrideAccess: args.options.overrideAccess,
    authenticatedScope: args.options.authenticatedScope,
    // Resolved on the pooled connection before the transaction opened.
    grants: args.grants,
  };
}

/**
 * A Single's live document for one language, as stored and as the promotion
 * gate judges it: the row this transaction read, that language's translations,
 * and its component subtrees.
 *
 * The components are read because they live in tables of their own. Judged
 * without them, a promotion that carries none, such as a publish with nothing
 * pending, would be refused for a required component it stores, and an
 * optional one would never be judged at all. Read on the transaction, and a
 * read that fails refuses the publish rather than judging less than goes live.
 */
export async function liveStoredDocument(args: {
  tx: TransactionContext;
  row: Record<string, unknown>;
  locale: string | null;
  companion: CompanionSchema | null;
  companionExists: boolean;
  fieldGroupDataService: FieldGroupDataService | undefined;
  parentTable: string;
  fieldConfigs: FieldConfig[];
  slug: string;
}): Promise<Record<string, unknown>> {
  const translations =
    args.companion && args.companionExists && args.locale
      ? await readCompanionValuesInTx(
          args.tx,
          args.companion,
          String(args.row.id),
          args.locale
        )
      : {};
  const components = await readComponentSubtrees({
    fieldGroupDataService: args.fieldGroupDataService,
    tx: args.tx,
    entryId: String(args.row.id),
    parentTable: args.parentTable,
    fieldConfigs: args.fieldConfigs,
    ...(args.locale ? { locale: args.locale } : {}),
    reason: "single-promote-gate-component-read",
    logContext: { slug: args.slug },
    onReadFailure: () => {
      throw NextlyError.internal({
        logContext: {
          cause: "promote-gate-component-read-failed",
          slug: args.slug,
        },
      });
    },
  });
  // Tagged as a pending change holds its components. Judged untagged, every
  // held component differs from the live one by its `_componentType` alone,
  // and a publisher denied the field is refused over a draft that never
  // touched it.
  const service = args.fieldGroupDataService;
  const componentSchemas = service
    ? await resolveComponentFieldMap(args.fieldConfigs, componentSlug =>
        service.getComponentFields(componentSlug, args.tx.getDrizzle())
      )
    : new Map<string, FieldConfig[]>();
  return {
    ...args.row,
    ...translations,
    ...tagComponentTypes(components, args.fieldConfigs, componentSlug =>
      componentSchemas.get(componentSlug)
    ),
  };
}

/** What judging a promotion needs from the service that performs it. */
export interface PromoteGateContext {
  slug: string;
  entryId: string;
  /**
   * The write the promotion is part of, for the field types that judge a value
   * against stored rows. Built on the PROMOTING transaction, for the reason
   * `grants` is resolved before it: a pooled read issued while the transaction
   * holds a connection waits for that connection on a small pool.
   */
  write?: EntryWriteContext;
  fields: FieldConfig[];
  /**
   * The fields of a component by its slug, so the type tags on components
   * nested in other components are found and taken off as well. Without it,
   * only the tags on this Single's own component fields, and those inside its
   * groups and repeaters, are.
   */
  componentFields?: ComponentFieldResolver;
  user?: Record<string, unknown>;
  overrideAccess?: boolean;
  /**
   * The caller's grants, resolved on the pooled connection BEFORE the
   * transaction opened.
   *
   * Resolving them here would issue queries while the transaction holds a
   * connection, and on a small pool those queries wait for the connection the
   * transaction is holding: the publish hangs rather than fails.
   */
  grants?: () => Promise<CallerGrants>;
  /**
   * The scope an API key arrived with, so a key is judged on ITS grants rather
   * than on the database roles of whoever owns it. There is no request-local
   * scope to inherit on the Direct API, so it travels as an argument.
   */
  authenticatedScope?: AuthenticatedScope;
  /**
   * A stored document in the logical shape the rules are written against.
   *
   * A snapshot holds JSON-backed values (a group, a repeater, `chips`, `json`)
   * as the strings that were written, and a validator for those fields expects
   * the object or the array. Judged without this, an ordinary publish of a
   * Single that merely HAS a group field is refused as an invalid type.
   */
  toLogical: (doc: Record<string, unknown>) => Record<string, unknown>;
  /**
   * The live row for one language, as STORED. It is both the base the promoted
   * document is built on and the side a denied field is compared against, so
   * one read answers "what will this row hold" and "is that a change". It goes
   * through `toLogical` here, as the snapshot does, so both are one
   * representation.
   *
   * A read's expanded document is the wrong source: it turns an upload or a
   * relationship into the document behind the identifier, so an untouched
   * field reads as an edit and a publish nobody objected to is refused.
   */
  liveStoredFor: (
    locale: string | null
  ) => Promise<Record<string, unknown> | undefined>;
  /**
   * The caller's own payload, which wins over the draft. Already judged by the
   * gates that run over what the caller sent, and folded in here because the
   * document that gets written is the draft with this on top.
   */
  callerData?: Record<string, unknown>;
  /**
   * The status the promoted document is written with. A snapshot keeps the
   * status it was saved under, which for a pending draft is a draft's, while
   * the write publishes it; a rule that depends on the lifecycle reads this one.
   */
  status: "published";
  localizedFieldNames: Set<string>;
  /**
   * The fields each language holds a value of its own for, judged per
   * language rather than as the last draft's shared value: the translated
   * fields, and a field whose component is translated, since its translated
   * values are written per language. Defaults to `localizedFieldNames`.
   */
  perLanguageFieldNames?: Set<string>;
  enforceLocalizedRequired: boolean;
}

/**
 * Refuse the publish unless the pending changes may be promoted as they stand.
 *
 * The drafts are judged as ONE outcome, not one at a time. `publishAllLocales`
 * applies every language's snapshot to the same main row, so the shared values
 * that survive are the last writer's: judged separately, each draft can pass
 * against its own shared values while the document that actually lands holds
 * another language's. What is judged here is the state the write produces.
 *
 * Throws on the first problem, so nothing is written: a publish applies the
 * whole pending change or none of it.
 */
export async function assertDraftsMayBePromoted(
  drafts: readonly PromotableDraft[],
  ctx: PromoteGateContext
): Promise<void> {
  const issues = await promotionIssues(drafts, ctx);
  if (issues.length > 0) {
    throw NextlyError.validation({
      errors: issues,
      logContext: {
        cause: "promote-invalid-under-current-schema",
        slug: ctx.slug,
      },
    });
  }
}

/**
 * What {@link assertDraftsMayBePromoted} refuses a publish with by the schema,
 * without refusing it: the violations of the first language at fault, or
 * none. A promotion a field rule forbids is still refused by throwing.
 *
 * The one judgement for both: the publish throws on what this returns, and a
 * release's readiness reports it.
 */
export async function promotionIssues(
  drafts: readonly PromotableDraft[],
  ctx: PromoteGateContext
): Promise<ValidationIssue[]> {
  if (drafts.length === 0) return [];

  const logical = drafts.map(draft => ({
    locale: draft.locale,
    values: ctx.toLogical(asRecord(draft.snapshot)),
  }));
  const perLanguage = ctx.perLanguageFieldNames ?? ctx.localizedFieldNames;
  const shared = sharedValues(logical, perLanguage);

  for (const { locale, values } of logical) {
    const live = ctx.toLogical(asRecord(await ctx.liveStoredFor(locale)));
    const promoted = await promotedDocument(
      live,
      shared,
      values,
      perLanguage,
      ctx
    );
    // The document the write will persist, with every field this publisher may
    // not write held at its live value. Validated as THAT document rather than
    // as the one the promotion proposed, so the check and the row agree.
    // Judged without the component type tags. Both sides carry them, so a
    // component compares as unchanged either way, but a field rule and a
    // validator are written against a component's public value, which never
    // holds the tag: shown it, a validator that refuses unknown keys refused
    // the publish of an unchanged Single. The tags stay on the stored draft,
    // which is what the write promotes from.
    const untagged = (document: Record<string, unknown>) =>
      stripSingleComponentTags(document, ctx.fields, ctx.componentFields);
    const resolved = await resolveForLocale(
      untagged(promoted),
      untagged(live),
      locale,
      ctx
    );
    const issues = await schemaIssues(resolved, ctx);
    if (issues.length > 0) return issues;
  }
  return [];
}

/**
 * The shared half of what the write produces. Every language's snapshot is
 * applied to the same main row in this order, so the shared value that
 * survives is the last one written, and that is the value to judge. A
 * translatable field is not shared: it goes to its own language's companion
 * row, so it never takes part in this.
 */
function sharedValues(
  logical: ReadonlyArray<{ values: Record<string, unknown> }>,
  perLanguage: ReadonlySet<string>
): Record<string, unknown> {
  const shared: Record<string, unknown> = {};
  for (const { values } of logical) {
    for (const [key, value] of Object.entries(values)) {
      if (!perLanguage.has(key)) shared[key] = value;
    }
  }
  return shared;
}

/**
 * What one language's row will HOLD once the write lands, which is the only
 * document either check has any business judging.
 *
 * Built on the live row for that language, because a snapshot carries only
 * what its write carried: a localized Single keeps each translation on its own
 * companion row, so a draft that edits one translated field has no property for
 * the others and they stay exactly as they are. Judged without them, a partial
 * draft is refused for missing required siblings the write never touches. A
 * non-localized snapshot is a full copy of the document, so there it overlays
 * everything and this changes nothing.
 *
 * Then the final shared state, then only THIS language's translations, then the
 * caller's payload. Spreading the whole snapshot instead would put back the
 * shared values a later language overwrote and refuse a publish whose
 * committed document is perfectly valid.
 *
 * The caller's payload is laid over the pending change with every denied
 * child of a container it sends at the pending change's value. The update's
 * field gate kept those children at the LIVE row's values, the only stored
 * document it had, and a container the caller sends replaces the pending
 * change's whole: laid over as it is, a pending edit to a child the caller may
 * not write would read as unchanged and be lost rather than refused.
 */
async function promotedDocument(
  live: Record<string, unknown>,
  shared: Record<string, unknown>,
  values: Record<string, unknown>,
  perLanguage: ReadonlySet<string>,
  ctx: PromoteGateContext
): Promise<Record<string, unknown>> {
  const promoted: Record<string, unknown> = { ...live, ...shared };
  for (const [key, value] of Object.entries(values)) {
    if (perLanguage.has(key)) promoted[key] = value;
  }
  if (ctx.callerData) {
    Object.assign(
      promoted,
      await keepDeniedAtStored({
        update: ctx.callerData,
        stored: promoted,
        applyRules: promotionRules(ctx, live),
      })
    );
  }
  // Written with the status it publishes, whatever its snapshot was saved
  // under. Set before the field rules run as well as before validation, so a
  // rule reading the document's status judges the one that goes live.
  promoted.status = ctx.status;
  return promoted;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * The document this language's promotion may write, or a refusal.
 *
 * The rules are applied by {@link resolvePromotedDocument}, which also decides
 * whether a removal is a CHANGE and hands back what to write, shared with the
 * collection publish path so both answer one question one way.
 *
 * Judged on the PROMOTED document rather than on the snapshot that contributed
 * it, because a field rule reads its siblings. A draft whose protected field
 * was allowed while `kind` was `public` can be published in the same breath as
 * `kind: "private"`, and a rule shown the snapshot alone answers for a document
 * that is not the one being written. It cuts the other way too: a shared value
 * one language's snapshot changes and a later language's overwrites never
 * reaches the row, so judging the snapshot refuses an edit the write discards.
 */
async function resolveForLocale(
  promoted: Record<string, unknown>,
  live: Record<string, unknown>,
  locale: string | null,
  ctx: PromoteGateContext
): Promise<Record<string, unknown>> {
  return resolvePromotedDocument({
    before: promoted,
    live,
    // No caller-provenance exemption here, deliberately, and it is the one
    // input this path withholds.
    //
    // Exempting a caller's denied value means writing the CORRECTED document,
    // the one with that value dropped back to live. The collection path writes
    // exactly what this returns, so it can. A Single's promotion writes from
    // the stored snapshot with the caller's payload over it, a different
    // representation from the logical document judged here, so a correction
    // made here would not reach the row and the forbidden value would go live.
    // Refusing is what this path already did, and it is safe: with nothing
    // denied allowed to change, the snapshot's own copy of a denied field
    // already equals live, so writing it changes nothing.
    applyRules: promotionRules(ctx, live),
    // What this Single declares, its field groups' schemas included, so a field
    // named like one of the store's own columns is judged as the content it is
    // rather than skipped as metadata.
    authoredFieldNames: declaredFieldNames(ctx.fields, field =>
      referencedFieldGroupFields(field, slug => ctx.componentFields?.(slug))
    ),
    slug: ctx.slug,
    locale,
  });
}

/**
 * The field rules a promotion is judged by, applied to the document given, in
 * place: the Single's own rules, then every field group's on the instances
 * the document holds, with the schemas this promotion already resolved. A
 * pending change can carry a field-group edit, refused like any other.
 */
function promotionRules(
  ctx: PromoteGateContext,
  live: Record<string, unknown>
): (document: Record<string, unknown>) => Promise<void> {
  return async document => {
    await applyFieldWriteAccess({
      kind: "single",
      slug: ctx.slug,
      data: document,
      operation: "update",
      user: ctx.user,
      authenticatedScope: ctx.authenticatedScope,
      overrideAccess: ctx.overrideAccess,
      grants: ctx.grants,
      id: ctx.entryId,
    });
    await applyFieldGroupWriteAccessToDocument({
      document,
      fields: ctx.fields,
      fieldGroupFields: { get: slug => ctx.componentFields?.(slug) },
      access: { ...fieldGroupWriteAccessOf(ctx), grants: ctx.grants },
      live,
    });
  };
}

/**
 * What the schema no longer accepts in a promotion, naming every field at
 * fault so the author can see what to fix.
 *
 * Judged as a CREATE would be, not as a patch. A patch checks the keys it
 * carries and skips the ones it does not, which is right for a caller sending
 * a few fields and wrong here: a snapshot older than a newly required field
 * simply has no property for it, so patch semantics report nothing and publish
 * a document that violates the contract. The promoted document is the whole
 * document, so it is judged whole.
 *
 * Judged on the document the write produces, which is the live row with this
 * pending change over it. A value the draft does not carry is judged as it
 * already stands: that is what stops a localized Single's untouched
 * translations, which live on the companion row and appear in no snapshot,
 * from reading as missing and refusing a partial draft. It also means a schema
 * tightened under an untouched value refuses the publish rather than
 * committing a row that violates the contract.
 */
async function schemaIssues(
  promoted: Record<string, unknown>,
  ctx: PromoteGateContext
): Promise<ValidationIssue[]> {
  return validateEntryData(
    relationshipValidationView(promoted, ctx.fields),
    attachFieldValidators("single", ctx.slug, ctx.fields),
    {
      mode: "create",
      req: ctx.user ? { user: ctx.user } : {},
      localizedFieldNames: ctx.localizedFieldNames,
      enforceLocalizedRequired: ctx.enforceLocalizedRequired,
      // A component inside a group or repeater is judged here: the component
      // write the promotion runs never reaches it.
      ...(ctx.componentFields === undefined
        ? {}
        : { componentFields: ctx.componentFields }),
      ...(ctx.write === undefined ? {} : { write: ctx.write }),
    }
  );
}
