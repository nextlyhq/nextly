/**
 * Whether a caller may read one document in one language, asked of the
 * collection's or Single's own read gate. Its own module, apart from the
 * batch reads beside it, so the history gates can ask it without reaching the
 * Direct API, which reaches them.
 *
 * @module services/lib/document-readable-in
 */

import { getService } from "../../di";
import { errorFromServiceEnvelope } from "../../errors/from-service-envelope";
import type { ReadCaller } from "../dashboard/readable-resources";

/**
 * What a document's read hooks are handed besides the caller: the request
 * behind the read and the context its caller passed. A hook that narrows reads
 * by either must see the same values here as on the caller's own document read,
 * or the answer is about a different caller than the one asking.
 */
export interface DocumentReadHookInputs {
  request?: Request;
  context?: Record<string, unknown>;
}

/** The one document {@link documentReadableIn} is asked about. */
interface ReadableDocumentRef {
  kind: "collection" | "single";
  slug: string;
  entryId: string;
}

/**
 * Whether this caller may READ one document in `locale` (in the default
 * language and its fallbacks where it names none), asked of the ordinary read
 * path as the caller.
 *
 * 🔴 Nothing is attested: `routeAuthorized` is false, as for
 * {@link readableDocumentIds}, so the gate asks the collection's or Single's
 * own read rule in `locale`, the language the read path tells it. A route's
 * allow judged the request's language at most, and attesting it for a read in
 * another language admitted a language the rule refuses. A scoped API key is
 * judged on its own grant, carried as the read's `authenticatedScope`.
 *
 * The by-id form of {@link readableDocumentIds}, for a caller that must also
 * know the read loaded THIS document: a collection is read by id, and the
 * verdict is the read's own report of the row it loaded (`resolvedEntryId`),
 * because a `beforeOperation` hook may send the read to another row and an
 * `afterRead` hook may project `id` out of the output, which a list read
 * keyed by its output's ids cannot tell apart from a refusal. A Single's live
 * id is resolved first, without materializing it, and must be `entryId`: rows
 * outlive the Single they describe, and a recreated one is another document.
 *
 * `status: "all"`, so a document never published is still readable to a
 * caller who may read its drafts. A refusal and a missing document (403, 404)
 * are both `false`; any other failure is the read failing and is thrown with
 * the read's own code, rather than reported as a refusal.
 */
export async function documentReadableIn(
  document: ReadableDocumentRef,
  caller: ReadCaller,
  locale?: string | null,
  hookInputs: DocumentReadHookInputs = {}
): Promise<boolean> {
  const inLanguage = locale === null || locale === undefined ? {} : { locale };
  const hooks = {
    ...(hookInputs.request === undefined
      ? {}
      : { request: hookInputs.request }),
    ...(hookInputs.context === undefined
      ? {}
      : { context: hookInputs.context }),
  };
  if (document.kind === "single") {
    // Imported here rather than at the top of the module: the Singles read
    // path imports modules that import this one, and the static edge is a
    // cycle (the reason document-visibility defers the same import).
    const { resolveSingleDocumentId, singleDocumentReadable } = await import(
      "../../domains/singles/services/single-document-access"
    );
    const liveId = await resolveSingleDocumentId(document.slug);
    if (liveId === null || liveId !== document.entryId) return false;
    return singleDocumentReadable(document.slug, {
      user: caller.user,
      routeAuthorized: false,
      ...(caller.authenticatedScope === undefined
        ? {}
        : { actor: caller.authenticatedScope }),
      ...inLanguage,
      ...hooks,
    });
  }

  const read = await getService("collectionsHandler").getEntry({
    collectionName: document.slug,
    entryId: document.entryId,
    user: caller.user,
    overrideAccess: false,
    routeAuthorized: false,
    authenticatedScope: caller.authenticatedScope,
    status: "all",
    ...hooks,
    ...inLanguage,
  });
  if (!read.success) {
    if (read.statusCode === 403 || read.statusCode === 404) return false;
    // Rebuilt through the shared converter, so the fault keeps the code the
    // read gave it (a database not migrated for the collection, a rule that
    // could not run) rather than becoming an opaque internal error.
    throw errorFromServiceEnvelope(read, {
      reason: "document-read-probe-failed",
      statusCode: read.statusCode,
    });
  }
  return read.resolvedEntryId === document.entryId;
}
