/**
 * Which stored documents still reference some shared styles, read from the
 * documents themselves rather than from the usage index.
 *
 * The index is the fast answer and it can be wrong low: two saves of one
 * document that interleave can each remove the usage row the other wrote
 * (`class-usage-maintenance`), leaving a document that applies a style while
 * the index is healthy and counts zero. A zero is therefore not proof of
 * non-use, and removing a style is the one act that turns an under-count into
 * lost styling. So removal reads the documents again, just before it writes.
 *
 * ## What it reads
 *
 * Every collection and every live Single that declares a blocks field the
 * builder opens (the same reading the site-style route's access gate uses),
 * each collection a page of 100 rows at a time, as the system: this is a
 * safety check, not an answer to the caller, so a document the caller may not
 * read still holds a style. Each blocks field's stored document is walked by
 * `classUsageOf`, the walk the index records from, so the two cannot disagree
 * about what a reference is.
 *
 * ## What it does not
 *
 * A collection row is read as stored, in the default language, without its
 * pending working draft: a list read overlays neither, and reading each
 * document again by id per language and per draft would cost a query per
 * document per form. Those forms stay covered by the usage index, which
 * removal asks first; this read guards the stored rows the index can lose.
 * A Single is one document, so both of its forms are read.
 *
 * @module shared-style-rescan
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import { classUsageOf } from "./class-usage";
import { walkPages } from "./paged-walk";
import type { BuilderDocumentType } from "./site-style-route";
import { readStoredJson } from "./stored-json";

/** How many rows one read of a collection asks for. */
export const RESCAN_PAGE_SIZE = 100;

/**
 * A guard against a store whose paging never says it is done, counted in
 * pages requested. Reaching it means the store is answering wrongly, not that
 * the site is large: 100 rows a page, this is a million documents per
 * collection.
 */
const RESCAN_PAGES_MAX = 10_000;

/** One stored document that still references a style. */
export interface StoredUse {
  readonly kind: "collection" | "single";
  /** The collection or Single holding it. */
  readonly slug: string;
  /** The document's id; empty for a Single, which is addressed by slug. */
  readonly id: string;
  /** The Single's label, which is how it is named; absent for a collection row. */
  readonly label?: string;
}

/** The stored documents the rescan reads, past every access rule. */
export interface StoredDocuments {
  /** Every collection declaring a blocks field the builder opens. */
  collections(): Promise<readonly BuilderDocumentType[]>;
  /** Every live Single declaring a blocks field the builder opens. */
  singles(): Promise<readonly BuilderDocumentType[]>;
  /**
   * The next rows of a collection, ordered by id, after the id named (from the
   * first when none is), with the blocks fields at `type.paths` and the id.
   */
  rowsAfter(
    type: BuilderDocumentType,
    after: string | undefined
  ): Promise<{ items: readonly unknown[]; hasNext: boolean }>;
  /** A Single's stored forms: its document, and its pending draft if any. */
  singleForms(type: BuilderDocumentType): Promise<readonly unknown[]>;
}

/**
 * The value at a dot-separated form path of a stored row. Each step is read
 * through `readStoredJson`, since a group may arrive as the text SQLite
 * stored it.
 */
function valueAt(row: unknown, path: string): unknown {
  let at: unknown = row;
  for (const key of path.split(".")) {
    const record = readStoredJson(at);
    if (typeof record !== "object" || record === null) return undefined;
    if (!Object.hasOwn(record, key)) return undefined;
    at = (record as Record<string, unknown>)[key];
  }
  return at;
}

/** Whether a stored row's blocks fields reference any of `ids`. */
export function referencesAny(
  row: unknown,
  paths: readonly string[],
  ids: ReadonlySet<string>
): boolean {
  return paths.some(path =>
    classUsageOf(valueAt(row, path)).ids.some(id => ids.has(id))
  );
}

/** A listed row's id as the cursor reads it, or `undefined` when it has none. */
function rowId(row: unknown): string | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const id = (row as { id?: unknown }).id;
  if (typeof id === "number") return String(id);
  return typeof id === "string" && id !== "" ? id : undefined;
}

/**
 * The rows of one collection that reference any of `ids`.
 *
 * Paged by id rather than by offset: a document deleted behind an offset
 * shifts a later one back past the boundary, and a live document would be
 * skipped, which is the miss this read exists to prevent.
 */
async function collectionUses(
  type: BuilderDocumentType,
  ids: ReadonlySet<string>,
  documents: StoredDocuments
): Promise<StoredUse[]> {
  const uses: StoredUse[] = [];
  let after: string | undefined;
  await walkPages({
    fetchPage: async () => {
      const page = await documents.rowsAfter(type, after);
      return { items: [...page.items], meta: { hasNext: page.hasNext } };
    },
    onPage: items => {
      for (const row of items) {
        const id = rowId(row);
        // A row with no id cannot move the cursor or be named, and skipping
        // it could pass over a document that uses a style; refused, so the
        // removal fails closed.
        if (id === undefined) {
          throw NextlyError.internal({
            logContext: {
              reason: "shared-style-rescan-row-without-id",
              collection: type.slug,
            },
          });
        }
        if (referencesAny(row, type.paths, ids)) {
          uses.push({ kind: "collection", slug: type.slug, id });
        }
        after = id;
      }
    },
    maxPages: RESCAN_PAGES_MAX,
    describe: `the "${type.slug}" documents`,
  });
  return uses;
}

/**
 * Every stored document that still references any of `ids`: each collection
 * the builder opens, row by row, then each live Single the builder opens.
 */
export async function storedUsesOf(
  ids: readonly string[],
  documents: StoredDocuments
): Promise<StoredUse[]> {
  if (ids.length === 0) return [];
  const asked = new Set(ids);
  const uses: StoredUse[] = [];
  for (const type of await documents.collections()) {
    uses.push(...(await collectionUses(type, asked, documents)));
  }
  for (const type of await documents.singles()) {
    const forms = await documents.singleForms(type);
    if (forms.some(form => referencesAny(form, type.paths, asked))) {
      uses.push({
        kind: "single",
        slug: type.slug,
        id: "",
        label: type.label ?? type.slug,
      });
    }
  }
  return uses;
}

/**
 * The refusal's words for styles still used on `count` documents, naming the
 * first the caller may open: "Still used on Home and 2 more. Remove it from
 * those pages first." `styles` is how many styles were asked to be removed.
 */
export function stillUsedMessage(
  count: number,
  firstReadable: string | undefined,
  styles: number
): string {
  const it = styles === 1 ? "it" : "them";
  if (firstReadable === undefined) {
    const pages = count === 1 ? "1 page" : `${count} pages`;
    return `Still used on ${pages} you can't open. Ask someone who can open ${count === 1 ? "it" : "them"} to remove ${it} first.`;
  }
  const more = count > 1 ? ` and ${count - 1} more` : "";
  const those = count === 1 ? "that page" : "those pages";
  return `Still used on ${firstReadable}${more}. Remove ${it} from ${those} first.`;
}
