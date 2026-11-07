/**
 * Whether a caller may read, or edit, a Single's live document.
 *
 * Two gates ask this and they must not answer differently: version history and
 * draft preview both hand out a view of a document the caller cannot reach
 * through the ordinary read path, so both have to authorize the view they give
 * rather than the coarser one that is easier to ask for.
 *
 * The route gate they each run first is per-SLUG RBAC, and it is one axis short
 * of the question. A Single's own read is additionally bounded by its
 * draft/published lifecycle and by whether the document exists at all, neither
 * of which the coarse permission expresses. A gate that stops at the permission
 * therefore authorizes a disclosure the real
 * operation would refuse.
 *
 * **`routeAuthorized` is the CALLER's to state, and it is required.** It tells
 * `checkSingleAccess` that the route already ran the coarse RBAC gate FOR THIS
 * OPERATION, so the check is skipped as redundant. Whether that is true depends
 * on which gate the caller's route ran, not on anything visible here: version
 * history reaches the read probe behind a `read` gate, while minting a preview
 * link reaches it behind an `update` gate — and passing `true` there would skip
 * a `read` permission check that never ran, handing a bearer token for the draft
 * to a caller holding `update` and no read grant at all.
 *
 * Required rather than defaulted for that reason. A default is a polarity this
 * module cannot know, and the wrong one is silent.
 *
 * @module domains/singles/services/single-document-access
 */

import {
  registeredReadLanguagesFor,
  registeredWriteAsNamedLanguagesFor,
  withRuleLanguage,
} from "../../../auth/access/rule-language";
import type { AuthenticatedScope } from "../../../auth/authenticated-scope";
import {
  asNotMigrated,
  singleNotMigrated,
} from "../../../database/with-db-errors";
import { getService } from "../../../di";
import { errorFromServiceEnvelope } from "../../../errors/from-service-envelope";
import { resolvePublishTransition } from "../../../lib/status-transition";
import type { UserContext } from "../types";

import { checkSingleAccess } from "./single-query-service";

/** Who is asking, and on whose behalf. */
export interface SingleAccessSubject {
  user: UserContext;
  /**
   * A scoped API key is judged on its OWN grant, so a key owned by a super
   * admin does not inherit that owner's session bypass.
   */
  actor?: AuthenticatedScope;
  /**
   * Whether the caller's route already ran the RBAC gate for the operation
   * being probed here — read for {@link singleDocumentReadable}, update for
   * {@link singleDocumentEditable}.
   *
   * `true` skips that one check as redundant. State it from what the route
   * actually gated, never from what is convenient: a route that gated `update`
   * has authorized nothing about `read`.
   */
  routeAuthorized: boolean;
  /**
   * Which translation is being authorized. A localized Single is a different
   * document per language, and its lifecycle can differ per language — so a
   * probe that reads the default translation authorizes a document the caller
   * may not be asking about.
   */
  locale?: string;
  /** The request behind the probe, for hooks that narrow reads by it. */
  request?: Request;
  /** The context the caller passed, for hooks that narrow reads by it. */
  context?: Record<string, unknown>;
}

/**
 * Turn a read outcome into a verdict, keeping "denied" and "could not ask"
 * apart.
 *
 * A 403 and a 404 are both answers and are deliberately collapsed: telling them
 * apart would report whether a Single exists to a caller who may not see it.
 * Anything else is the read FAILING rather than refusing, and returning `false`
 * for it would turn an outage into a permission denial that looks deliberate.
 * It keeps the code the read answered with — a Single its database has not
 * been migrated for says so — rebuilt by the shared converter, as the
 * collection preview probe rebuilds its read's answer.
 */
function readVerdict(result: {
  success: boolean;
  statusCode: number;
  code?: string;
  message?: string;
  messageKey?: string;
  publicData?: unknown;
}): boolean {
  if (result.success) return true;
  if (result.statusCode === 403 || result.statusCode === 404) return false;
  throw errorFromServiceEnvelope(
    { ...result, message: result.message ?? "Single access read failed" },
    { reason: "single-access-probe-failed" }
  );
}

/**
 * Whether the caller may read the Single's live document, unpublished included.
 *
 * `status: "all"` is the part a plain read cannot express: a Single with a
 * publish lifecycle otherwise filters to published only, so one that has never
 * been published reports as missing — exactly the document these gates exist
 * for. The working draft is asked for alongside it, so what is authorized here
 * is the view the caller will actually be handed rather than the live one.
 */
export async function singleDocumentReadable(
  slug: string,
  {
    user,
    actor,
    routeAuthorized,
    locale,
    request,
    context,
  }: SingleAccessSubject
): Promise<boolean> {
  const singles = getService("singleEntryService");
  const result = await singles.get(slug, {
    user,
    overrideAccess: false,
    routeAuthorized,
    ...(actor === undefined ? {} : { authenticatedScope: actor }),
    ...(locale === undefined ? {} : { locale }),
    // A hook that narrows reads by the request or the caller's context sees
    // them here as on the caller's own read.
    ...(request === undefined ? {} : { request }),
    ...(context === undefined ? {} : { context }),
    status: "all",
    // The DRAFT, because that is the view the token hands out. Authorizing the
    // live document instead leaves a custom rule that allows the published
    // values and denies the pending ones bypassed entirely: the probe says yes
    // about a document the bearer never receives, and consumption reads the
    // working draft trusted without re-running the rule.
    includeWorkingDraft: true,
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
 * A Single with no materialized row is not editable, and that is settled
 * against the STORED row through the adapter rather than against a read result,
 * which is presentation data an `afterRead` hook may have reshaped.
 */
export async function singleDocumentEditable(
  slug: string,
  subject: SingleAccessSubject
): Promise<boolean> {
  return storedSingleDocumentAllows(slug, "update", subject);
}

/**
 * Whether the caller may read the Single's live document, asked WITHOUT
 * reading it: nothing is created and no hook runs.
 *
 * {@link singleDocumentReadable} answers through `SingleEntryService.get`,
 * which creates a Single that has no row yet (row, localized defaults and a
 * first version) and runs its read hooks. That is right for a caller who is
 * about to be handed the document, and wrong for one that only needs the
 * verdict on a request that must not write, such as an anonymous page view
 * re-checking whoever shared a preview link.
 *
 * The decision is the one `get` makes, `checkSingleAccess` for `read`,
 * applied to the stored row, so the two cannot answer the permission
 * differently. What it does not repeat is `get`'s lifecycle filter, which
 * decides which STATUS a reader may see rather than whether they may read the
 * Single: a caller that needs that too asks {@link singleDocumentReadable}.
 * A Single with no row is not readable here, as it is not editable, since
 * there is no document to judge.
 */
/**
 * Whether the caller may make a write naming `nextStatus` of the Single's
 * document, asked WITHOUT writing: nothing is created and no hook runs. The
 * lifecycle gate a Single's update asks (`checkSingleAccess` for `publish` or
 * `unpublish`), and only where it asks it: for a write that moves the stored
 * row into or out of published, as {@link resolvePublishTransition}
 * classifies it. A write that keeps the status asks nothing more. A Single
 * with no row is refused here, as it is not editable.
 *
 * @experimental
 */
export async function singleDocumentStatusMoveAllowed(
  slug: string,
  nextStatus: string,
  subject: SingleAccessSubject
): Promise<boolean> {
  const registry = getService("singleRegistryService");
  const record = await registry.getSingleBySlug(slug);
  if (!record?.tableName) return false;
  const document = await storedRow(slug, record.tableName);
  if (!document) return false;
  const stored = document.status;
  const move = resolvePublishTransition(
    typeof stored === "string" ? stored : null,
    nextStatus
  );
  return move === null || storedSingleDocumentAllows(slug, move, subject);
}

export async function singleStoredDocumentReadable(
  slug: string,
  subject: SingleAccessSubject
): Promise<boolean> {
  return storedSingleDocumentAllows(slug, "read", subject);
}

/**
 * The stored row's existence, then the Single's access gate for `operation`.
 *
 * Loaded through the adapter rather than a read, so asking creates nothing and
 * runs no hook. One body for both operations, so the read and update probes
 * cannot drift apart in what they treat as "no document".
 */
async function storedSingleDocumentAllows(
  slug: string,
  operation: "read" | "update" | "publish" | "unpublish",
  { user, actor, routeAuthorized, locale }: SingleAccessSubject
): Promise<boolean> {
  const registry = getService("singleRegistryService");
  const record = await registry.getSingleBySlug(slug);
  if (!record?.tableName) return false;

  const document = await storedRow(slug, record.tableName);
  if (!document) return false;

  // The gate reads no row, so where a language is named it is told that one,
  // as a read or a write of it would be. Where none is named it is told what
  // the caller set: a REST autosave or discard has set the request's own.
  const ask = () =>
    checkSingleAccess({
      slug,
      operation,
      user,
      overrideAccess: false,
      routeAuthorized,
      rbacAccessControlService: getService("rbacAccessControlService"),
      ...(actor === undefined ? {} : { authenticatedScope: actor }),
      logger: getService("logger"),
    });
  const denied =
    locale === undefined
      ? await ask()
      : await withRuleLanguage(
          operation === "read"
            ? registeredReadLanguagesFor(locale)
            : registeredWriteAsNamedLanguagesFor(locale),
          ask
        );
  return denied === null;
}

/**
 * The id of a Single's live document, or `null` when it has not been
 * materialized yet.
 *
 * A Single's URL carries no entry id (there is only ever one document), so
 * callers must resolve it from the backing row rather than trusting a
 * client-supplied value — otherwise the id check that stops a recreated Single
 * exposing its predecessor's snapshots could simply be bypassed. Reads the row
 * directly instead of going through `SingleEntryService.get`, which would
 * materialize a missing Single as a side effect of a read.
 */
export async function resolveSingleDocumentId(
  slug: string
): Promise<string | null> {
  const registry = getService("singleRegistryService");
  const record = await registry.getSingleBySlug(slug);
  if (!record?.tableName) return null;

  const row = await storedRow(slug, record.tableName);
  return typeof row?.id === "string" ? row.id : null;
}

/**
 * The Single's stored row, read through the adapter so asking creates nothing.
 *
 * A table or column its database has not been migrated for is answered as the
 * Single's read answers it, naming the Single and the reason only: these
 * checks serve version, preview and event routes, whose callers are not
 * trusted with the schema's physical names.
 */
async function storedRow(
  slug: string,
  tableName: string
): Promise<Record<string, unknown> | null> {
  try {
    return await getService("adapter").selectOne<Record<string, unknown>>(
      tableName,
      {}
    );
  } catch (error) {
    throw await asNotMigrated(
      error,
      singleNotMigrated(getService("singleRegistryService"), slug)
    );
  }
}
