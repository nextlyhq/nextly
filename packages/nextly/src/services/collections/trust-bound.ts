/**
 * What a trusted read's bound means for the targets it refused.
 *
 * A caller serving one fixed audience can name the collections its bypass may
 * reach; anything outside that set must be read as the audience would read it.
 * For a dynamic collection that means asking its own read gate. The system
 * tables have none, so the rule lives here instead — and it is shared, because
 * both the collection and the Single read paths expand uploads and both would
 * otherwise answer the question differently.
 *
 * @module services/collections/trust-bound
 */

import { decidePermission } from "../../auth/access/decide";
import { deviate } from "../../auth/access/deviations";
import {
  actorForPrincipal,
  actorForVisitorFailingClosed,
} from "../../auth/access/resolve-actor";
import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import { currentPrincipal } from "../../auth/principal-scope";
import { canReadSystemResource } from "../../auth/resource-readable";

import type { RelatedRowReadContext } from "./related-row-read-context";
import type { TrustBound } from "./trust-grant";
import { assumedBound, boundReaches } from "./trust-grant";

/** The system resource an upload field's rows are read from. */
export const MEDIA_TARGET = "media";

/**
 * Media columns describing who filed a file and how it is organized, rather
 * than the file itself.
 *
 * Media is a system table with no collection config, so a read that must treat it as
 * an unauthorized caller would has nothing to filter rows BY. What such a caller
 * is owed is the file: an upload field exists to be rendered, and the URL is
 * public by construction since the page serves it to anyone. Its ownership and
 * filing are not — they name an account and describe an internal library — so
 * those are the columns the bound removes.
 *
 * Listed in both snake_case as stored and the camelCase form the media fetches
 * convert to, so a row that reaches this without the conversion is covered too.
 */
const MEDIA_INTERNAL_COLUMNS = new Set([
  "uploadedBy",
  "uploaded_by",
  "folderId",
  "folder_id",
  "tags",
]);

/**
 * Whether a bypass-holding read's bound REFUSES this target.
 *
 * Distinct from "does not trust": a read holding no bypass trusts nothing and
 * has refused nothing either, and its rows are already judged by the ordinary
 * enforced path. Only a caller that holds a bypass and drew a bound around it
 * has refused a target, and those are the targets that must be read as the
 * caller would see them rather than as the bypass would.
 */
export function boundRefuses(
  access: RelatedRowReadContext,
  targetCollection: string
): boolean {
  return (
    access.overrideAccess === true &&
    !boundReaches(access.trusted, targetCollection)
  );
}

/**
 * Whom a related row is judged for: the redaction basis when the read names
 * one, otherwise the caller.
 *
 * A preview reads as an anonymous bearer and shows the draft as the person
 * who shared the link would see it. That covers whether a related row may be
 * shown at all, as well as its fields, so the whole view has one basis. Hooks
 * are not asked this; they keep seeing the caller.
 */
export function judgedFor(
  access: RelatedRowReadContext
): Record<string, unknown> | undefined {
  return sharerJudged(access) ? access.fieldAccessUser : access.user;
}

/**
 * Whether the read judges its related rows as a named redaction basis rather
 * than as its caller. The identity counts only with enforcement asked for,
 * as for fields: one with nothing asking for enforcement is ignored.
 */
function sharerJudged(access: RelatedRowReadContext): boolean {
  return (
    access.enforceFieldAccess === true && access.fieldAccessUser !== undefined
  );
}

/**
 * The judged party's id as a permission check needs it, or undefined when the
 * read is anonymous. Anonymity is a real answer rather than a missing one: a
 * route serving the public holds no grant, so a refused target stays refused.
 */
export function callerId(access: RelatedRowReadContext): string | undefined {
  const id = judgedFor(access)?.id;
  if (typeof id === "string" && id.length > 0) return id;
  if (typeof id === "number") return String(id);
  return undefined;
}

/**
 * Whether the read has an identity a grant can belong to: a signed-in user, or
 * an API key. A visitor has neither.
 */
export function hasCallerIdentity(access: RelatedRowReadContext): boolean {
  return (
    callerId(access) !== undefined ||
    access.authenticatedScope?.actorType === "apiKey"
  );
}

/**
 * Whether a read holding NO bypass may populate a row of a system resource
 * (`media`, `users`, `roles`, `permissions`).
 *
 * The question its direct read asks: a session caller's `read-<resource>`
 * grant (super-admin authority included), or a key's own scope, through the
 * one gate the system readers share. Without it the row is withheld, so a key
 * or a person refused `users` by name no longer reads a post's author through
 * its relationship.
 *
 * A visitor keeps media and nothing else. Pages served to the public embed
 * the images they reference, and a media row describes a file already served
 * to them; holding visitors to a grant none can hold would empty those pages.
 * No visitor reads any other system resource directly, and a user row carries
 * a person's address, so a related row of one is withheld from a visitor
 * rather than handed out because no grant was asked.
 */
export async function identifiedCallerMayRead(
  access: RelatedRowReadContext,
  resource: string
): Promise<boolean> {
  if (!hasCallerIdentity(access)) {
    // Kept until a read with no caller identity, a visitor's or a plugin's
    // person's, reads media through the Public role: the decision judges a
    // visitor by the Public role's grants and refuses a plugin's person, who
    // holds none.
    const principal = currentPrincipal();
    return deviate(
      "visitor-keeps-media",
      resource === MEDIA_TARGET,
      async () =>
        decidePermission(
          principal
            ? actorForPrincipal(principal)
            : await actorForVisitorFailingClosed(),
          "read",
          resource
        ).allowed
    );
  }
  return canReadSystemResource(
    resource,
    callerId(access),
    access.authenticatedScope
  );
}

/** A media row without the columns a refused target must not disclose. */
function withoutInternalMediaColumns(
  row: Record<string, unknown>
): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    if (!MEDIA_INTERNAL_COLUMNS.has(column)) kept[column] = value;
  }
  return kept;
}

/**
 * Media rows as this read may populate them.
 *
 * Upload expansion reads the media table directly, so it is never reached by
 * the per-target decision the relationship fetches make and needs its own.
 *
 * - A read holding a bypass keeps its answer: rows whole where its bound
 *   reaches media; where the bound refused media, the caller's own
 *   `read-media` grant, and without it the internal columns come off, since a
 *   page served to the public still renders the files it embeds.
 * - A read that enforces nothing, an internal one naming no caller, gets the
 *   rows whole, as it gets every related target.
 * - Any other read is judged by {@link identifiedCallerMayRead}: a signed-in
 *   user or a key without `read-media` gets none of them. Withheld rows are
 *   dropped, which leaves an upload field as it leaves one whose media no
 *   longer exists, so a refusal cannot be told from a missing file.
 */
export async function applyMediaTrustBound(
  records: Record<string, unknown>[],
  access: RelatedRowReadContext
): Promise<Record<string, unknown>[]> {
  if (access.overrideAccess === true) {
    if (!boundRefuses(access, MEDIA_TARGET)) return records;
    const readable = await canReadSystemResource(
      MEDIA_TARGET,
      callerId(access),
      access.authenticatedScope
    );
    if (readable) return records;
    // A page served to the public keeps the files it embeds. A read judged as
    // a named person, as a preview is, shows the files that person may read.
    return sharerJudged(access) ? [] : records.map(withoutInternalMediaColumns);
  }
  if (!access.enforceCollectionAccess && !access.enforceFieldAccess) {
    return records;
  }
  return (await identifiedCallerMayRead(access, MEDIA_TARGET)) ? records : [];
}

/**
 * What a read or write knows about its caller, as the expansions need it.
 *
 * Narrower than the full options object either path carries, and deliberately
 * so: these four fields are exactly what decides whether a media row is
 * narrowed, and naming them once means a caller cannot forward three of them
 * and quietly change who the expansion runs as.
 */
export interface CallerOptions {
  user?: Record<string, unknown>;
  overrideAccess?: boolean;
  /**
   * Whether the caller asked for field-level read rules to be enforced despite
   * being otherwise trusted, and whose rules to judge by.
   *
   * The pair travels together because neither means anything alone: an identity
   * with nothing asking for enforcement is ignored, and enforcement naming
   * nobody judges the anonymous caller. See
   * {@link RelatedRowReadContext.fieldAccessUser}.
   */
  enforceFieldAccess?: boolean;
  fieldAccessUser?: Record<string, unknown>;
  trusted?: TrustBound;
  authenticatedScope?: AuthenticatedScope;
}

/**
 * The access context an expansion should run under, derived from its caller's
 * options.
 *
 * Built here rather than assembled at each call site. Two paths reach the
 * upload expansion and each assembled its own object literal, which is four
 * chances per site to drop a field or bind it to the wrong thing — and the
 * failure is silent, because every field is optional and an incomplete context
 * is a VALID one describing a different caller.
 */
export function expansionAccess(options: CallerOptions): RelatedRowReadContext {
  return {
    user: options.user,
    overrideAccess: options.overrideAccess,
    // Carried for the reason this function exists at all: an expansion that
    // rebuilt its own context and dropped these would be a VALID context
    // describing a different caller — one whose related rows are judged by
    // nobody. That is silent, and it is the direction that leaks.
    enforceFieldAccess: options.enforceFieldAccess,
    fieldAccessUser: options.fieldAccessUser,
    trusted: assumedBound(options.trusted),
    authenticatedScope: options.authenticatedScope,
  };
}
