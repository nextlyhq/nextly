/**
 * What a trusted read's bound means for the targets it refused.
 *
 * A caller serving one fixed audience can name the collections its bypass may
 * reach; anything outside that set must be read as the audience would read it.
 * For a dynamic collection that means evaluating its stored rules. The system
 * tables have none, so the rule lives here instead — and it is shared, because
 * both the collection and the Single read paths expand uploads and both would
 * otherwise answer the question differently.
 *
 * @module services/collections/trust-bound
 */

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import { canReadSystemResource } from "../../auth/resource-readable";

import type { RelatedRowReadContext } from "./related-row-read-context";

/** The system resource an upload field's rows are read from. */
export const MEDIA_TARGET = "media";

/**
 * Media columns describing who filed a file and how it is organized, rather
 * than the file itself.
 *
 * Media is a system table with no stored rules, so a read that must treat it as
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
    access.trusted !== undefined &&
    !access.trusted(targetCollection)
  );
}

/**
 * The caller's id as a permission check needs it, or undefined when the read is
 * anonymous. Anonymity is a real answer rather than a missing one: a route
 * serving the public holds no grant, so a refused target stays refused.
 */
export function callerId(access: RelatedRowReadContext): string | undefined {
  const id = access.user?.id;
  if (typeof id === "string" && id.length > 0) return id;
  if (typeof id === "number") return String(id);
  return undefined;
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
 * Media rows as the read's trust bound allows them.
 *
 * Upload expansion reads the media table directly, so it is never reached by
 * the per-target decision the relationship fetches make and needs its own. A
 * read holding no bypass, or holding one that did not refuse media, gets the
 * rows whole; a refused target falls back to the caller's own `read-media`
 * grant, and without it the internal columns come off.
 */
export async function applyMediaTrustBound(
  records: Record<string, unknown>[],
  access: RelatedRowReadContext
): Promise<Record<string, unknown>[]> {
  if (!boundRefuses(access, MEDIA_TARGET)) return records;
  const readable = await canReadSystemResource(
    MEDIA_TARGET,
    callerId(access),
    access.authenticatedScope
  );
  return readable ? records : records.map(withoutInternalMediaColumns);
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
  trusted?: (collection: string) => boolean;
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
    trusted: options.trusted,
    authenticatedScope: options.authenticatedScope,
  };
}
