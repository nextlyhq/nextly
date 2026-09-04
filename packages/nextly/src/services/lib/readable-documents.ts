/**
 * Which of these documents the caller may actually READ, asked of the ordinary
 * read path.
 *
 * 🔴 Entity-level access is one axis short of the question, and its own contract
 * says so: `readableEntities` decides whether a collection is in reach AT ALL,
 * leaving the per-row rules of whatever query follows to decide which documents
 * come back. A collection carrying a stored `owner-only` or `custom` read rule
 * therefore admits every editor at the coarse check while the read path narrows
 * to a subset — so a cross-document read keyed by collection name alone reports
 * one author's documents to another.
 *
 * That is not a hypothetical shape: the dashboard's own statistics once counted
 * rows straight from the physical table and disclosed exactly this, and the
 * repair was to route the numbers through the access-enforced path rather than
 * to reproduce the rule. This module is that repair, made reusable — any system
 * source keyed by collection and document id needs the same intersection.
 *
 * The rule is never re-implemented here. A stored rule can be `owner-only` or a
 * `custom` function, and evaluating either against rows is the read path's job;
 * this asks it which of a known set of ids survive, which is the same question
 * a caller opening those documents would get answered.
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
 */
export async function readableDocumentIds(
  collection: string,
  entryIds: readonly string[],
  caller: ReadCaller
): Promise<Set<string>> {
  const readable = new Set<string>();
  if (entryIds.length === 0) return readable;

  for (const chunk of chunked(entryIds)) {
    const result = await getNextly().find({
      collection,
      where: { id: { in: chunk } },
      select: { id: true },
      // The whole chunk can legitimately come back; a smaller page would report
      // the remainder as unreadable.
      limit: chunk.length,
      status: "all",
      overrideAccess: false,
      user: caller.user,
      ...(caller.authenticatedScope
        ? { actor: caller.authenticatedScope }
        : {}),
    });
    for (const item of result.items ?? []) {
      const id = (item as { id?: unknown }).id;
      if (typeof id === "string") readable.add(id);
    }
  }
  return readable;
}
