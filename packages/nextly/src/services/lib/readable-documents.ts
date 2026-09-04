/**
 * Which of these documents the caller may actually READ, asked of the ordinary
 * read path.
 *
 * 🔴 Entity-level access is one axis short of the question, and its own contract
 * says so: `readableEntities` decides whether a collection is in reach AT ALL,
 * leaving the per-row rules of whatever query follows to decide which documents
 * come back. A collection carrying a stored `owner-only` or `custom` read rule
 * therefore admits every editor at the coarse check while the read path narrows
 * to a subset — so any surface keyed by collection name alone reports one
 * author's documents to another.
 *
 * That is not a hypothetical shape: the dashboard's own statistics once counted
 * rows straight from the physical table and disclosed exactly this, and the
 * repair was to route the numbers through the access-enforced path rather than
 * to reproduce the rule. This module is that repair, made reusable — the
 * pending-edit cards and the activity feed are two surfaces of it, and any later
 * system source keyed by collection and document id is a third. Those surfaces
 * reach it through {@link ./document-visibility}, which decides WHICH documents
 * a batch of rows names; this module answers the narrower question it is built
 * from — which ids of ONE collection, in ONE language, survive its read rules.
 *
 * The rule is never re-implemented here. A stored rule can be `owner-only` or a
 * `custom` function, and both return a query constraint expressed over the
 * COLLECTION's own fields — which is why the constraint cannot simply be pushed
 * into a sidecar table's query the way Payload pushes one into its versions
 * collection: `activity_log` and `nextly_versions` do not carry the columns a
 * rule names. Asking the read path which of a known set of ids survive is the
 * one form that works for every rule, including the ones nobody can predict.
 *
 * @module services/lib/readable-documents
 */

import { getNextly } from "../../direct-api/nextly";
import type { ReadCaller } from "../dashboard/readable-resources";

/**
 * Ids per statement. Each id binds one parameter and SQLite's default
 * SQLITE_MAX_VARIABLE_NUMBER is 999 — the lowest across supported dialects — so
 * a set larger than this is asked for in several reads rather than one that the
 * driver refuses. Matches the chunk the versions repository already deletes in.
 */
const ID_CHUNK_SIZE = 500;

/** `ids` split into statement-sized runs. */
function chunked(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += ID_CHUNK_SIZE) {
    chunks.push([...ids.slice(index, index + ID_CHUNK_SIZE)]);
  }
  return chunks;
}

/**
 * The subset of `entryIds` this caller may read from `collection`.
 *
 * `overrideAccess: false` with the caller's own identity is what applies the
 * stored rule, and the API key's stamped scope is forwarded so a key is judged
 * on its own grant rather than on the roles of whoever minted it.
 *
 * `status: "all"` because a document with unpublished edits may never have been
 * published: filtering to published rows would drop precisely the documents a
 * pending-edits card exists to name, reporting a caller's own work as
 * unreadable. Access is unaffected by it — the lifecycle decides visibility of
 * a row's STATE, the access rule decides visibility of the row.
 *
 * Only `id` is selected. The caller needs membership, and a projection wide
 * enough to answer that is the narrowest thing that also cannot carry field
 * values into a surface that never asked for them.
 *
 * 🔴 `locale` is part of the QUESTION, not a presentation detail. A stored rule
 * is a predicate over the collection's fields, and a localized field answers
 * differently per language, so a read that names no locale judges whichever
 * translation it defaults to. Asking once per slug and applying that verdict to
 * every language discloses the rows a rule refuses in the others.
 */
/**
 * Who the read runs as, and in which language.
 *
 * Separated so the two questions this module asks differ in ONE visible place.
 * Each key is omitted rather than passed as `undefined`, because the read path
 * distinguishes an absent option from an explicit one — a forwarded
 * `locale: undefined` is not the same request as no locale at all.
 */
function identityOptions(
  locale: string | null | undefined,
  access: { overrideAccess: boolean; caller?: ReadCaller }
): Record<string, unknown> {
  const caller = access.caller;
  return {
    ...(locale === null || locale === undefined ? {} : { locale }),
    overrideAccess: access.overrideAccess,
    ...(caller ? { user: caller.user } : {}),
    ...(caller?.authenticatedScope ? { actor: caller.authenticatedScope } : {}),
  };
}

/**
 * The ids among `entryIds` that `collection` returns for the given read.
 *
 * 🔴 One loop for both questions this module asks, because they differ ONLY in
 * whether access is enforced — and the parts they share are each load-bearing:
 * the chunking keeps a large set inside the lowest per-statement parameter limit
 * of the three dialects, `limit: chunk.length` stops a default page reporting
 * the remainder as missing, and `status: "all"` keeps a draft from reading as
 * absent. Written twice, those are three chances for the two answers to stop
 * being comparable — and the whole point is to subtract one from the other.
 */
async function idsReturnedBy(
  collection: string,
  entryIds: readonly string[],
  locale: string | null | undefined,
  access: { overrideAccess: boolean; caller?: ReadCaller }
): Promise<Set<string>> {
  const found = new Set<string>();
  if (entryIds.length === 0) return found;

  // Built once: nothing here varies per chunk, and assembling it inside the
  // loop put the identity and locale decisions on every iteration.
  const scoped = identityOptions(locale, access);
  for (const chunk of chunked(entryIds)) {
    const result = await getNextly().find({
      collection,
      where: { id: { in: chunk } },
      select: { id: true },
      // The whole chunk can legitimately come back; a smaller page would report
      // the remainder as absent.
      limit: chunk.length,
      status: "all",
      ...scoped,
    });
    for (const item of result.items ?? []) {
      const id = (item as { id?: unknown }).id;
      if (typeof id === "string") found.add(id);
    }
  }
  return found;
}

/**
 * Which of `entryIds` this caller may READ, asked of the ordinary read path.
 *
 * `overrideAccess: false`, so a stored `owner-only` or `custom` rule narrows the
 * answer exactly as it would for a normal read — which is the point: the rule is
 * evaluated by the path that owns it rather than reproduced here.
 */
export async function readableDocumentIds(
  collection: string,
  entryIds: readonly string[],
  caller: ReadCaller,
  locale?: string | null
): Promise<Set<string>> {
  return idsReturnedBy(collection, entryIds, locale, {
    overrideAccess: false,
    caller,
  });
}

/**
 * Which of `entryIds` still EXIST in `collection`, regardless of who is asking.
 *
 * 🔴 `overrideAccess: true`, and the distinction it buys is the only reason this
 * exists. A document a caller may not read and a document that is GONE are the
 * same absence to {@link readableDocumentIds} — both are simply missing from
 * what comes back — and the activity feed has to tell them apart, because a
 * delete removes the row BEFORE the `entry.deleted` event is appended. Judged by
 * readability alone, every deletion and all history for the removed document
 * vanish from the feed for everyone, super admins included.
 *
 * Its answer never reaches a reader on its own. The caller uses it only to
 * decide whether a row it has already been REFUSED describes something that no
 * longer exists, and such a row is kept with its identifying detail removed — so
 * what a privileged read establishes here is "there is nothing left to
 * authorize", never a fact about a document the caller may not see.
 */
export async function existingDocumentIds(
  collection: string,
  entryIds: readonly string[],
  locale?: string | null
): Promise<Set<string>> {
  return idsReturnedBy(collection, entryIds, locale, { overrideAccess: true });
}
