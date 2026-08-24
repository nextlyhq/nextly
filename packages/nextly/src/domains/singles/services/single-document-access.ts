/**
 * Whether a caller may read, or edit, a Single's live document.
 *
 * Two gates ask this and they must not answer differently: version history and
 * draft preview both hand out a view of a document the caller cannot reach
 * through the ordinary read path, so both have to authorize the view they give
 * rather than the coarser one that is easier to ask for.
 *
 * The route gate they each run first is per-SLUG RBAC, and it is one axis short
 * of the question. A Single can carry stored access rules — owner-only, role
 * based, custom — that deny a caller holding the coarse permission, and those
 * rules are evaluated against the loaded document rather than the request. A
 * gate that stops at the permission therefore authorizes a disclosure the real
 * operation would refuse.
 *
 * `routeAuthorized: true` throughout: the caller's route already ran the coarse
 * RBAC check, and this flag skips ONLY that. The stored rules still run, which
 * is the part these functions exist for.
 *
 * @module domains/singles/services/single-document-access
 */

import type { AuthenticatedScope } from "../../../auth/authenticated-scope";
import { getService } from "../../../di";
import { NextlyError } from "../../../errors/nextly-error";
import { AccessControlService } from "../../../services/access/access-control-service";
import type { UserContext } from "../types";

import { checkSingleAccess } from "./single-query-service";

/** Who is asking, and on whose behalf. */
export interface SingleAccessSubject {
  user: UserContext;
  /**
   * A scoped API key is judged on its OWN grant, so a key owned by a super
   * admin does not inherit that owner's stored rules.
   */
  actor?: AuthenticatedScope;
}

/**
 * Turn a read outcome into a verdict, keeping "denied" and "could not ask"
 * apart.
 *
 * A 403 and a 404 are both answers and are deliberately collapsed: telling them
 * apart would report whether a Single exists to a caller who may not see it.
 * Anything else is the read FAILING rather than refusing, and returning `false`
 * for it would turn an outage into a permission denial that looks deliberate.
 */
function readVerdict(result: {
  success: boolean;
  statusCode: number;
}): boolean {
  if (result.success) return true;
  if (result.statusCode === 403 || result.statusCode === 404) return false;
  throw NextlyError.internal({
    logContext: {
      reason: "single-access-probe-failed",
      statusCode: result.statusCode,
    },
  });
}

/**
 * Whether the caller may read the Single's live document, unpublished included.
 *
 * `status: "all"` is the part a plain read cannot express: a Single with a
 * publish lifecycle otherwise filters to published only, so one that has never
 * been published reports as missing — exactly the document these gates exist
 * for.
 */
export async function singleDocumentReadable(
  slug: string,
  { user, actor }: SingleAccessSubject
): Promise<boolean> {
  const singles = getService("singleEntryService");
  const result = await singles.get(slug, {
    user,
    overrideAccess: false,
    routeAuthorized: true,
    ...(actor === undefined ? {} : { authenticatedScope: actor }),
    status: "all",
  });
  return readVerdict(result);
}

/**
 * Whether the caller may edit the Single's live document.
 *
 * Reading it proves nothing about this: where a Single allows broad reads and
 * restricts updates, a caller can read the published document and would
 * otherwise be handed the author's unpublished edits.
 *
 * The row is loaded through the adapter rather than taken from a read result,
 * because an owner-only rule compares against the STORED values and
 * `checkSingleAccess` refuses outright when such a rule has no document — while
 * a read result is presentation data an `afterRead` hook may have reshaped.
 */
export async function singleDocumentEditable(
  slug: string,
  { user, actor }: SingleAccessSubject
): Promise<boolean> {
  const registry = getService("singleRegistryService");
  const record = await registry.getSingleBySlug(slug);
  if (!record?.tableName) return false;

  const adapter = getService("adapter");
  const document = await adapter.selectOne<Record<string, unknown>>(
    record.tableName,
    {}
  );
  if (!document) return false;

  const denied = await checkSingleAccess({
    slug,
    operation: "update",
    user,
    overrideAccess: false,
    routeAuthorized: true,
    rbacAccessControlService: getService("rbacAccessControlService"),
    // Stateless evaluator for the Single's stored rules; it holds no
    // per-request state, so constructing one here matches the write path.
    accessControlService: new AccessControlService(),
    accessRules: record.accessRules,
    document,
    ...(actor === undefined ? {} : { authenticatedScope: actor }),
    logger: getService("logger"),
  });
  return denied === null;
}
