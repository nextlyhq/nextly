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

import type { AuthenticatedScope } from "../../../auth/authenticated-scope";
import type { FieldConfig } from "../../../collections/fields/types";
import { NextlyError } from "../../../errors";
import {
  declaredFieldNames,
  resolvePromotedDocument,
} from "../../../shared/lib/denied-change";
import { validateEntryData } from "../../../shared/lib/entry-validation";
import {
  applyFieldWriteAccess,
  attachFieldValidators,
  type CallerGrants,
} from "../../../shared/lib/field-level-registry";
import { relationshipValidationView } from "../../../shared/lib/field-transform";

/** One language's pending change, as the versions repository stores it. */
export interface PromotableDraft {
  /** The language it is keyed under; `null` for an unlocalized Single. */
  locale: string | null;
  /** The stored snapshot, in write shape. */
  snapshot: unknown;
}

/** What judging a promotion needs from the service that performs it. */
export interface PromoteGateContext {
  slug: string;
  entryId: string;
  fields: FieldConfig[];
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
  localizedFieldNames: Set<string>;
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
  if (drafts.length === 0) return;

  const logical = drafts.map(draft => ({
    locale: draft.locale,
    values: ctx.toLogical(asRecord(draft.snapshot)),
  }));

  // The shared half of what the write produces. Every language's snapshot is
  // applied to the same main row in this order, so the shared value that
  // survives is the last one written, and that is the value to judge. A
  // translatable field is not shared: it goes to its own language's companion
  // row, so it never takes part in this.
  const shared: Record<string, unknown> = {};
  for (const { values } of logical) {
    for (const [key, value] of Object.entries(values)) {
      if (!ctx.localizedFieldNames.has(key)) shared[key] = value;
    }
  }

  for (const { locale, values } of logical) {
    // What this language's row will HOLD once the write lands, which is the
    // only document either check has any business judging.
    //
    // Built on the live row for that language, because a snapshot carries only
    // what its write carried: a localized Single keeps each translation on its
    // own companion row, so a draft that edits one translated field has no
    // property for the others and they stay exactly as they are. Judged
    // without them, a partial draft is refused for missing required siblings
    // the write never touches. A non-localized snapshot is a full copy of the
    // document, so there it overlays everything and this changes nothing.
    //
    // Then the final shared state, then only THIS language's translations, then
    // the caller's payload. Spreading the whole snapshot instead would put back
    // the shared values a later language overwrote and refuse a publish whose
    // committed document is perfectly valid.
    const live = ctx.toLogical(asRecord(await ctx.liveStoredFor(locale)));
    const promoted: Record<string, unknown> = { ...live, ...shared };
    for (const [key, value] of Object.entries(values)) {
      if (ctx.localizedFieldNames.has(key)) promoted[key] = value;
    }
    Object.assign(promoted, ctx.callerData ?? {});

    // The document the write will persist, with every field this publisher may
    // not write held at its live value. Validated as THAT document rather than
    // as the one the promotion proposed, so the check and the row agree.
    const resolved = await resolveForLocale(promoted, live, locale, ctx);
    await assertSchemaStillAccepts(resolved, ctx);
  }
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
    applyRules: document =>
      applyFieldWriteAccess({
        kind: "single",
        slug: ctx.slug,
        data: document,
        operation: "update",
        user: ctx.user,
        authenticatedScope: ctx.authenticatedScope,
        overrideAccess: ctx.overrideAccess,
        grants: ctx.grants,
        id: ctx.entryId,
      }),
    // What this Single declares, so a field named like one of the store's own
    // columns is judged as the content it is rather than skipped as metadata.
    authoredFieldNames: declaredFieldNames(ctx.fields),
    slug: ctx.slug,
    locale,
  });
}

/**
 * Refuse a promotion the schema no longer accepts, naming every field at
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
async function assertSchemaStillAccepts(
  promoted: Record<string, unknown>,
  ctx: PromoteGateContext
): Promise<void> {
  const issues = await validateEntryData(
    relationshipValidationView(promoted, ctx.fields),
    attachFieldValidators("single", ctx.slug, ctx.fields),
    {
      mode: "create",
      req: ctx.user ? { user: ctx.user } : {},
      localizedFieldNames: ctx.localizedFieldNames,
      enforceLocalizedRequired: ctx.enforceLocalizedRequired,
    }
  );
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
