/**
 * Naming documents to a person: the ones they may read by title, the rest
 * only counted.
 *
 * The walk reads every host as the system, since a host a person cannot see
 * still renders the component. What the person is TOLD is read again as
 * them, with their access enforced, so a document they may not read is never
 * named to them, only counted (spec R-10; the Layout removal's listing does
 * the same).
 *
 * @module component-delete/hosts
 */
import type { Nextly } from "nextly";

import { documentAddressOf } from "../host-rewrite/contract";
import type { PersonReads } from "../layout-removal/layout-references";

import type { DocumentList, NamedDocument } from "./contract";

/** How many documents one list names at most; the rest are counted. */
export const MOST_NAMED = 50;

/** How many ids one read asks about. */
const IDS_PER_READ = 50;

/** What naming needs. */
export interface NamingDeps {
  readonly nextly: Pick<Nextly, "find">;
  readonly asPerson: PersonReads;
  /**
   * Whether the person may read a Single, which is then named by its slug;
   * absent where that cannot be asked, and every Single is then counted.
   */
  readonly mayReadSingle?: (slug: string) => Promise<boolean>;
}

/** The documents a set of document keys names, as the person may see them. */
export async function namedDocuments(
  deps: NamingDeps,
  keys: readonly string[]
): Promise<DocumentList> {
  const unique = [...new Set(keys)];
  const listed = unique.slice(0, MOST_NAMED);
  const sorted = sortedByKind(listed);
  const singles = await namedSingles(deps, sorted.singles);
  const entries = await namedEntries(deps, sorted.entries);
  return {
    named: [...singles.named, ...entries.named],
    unreadable: sorted.unaddressed + singles.unreadable + entries.unreadable,
    more: unique.length - listed.length,
  };
}

/** Document keys, sorted into Singles and entries by collection. */
function sortedByKind(keys: readonly string[]): {
  singles: string[];
  entries: Map<string, string[]>;
  unaddressed: number;
} {
  const singles: string[] = [];
  const entries = new Map<string, string[]>();
  let unaddressed = 0;
  for (const key of keys) {
    const address = documentAddressOf(key);
    if (address === undefined) {
      unaddressed += 1;
    } else if (address.kind === "single") {
      singles.push(address.slug);
    } else {
      entries.set(address.slug, [
        ...(entries.get(address.slug) ?? []),
        address.id ?? "",
      ]);
    }
  }
  return { singles, entries, unaddressed };
}

/** The Singles the person may read, named by slug; the rest counted. */
async function namedSingles(
  deps: NamingDeps,
  slugs: readonly string[]
): Promise<{ named: NamedDocument[]; unreadable: number }> {
  const named: NamedDocument[] = [];
  for (const slug of slugs) {
    if ((await deps.mayReadSingle?.(slug)) === true) {
      named.push({ kind: "single", slug, title: slug });
    }
  }
  return { named, unreadable: slugs.length - named.length };
}

/** The entries the person may read, named by title; the rest counted. */
async function namedEntries(
  deps: NamingDeps,
  byCollection: ReadonlyMap<string, readonly string[]>
): Promise<{ named: NamedDocument[]; unreadable: number }> {
  const named: NamedDocument[] = [];
  let unreadable = 0;
  for (const [slug, ids] of byCollection) {
    const titles = await titlesIn(deps, slug, ids);
    for (const id of ids) {
      const title = titles.get(id);
      if (title === undefined) unreadable += 1;
      else named.push({ kind: "collection", slug, id, title });
    }
  }
  return { named, unreadable };
}

/** The titles of the entries of one collection the person may read, by id. */
async function titlesIn(
  deps: NamingDeps,
  collection: string,
  ids: readonly string[]
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  for (let at = 0; at < ids.length; at += IDS_PER_READ) {
    const chunk = ids.slice(at, at + IDS_PER_READ);
    try {
      const answered = await deps.nextly.find({
        collection,
        where: { id: { in: chunk } },
        status: "all",
        limit: chunk.length,
        depth: 0,
        ...deps.asPerson,
      });
      for (const row of answered.items) {
        const id = idOf(row);
        if (id !== null) titles.set(id, titleOf(row, id));
      }
    } catch {
      // A person refused the collection outright reads none of it, and is
      // told only how many documents there are.
    }
  }
  return titles;
}

/** A row's id as the walk keys it, or `null`. */
function idOf(row: unknown): string | null {
  if (typeof row !== "object" || row === null) return null;
  const id = (row as { id?: unknown }).id;
  if (typeof id === "string" && id !== "") return id;
  return typeof id === "number" ? String(id) : null;
}

/**
 * What a document is called: its title, name, label or slug, whichever it
 * has, as the person read it; its id when it has none of them.
 */
function titleOf(row: unknown, id: string): string {
  const fields = row as Record<string, unknown>;
  for (const key of ["title", "name", "label", "slug"]) {
    const value = fields[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return id;
}
