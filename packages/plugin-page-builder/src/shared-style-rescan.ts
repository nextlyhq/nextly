/**
 * Which stored documents still reference some shared styles or variables,
 * read from the documents themselves rather than from a usage index.
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
 * the extractor the caller names, which is the walk its index records from
 * (`classUsageOf` for shared styles, `tokenUsageOf` for variables), so the
 * rescan and the index cannot disagree about what a reference is.
 *
 * ## Every stored form
 *
 * A list read gives a collection row as stored in the default language,
 * without its pending working draft. A removal is the one act that turns a
 * use the rescan missed into lost styling, so each listed row is read again
 * in every other form it may be stored in: each of the site's languages, and
 * the working draft in each, by the by-id read the usage index is maintained
 * through (`class-usage-runtime`), so the two agree on what each form is. A
 * Single is read in the same forms. A form that cannot be read refuses the
 * removal rather than being taken for one using nothing.
 *
 * That costs a read per form of each document, which only a removal pays.
 *
 * @module shared-style-rescan
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import { SHARED_STYLE_IN_USE_CODE } from "./library-contract";
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

/**
 * The references one stored blocks value holds, by the walk an index records
 * from. Handed in, so one rescan serves every index.
 */
export type ReferencesOf = (stored: unknown) => readonly string[];

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
  /**
   * A row's stored forms beyond the listed one: its document in each of the
   * site's languages, and its pending working draft in each. A form the row
   * does not have is left out; one that cannot be read throws.
   */
  rowForms(type: BuilderDocumentType, id: string): Promise<readonly unknown[]>;
  /**
   * A Single's stored forms: its document and its pending draft, in each of
   * the site's languages.
   */
  singleForms(type: BuilderDocumentType): Promise<readonly unknown[]>;
}

/**
 * The same stored documents, read only until `signal` is aborted: every read
 * asked after that throws instead of reaching the database. A walk whose
 * answer nobody waits for any more (its time ran out) stops at its next read,
 * rather than going on through every page of every collection.
 */
export function stoppedBy(
  documents: StoredDocuments,
  signal: AbortSignal
): StoredDocuments {
  const reading = <T>(read: () => Promise<T>): Promise<T> => {
    if (signal.aborted) {
      return Promise.reject(
        NextlyError.internal({
          logContext: { reason: "stored-document-walk-stopped" },
        })
      );
    }
    return read();
  };
  return {
    collections: () => reading(() => documents.collections()),
    singles: () => reading(() => documents.singles()),
    rowsAfter: (type, after) => reading(() => documents.rowsAfter(type, after)),
    rowForms: (type, id) => reading(() => documents.rowForms(type, id)),
    singleForms: type => reading(() => documents.singleForms(type)),
  };
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
  ids: ReadonlySet<string>,
  referencesOf: ReferencesOf
): boolean {
  return paths.some(path =>
    referencesOf(valueAt(row, path)).some(id => ids.has(id))
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
 * Whether any other stored form of a listed row references one of `ids`.
 * A form that cannot be read is refused, so the removal fails closed rather
 * than passing over a use it could not see.
 */
async function otherFormsReference(
  type: BuilderDocumentType,
  id: string,
  ids: ReadonlySet<string>,
  documents: StoredDocuments,
  referencesOf: ReferencesOf
): Promise<boolean> {
  let forms: readonly unknown[];
  try {
    forms = await documents.rowForms(type, id);
  } catch (error) {
    throw NextlyError.internal({
      ...(error instanceof Error ? { cause: error } : {}),
      logContext: {
        reason: "shared-style-rescan-form-unreadable",
        collection: type.slug,
        id,
      },
    });
  }
  return forms.some(form => referencesAny(form, type.paths, ids, referencesOf));
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
  documents: StoredDocuments,
  referencesOf: ReferencesOf
): Promise<StoredUse[]> {
  const uses: StoredUse[] = [];
  let after: string | undefined;
  await walkPages({
    fetchPage: async () => {
      const page = await documents.rowsAfter(type, after);
      return { items: [...page.items], meta: { hasNext: page.hasNext } };
    },
    onPage: async items => {
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
        if (
          referencesAny(row, type.paths, ids, referencesOf) ||
          (await otherFormsReference(type, id, ids, documents, referencesOf))
        ) {
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
  documents: StoredDocuments,
  referencesOf: ReferencesOf
): Promise<StoredUse[]> {
  if (ids.length === 0) return [];
  const asked = new Set(ids);
  const uses: StoredUse[] = [];
  for (const type of await documents.collections()) {
    uses.push(...(await collectionUses(type, asked, documents, referencesOf)));
  }
  for (const type of await documents.singles()) {
    const forms = await documents.singleForms(type);
    if (
      forms.some(form => referencesAny(form, type.paths, asked, referencesOf))
    ) {
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

/**
 * The refusal's words for references still stored on `count` documents: the
 * first one the caller may open named where the check can ask a caller
 * (`canName`), else the documents only counted, as for a write whose author
 * cannot be asked.
 */
function stillUsedWords(
  count: number,
  first: string | undefined,
  removing: number,
  canName: boolean
): string {
  if (canName) return stillUsedMessage(count, first, removing);
  // Counted in pages, as the named refusal counts what it can't open, so the
  // two read alike whichever one the author meets.
  const it = removing === 1 ? "it" : "them";
  const pages = count === 1 ? "1 page" : `${count} pages`;
  const those = count === 1 ? "that page" : "those pages";
  return `Still used on ${pages}. Remove ${it} from ${those} first.`;
}

/**
 * The stored documents' own answer to whether some shared styles or
 * variables are still referenced, and how the first use the caller may open
 * is named; without `firstReadable`, no document is named.
 */
export interface StillUsed {
  /** Every stored document still referencing any of the ids, read past access. */
  uses(ids: readonly string[]): Promise<readonly StoredUse[]>;
  /** The title of the first of these the caller may open, if any. */
  firstReadable?(uses: readonly StoredUse[]): Promise<string | undefined>;
}

/**
 * Refuse, with the in-use refusal, when a stored document still references
 * any of the ids: the stored documents' own answer, read past the index,
 * which every removal of a shared style or a variable asks. One
 * implementation for both, so the two refusals cannot drift. `logKey` names
 * what the ids are in the server log (`classIds`, `variableIds`).
 */
export async function refuseStoredUses(
  ids: readonly string[],
  stillUsed: StillUsed,
  logKey: string
): Promise<void> {
  const uses = await stillUsed.uses(ids);
  if (uses.length === 0) return;
  const message = stillUsedWords(
    uses.length,
    await stillUsed.firstReadable?.(uses),
    ids.length,
    stillUsed.firstReadable !== undefined
  );
  throw NextlyError.validation({
    errors: [{ path: "", code: SHARED_STYLE_IN_USE_CODE, message }],
    logContext: {
      [logKey]: ids,
      uses: uses.map(use => `${use.kind}:${use.slug}:${use.id}`),
    },
  });
}
