/**
 * Discarding a document's pending working draft.
 *
 * The draft/published split stores a status-less edit of a published document
 * as a working-draft sidecar in `nextly_versions`. Discarding removes that
 * sidecar and hands back the live published row, so the editor resets to what
 * is public. Durable history is never touched — this reverts unpublished edits,
 * it does not rewrite a version.
 *
 * A localized document holds one pending change per language, so discarding is
 * one language's concern: the request names the language it is discarding, and
 * the other languages' pending changes are left alone.
 *
 * Collections and Singles share this one implementation. Only the services
 * differ — which one reads the live document and which one owns the delete. The
 * ordering below is the part worth having once: reading before deleting is what
 * makes the discard effectively atomic, and a second copy of it would be a
 * second place for that to be got wrong.
 *
 * Authorization is the caller's concern: the dispatcher handler establishes
 * read and update on the document before calling in here, so this module only
 * performs the removal and the re-read.
 *
 * @module domains/versions/discard-working-draft
 */

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import { getService } from "../../di";
import { errorFromServiceEnvelope } from "../../errors/from-service-envelope";
import type { VersionScopeKind } from "../../schemas/versions/types";
import type { UserContext } from "../singles/types";

export interface DiscardWorkingDraftArgs {
  /** Which kind of document owns the pending change. */
  scopeKind: VersionScopeKind;
  /** Collection or Single slug. */
  slug: string;
  /**
   * The live document's id. A Single's URL carries none — there is only ever one
   * document — so its caller resolves the id from the live row rather than
   * letting a client name it.
   */
  entryId: string;
  user: UserContext;
  /**
   * Which language's pending change to discard, and which language's live
   * values to hand back. Absent means the request named none, which for a
   * localized document is the default language — the admin omits `?locale=`
   * when editing it. Ignored for an unlocalized document, which has one
   * pending change rather than one per language.
   */
  locale?: string | null;
  /**
   * The caller's authenticated scope, forwarded to the re-read so a scoped API
   * key is judged on its OWN read grant rather than the key owner's roles.
   */
  authenticatedScope?: AuthenticatedScope;
}

/**
 * Remove the working-draft sidecar for a published document and return the live
 * published document as a plain read would shape it. A no-op that still returns
 * the live row when no working draft exists.
 */
export async function discardWorkingDraft(
  args: DiscardWorkingDraftArgs
): Promise<unknown> {
  // Read the live published row FIRST, through the full read pipeline (hooks,
  // redaction, field-level access) and WITHOUT the working-draft overlay, so it
  // is the live document the editor resets to. The delete below never touches
  // the live row — it only clears the sidecar — so this pre-read is the same
  // document a post-delete read would return. Reading first is what makes the
  // discard effectively atomic: a read failure surfaces before anything is
  // removed, leaving the pending draft intact rather than deleting it and then
  // reporting a failure the admin treats as a no-op (which would keep the stale
  // draft on screen and let a later Publish push its values straight to live).
  //
  // Read and update were established by the caller, so both reads skip only the
  // redundant coarse RBAC re-check while the document's own rules still run. The
  // language being discarded is named, so the values handed back are the ones the
  // editor resets to: reading another language's would reset the form to text
  // belonging to a language the author is not looking at.
  const locale = args.locale ? { locale: args.locale } : {};
  const result =
    args.scopeKind === "single"
      ? await getService("singleEntryService").get(args.slug, {
          user: args.user,
          routeAuthorized: true,
          authenticatedScope: args.authenticatedScope,
          status: "all",
          ...locale,
        })
      : await getService("collectionsHandler").getEntry({
          collectionName: args.slug,
          entryId: args.entryId,
          user: args.user,
          routeAuthorized: true,
          authenticatedScope: args.authenticatedScope,
          status: "all",
          ...locale,
        });

  // A failed read (a concurrent delete, or an after-read hook or database error)
  // is propagated as the error it carries rather than returned as a successful
  // discard of an empty document — and because nothing has been deleted yet, the
  // draft is left intact for a retry.
  if (!result.success) {
    // The result object itself rather than a field-by-field copy of it. The
    // read attached the thrown error to this object, and copying only the
    // fields named here left that behind — so a driver failure underneath a
    // discard reached the caller with nothing naming it.
    throw errorFromServiceEnvelope(result);
  }

  // Now remove the sidecar through the collections handler, which deletes it
  // under the same parent-row lock a draft save takes: a save committing between
  // this request's authorization checks and the delete would otherwise have its
  // brand-new draft removed with both requests reporting success. Deleting when
  // none exists is a no-op, not an error.
  if (args.scopeKind === "single") {
    await getService("singleEntryService").discardWorkingDraft({
      slug: args.slug,
      locale: args.locale ?? null,
    });
  } else {
    await getService("collectionsHandler").discardWorkingDraft({
      collectionName: args.slug,
      entryId: args.entryId,
      locale: args.locale ?? null,
    });
  }

  return result.data;
}
