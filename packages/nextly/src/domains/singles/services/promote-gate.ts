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
 * Called BEFORE the write transaction opens, never inside it. Both a field's
 * `access` rule and its `validate` are user code, and resolving the caller's
 * grants issues its own queries on the pooled connection: run inside an open
 * transaction on a small pool, those queries wait for a connection the
 * transaction is holding and the publish hangs. The collection publish path
 * gates its promotion outside the transaction for the same reason.
 *
 * @module domains/singles/services/promote-gate
 */

import { isDeepStrictEqual } from "node:util";

import type { FieldConfig } from "../../../collections/fields/types";
import { NextlyError } from "../../../errors";
import { validateEntryData } from "../../../shared/lib/entry-validation";
import {
  applyFieldWriteAccess,
  attachFieldValidators,
} from "../../../shared/lib/field-level-registry";
import { relationshipValidationView } from "../../../shared/lib/field-transform";

/** One language's pending change, as the versions repository stores it. */
export interface PromotableDraft {
  /** The language it is keyed under; `null` for an unlocalized Single. */
  locale: string | null;
  /** The stored snapshot, in write shape. */
  snapshot: unknown;
}

/** What judging a draft needs from the service that holds it. */
export interface PromoteGateContext {
  slug: string;
  entryId: string;
  fields: FieldConfig[];
  user?: Record<string, unknown>;
  overrideAccess?: boolean;
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
   * The live document as a reader of that language sees it, used to decide
   * whether promoting a denied field would CHANGE anything.
   *
   * Language-aware by necessity: a localized field's live value is on the
   * companion row, so a main-table row alone reports every translation as
   * absent and every unchanged translation as an edit.
   */
  liveDocumentFor: (
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
 * Refuse the publish unless every pending change may be promoted as it stands.
 *
 * Throws on the first draft that cannot be, so nothing is written: a publish
 * either applies the whole pending change or none of it.
 */
export async function assertDraftsMayBePromoted(
  drafts: readonly PromotableDraft[],
  ctx: PromoteGateContext
): Promise<void> {
  for (const draft of drafts) {
    const promoted = {
      ...ctx.toLogical((draft.snapshot ?? {}) as Record<string, unknown>),
      ...(ctx.callerData ?? {}),
    };

    await assertNoDeniedChange(promoted, draft.locale, ctx);
    await assertSchemaStillAccepts(promoted, ctx);
  }
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
 * Judged on what would CHANGE, not on what the snapshot holds. A snapshot is a
 * full copy of the document, so a denied field appears in every one of them;
 * only a value that differs from what is live is a change being made.
 */
async function assertNoDeniedChange(
  promoted: Record<string, unknown>,
  locale: string | null,
  ctx: PromoteGateContext
): Promise<void> {
  const permitted = { ...promoted };
  await applyFieldWriteAccess({
    kind: "single",
    slug: ctx.slug,
    data: permitted,
    operation: "update",
    user: ctx.user,
    overrideAccess: ctx.overrideAccess,
    id: ctx.entryId,
  });
  const denied = Object.keys(promoted).filter(
    key => !Object.prototype.hasOwnProperty.call(permitted, key)
  );
  if (denied.length === 0) return;

  const live = (await ctx.liveDocumentFor(locale)) ?? {};
  const deniedChanges = denied.filter(
    key => !isDeepStrictEqual(promoted[key], live[key])
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
 * Refuse a promotion the schema no longer accepts, naming every field at
 * fault so the author can see what to fix.
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
      mode: "update",
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
