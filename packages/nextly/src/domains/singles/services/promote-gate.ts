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

import { isDeepStrictEqual } from "node:util";

import type { AuthenticatedScope } from "../../../auth/authenticated-scope";
import type { FieldConfig } from "../../../collections/fields/types";
import { NextlyError } from "../../../errors";
import { detachData } from "../../../shared/lib/detach";
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
   * The live row for one language, as STORED, used to decide whether promoting
   * a denied field would change anything. It goes through `toLogical` here, as
   * the snapshot does, so both sides of the comparison are one representation.
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
    // The final shared state with only THIS language's translations over it,
    // then the caller's payload. Spreading the whole snapshot here instead
    // would put back the shared values a later language overwrote, and refuse
    // a publish whose committed document is perfectly valid.
    const promoted: Record<string, unknown> = { ...shared };
    for (const [key, value] of Object.entries(values)) {
      if (ctx.localizedFieldNames.has(key)) promoted[key] = value;
    }
    Object.assign(promoted, ctx.callerData ?? {});

    await assertNoDeniedChange(values, locale, ctx);
    await assertSchemaStillAccepts(promoted, ctx);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Refuse a promotion that would change a field this publisher may not write.
 *
 * Refused rather than stripped, which is the opposite of what a denied field
 * gets on an ordinary write. There, the value is the caller's own input and
 * dropping it costs them nothing they did not already have. Here the value
 * belongs to whoever saved the draft, and a successful publish CONSUMES the
 * pending change: stripping would publish everything else, delete the draft,
 * and take that author's edit with it, reporting success. Refusing keeps the
 * draft for someone who can write the field.
 *
 * Judged in STORED shape, on both sides, and on what would CHANGE rather than
 * on what the snapshot holds: a snapshot is a full copy of the document, so a
 * denied field appears in every one of them, and only a value that differs
 * from what is live is a change being made.
 */
async function assertNoDeniedChange(
  logicalSnapshot: Record<string, unknown>,
  locale: string | null,
  ctx: PromoteGateContext
): Promise<void> {
  // A deep copy, because the rules delete a denied value in place and a
  // shallow one shares every nested group, repeater row and component with the
  // original: the deletion would land on both, and the comparison below would
  // then see a container still present and report nothing denied while the
  // write persisted the forbidden nested edit.
  const permitted = detachData(logicalSnapshot);
  await applyFieldWriteAccess({
    kind: "single",
    slug: ctx.slug,
    data: permitted,
    operation: "update",
    user: ctx.user,
    authenticatedScope: ctx.authenticatedScope,
    overrideAccess: ctx.overrideAccess,
    grants: ctx.grants,
    id: ctx.entryId,
  });

  const denied = deniedPaths(logicalSnapshot, permitted, "");
  if (denied.length === 0) return;

  // Both sides through the same conversion, so a JSON-backed value is an
  // object on both and an upload or a relationship is the identifier it is
  // stored as on both. Compared across representations, an untouched field
  // reads as an edit and a publish nobody objected to is refused.
  const live = ctx.toLogical(asRecord(await ctx.liveStoredFor(locale)));
  const deniedChanges = denied.filter(
    path =>
      !isDeepStrictEqual(valueAt(logicalSnapshot, path), valueAt(live, path))
  );
  if (deniedChanges.length === 0) return;

  throw NextlyError.validation({
    errors: deniedChanges.map(path => ({
      path,
      code: "FORBIDDEN",
      message:
        "The pending change edits this field and you do not have permission to write it, so it cannot be published. The change is kept.",
    })),
    logContext: {
      cause: "promote-denied-field",
      slug: ctx.slug,
      locale,
      fields: deniedChanges,
    },
  });
}

/**
 * Every path the rules removed, at any depth.
 *
 * A field rule can sit on a child of a group or of a repeater row, and the
 * removal there leaves the container in place: comparing only the top level
 * reports nothing denied and lets the forbidden nested edit through.
 */
function deniedPaths(
  before: unknown,
  after: unknown,
  prefix: string
): string[] {
  if (Array.isArray(before)) {
    if (!Array.isArray(after)) return [prefix];
    return before.flatMap((row, index) =>
      deniedPaths(row, after[index], `${prefix}[${index}]`)
    );
  }
  if (!isRecord(before)) return [];
  if (!isRecord(after)) return [prefix];
  const out: string[] = [];
  for (const key of Object.keys(before)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!Object.prototype.hasOwnProperty.call(after, key)) {
      out.push(path);
      continue;
    }
    out.push(...deniedPaths(before[key], after[key], path));
  }
  return out;
}

/** Read a dotted/bracketed path the way {@link deniedPaths} writes one. */
function valueAt(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const step of path.split(/\.|\[(\d+)\]/).filter(Boolean)) {
    if (Array.isArray(current) && /^\d+$/.test(step)) {
      current = current[Number(step)];
      continue;
    }
    if (!isRecord(current)) return undefined;
    current = current[step];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
 * Judged on the snapshot being promoted and never on the live document: a
 * schema change must not block someone from fixing and republishing content
 * that has nothing to do with it.
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
