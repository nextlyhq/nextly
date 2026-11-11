/**
 * The person reading the problem list, as the list asks about them: which
 * of its pages they may read, asked of the collections themselves as that
 * person, so a read rule that admits only some entries (their own, say)
 * decides, as it does for every other read. The list's routes and the
 * dashboard's SEO card both read the list through it, each with the reads
 * bound to its own person.
 *
 * @module problems/reader
 */
import { pageRefKey, type Reader } from "./check";
import { pageTypeOf } from "./page-types";

/** The reads a reader is judged by, each made as the person. */
export interface ReadsAs {
  /** Which of `ids`, entries of the collection `type`, the person may read. */
  readable(type: string, ids: readonly string[]): Promise<string[]>;
  /** How many entries of the collection `type` the person may read. */
  count(type: string): Promise<number>;
}

/** The pages of `refs` grouped by type, each id once. */
function idsByType(
  refs: Parameters<Reader["pages"]>[0]
): Map<string, string[]> {
  const byType = new Map<string, Set<string>>();
  for (const { type, id } of refs) {
    const ids = byType.get(type) ?? new Set<string>();
    ids.add(id);
    byType.set(type, ids);
  }
  return new Map([...byType].map(([type, ids]) => [type, [...ids]]));
}

/**
 * The reader `reads` reads as, who may read the types `types` names, by the
 * key their pages are kept under. A type they may not read at all is not
 * asked about, and a Single's page is theirs where they may read the
 * Single. `seesRedirects` is whether they hold site-wide SEO.
 */
export function readerAs(
  reads: ReadsAs,
  types: ReadonlySet<string>,
  seesRedirects: boolean
): Reader {
  const pages: Reader["pages"] = async refs => {
    const allowed = new Set<string>();
    for (const [type, ids] of idsByType(refs)) {
      if (!types.has(type)) continue;
      // A Single's one page is read by whoever may read the Single.
      const readable =
        pageTypeOf(type).kind === "single"
          ? ids
          : await reads.readable(type, ids);
      for (const id of readable) allowed.add(pageRefKey({ type, id }));
    }
    return allowed;
  };
  return {
    pages,
    readsType: type => types.has(type),
    count: type => reads.count(type),
    seesRedirects,
  };
}

/** `ids` in pieces of at most `size`, each read by `read`, the answers joined. */
export async function inChunks(
  ids: readonly string[],
  size: number,
  read: (chunk: string[]) => Promise<string[]>
): Promise<string[]> {
  const found: string[] = [];
  for (let at = 0; at < ids.length; at += size) {
    found.push(...(await read(ids.slice(at, at + size))));
  }
  return found;
}
