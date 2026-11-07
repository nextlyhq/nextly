/**
 * The entry reads the editor's read routes share: one list read AS THE CALLER,
 * and how one row it returns becomes `{ id, title }`.
 *
 * Shared rather than restated per route, so the entries route and the pages
 * search hand the Direct API the same caller and name an entry by the same
 * rule. A second copy of either would agree on the day it was written and
 * drift after, and the read's copy is the one that decides who sees what.
 *
 * @module entry-reads
 */
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
import type { PaginationMeta, WhereFilter } from "nextly";
import { readableTitleText } from "nextly/config";
import { requireNextly, type EditorSourceReader } from "nextly/runtime";

import { readOrNull } from "./composition-route-kit";
import { ENTRIES_UNTITLED, type EntryItem } from "./entries-contract";
import { readingAsUser } from "./library-route";

/** One as-caller list read, as a route asks the Direct API for it. */
export interface AsCallerFindArgs {
  readonly collection: string;
  readonly where?: WhereFilter;
  readonly select: Record<string, boolean>;
  /** Fields to order by, ascending, each breaking the ties of the one before. */
  readonly sort?: readonly string[];
  readonly limit: number;
  /** Which page of `limit` rows, from 1; the first when absent. */
  readonly page?: number;
  /**
   * Rows to skip before the first one returned, instead of a page, for a read
   * that resumes where an earlier one stopped mid-page (the pages search's
   * cursor). Core refuses it together with `page`.
   */
  readonly offset?: number;
  /** The language to read in, when the request named one. */
  readonly locale?: string;
  /**
   * Refuse a sort key naming no field this caller may sort by, naming each,
   * rather than sorting by the others: for a read that asks which keys core
   * accepts.
   */
  readonly unknownSort?: "refuse";
}

/** What one list read answers: the rows and the read's pagination. */
export interface AsCallerPage {
  readonly items: readonly unknown[];
  readonly meta: PaginationMeta;
}

/**
 * One list read through the Direct API AS THE CALLER: `overrideAccess: false`
 * with the identity the dispatcher resolved, so the collection's read rule,
 * row filters and field-level read rules all apply as to the caller's own
 * reads.
 */
export async function findAsCaller(
  ctx: Pick<PluginRouteContext, "caller">,
  args: AsCallerFindArgs
): Promise<AsCallerPage> {
  const result = await requireNextly().find({
    collection: args.collection,
    ...(await readingAsUser(ctx)),
    // Every status, as the admin's own relationship picker asks: an author
    // may choose or open an entry that is not published yet. Which rows this
    // caller sees is still core's to decide, through the line above.
    status: "all",
    ...(args.where === undefined ? {} : { where: args.where }),
    select: args.select,
    ...(args.sort === undefined ? {} : { sort: [...args.sort] }),
    limit: args.limit,
    ...(args.page === undefined ? {} : { page: args.page }),
    ...(args.offset === undefined ? {} : { offset: args.offset }),
    ...(args.locale === undefined ? {} : { locale: args.locale }),
    ...(args.unknownSort === undefined
      ? {}
      : { unknownSort: args.unknownSort }),
  });
  return { items: result.items, meta: result.meta };
}

/**
 * The editor reader AS THE CALLER, in `locale`: the public reader's queries,
 * read as the signed-in person (their user, and an API key's own scope when
 * the request carried one) with drafts included, a Single's, and one entry by
 * its id with its pending working draft. Shared by the canvas's list and
 * binding reads and the template preview, so each reads as the same person
 * by the same statement.
 */
export async function editorReaderAsCaller(
  ctx: Pick<PluginRouteContext, "caller">,
  locale: string | undefined
): Promise<EditorSourceReader> {
  // Imported at call time, so a route module loading this one costs none of
  // the reader until it reads.
  const { createEditorReader } = await import("nextly/runtime");
  const nextly = requireNextly();
  const { user, actor } = await readingAsUser(ctx);
  return createEditorReader(
    {
      find: async args => await nextly.find(args),
      findSingle: async args => await nextly.findSingle(args),
      // The by-id read, which alone returns a pending working draft.
      findByID: async args => await nextly.findByID(args),
    },
    { user, ...(actor === undefined ? {} : { actor }) },
    locale === undefined ? {} : { locale }
  );
}

/**
 * The ids, with one of core's reserved workflow keys at the filter's top
 * level, where core reads them.
 *
 * Asserted rather than typed: the keys take `true` itself, a form the
 * `WhereFilter` type, spelled for field conditions, does not describe. The
 * spelling is core's (`nextly/reserved-filter-keys`), so it is not restated.
 */
function workflowWhere(key: string, ids?: readonly string[]): WhereFilter {
  const where: Record<string, unknown> = {
    ...(ids === undefined ? {} : { id: { in: [...ids] } }),
    [key]: true,
  };
  return where as WhereFilter;
}

/**
 * Every entry core's workflow filter `key` keeps, as a where clause: for a
 * read that lists them rather than asks about given ids.
 */
export function workflowKeyWhere(key: string): WhereFilter {
  return workflowWhere(key);
}

/**
 * Which of `ids` core's workflow filter `key` keeps (`_pendingChange`,
 * `_inRelease`), read through `find`, a read AS THE CALLER.
 *
 * Core's own reading, not one here: `_pendingChange` keeps an entry whose
 * working draft holds changes not yet published, by the versions domain's one
 * statement of what a working draft is (the fact behind the admin's
 * `hasWorkingDraft`). Only ids are selected, and the ids already bound the
 * read. A failure is the caller's to judge, so it is thrown as it came:
 * shared by the pages search and the template preview's list, which each
 * decide what a failed read leaves out.
 */
export async function idsKeptByWorkflowKey(
  find: (args: AsCallerFindArgs) => Promise<AsCallerPage>,
  collection: string,
  ids: readonly string[],
  key: string
): Promise<ReadonlySet<string>> {
  if (ids.length === 0) return new Set();
  const page = await find({
    collection,
    where: workflowWhere(key, ids),
    select: { id: true },
    limit: ids.length,
  });
  return new Set(
    page.items.flatMap(row => {
      const entry = entryOf(row, undefined);
      return entry === undefined ? [] : [entry.id];
    })
  );
}

/**
 * One entry as it is SAVED, read as the caller: its working draft where one
 * waits, else the stored row. A Save that does not publish stores a working
 * draft, so a list read, which answers with the live row, would report what
 * the entry was before that Save. `null` where the caller may not read it or
 * it does not exist.
 */
export async function readSavedAsCaller(
  ctx: Pick<PluginRouteContext, "caller">,
  args: {
    readonly collection: string;
    readonly id: string;
    readonly select: Record<string, boolean>;
    readonly locale?: string;
  }
): Promise<Record<string, unknown> | null> {
  const row = await readOrNull(async () =>
    requireNextly().findByID({
      collection: args.collection,
      id: args.id,
      ...(await readingAsUser(ctx)),
      status: "all",
      draft: true,
      depth: 0,
      select: args.select,
      ...(args.locale === undefined ? {} : { locale: args.locale }),
    })
  );
  return row !== null && typeof row === "object"
    ? (row as Record<string, unknown>)
    : null;
}

/**
 * One row as `{ id, title }`, or nothing when it carries no usable id.
 *
 * A numeric id travels as a string. The title is read through core's rule for
 * a title VALUE, so a title of spaces is as untitled here as on every other
 * surface; a row without one — empty, or removed by field-level read access —
 * is labelled with the neutral {@link ENTRIES_UNTITLED}, never another field.
 */
export function entryOf(
  row: unknown,
  titleField: string | undefined
): EntryItem | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const record = row as Record<string, unknown>;
  const id = typeof record.id === "number" ? String(record.id) : record.id;
  if (typeof id !== "string" || id === "") return undefined;
  return { id, title: titleOf(record, titleField) ?? ENTRIES_UNTITLED };
}

/** The readable title a row holds in `titleField`, or `undefined` for none. */
function titleOf(
  record: Record<string, unknown>,
  titleField: string | undefined
): string | undefined {
  if (titleField === undefined || !Object.hasOwn(record, titleField)) {
    return undefined;
  }
  return readableTitleText(record[titleField]);
}

/**
 * Whether the caller may read a Single's document, read through the Single
 * API as the caller, without creating it: `false` where the caller may not
 * read it. A Single nobody has saved is judged by its default document, which
 * the usage index counts and its first read will store.
 */
export async function singleReadableByCaller(
  ctx: Pick<PluginRouteContext, "caller">,
  slug: string
): Promise<boolean> {
  const row = await readOrNull(async () =>
    requireNextly().findSingle({
      slug,
      ...(await readingAsUser(ctx)),
      createIfMissing: false,
      whenAbsent: "default",
      status: "all",
      select: { id: true },
      depth: 0,
    })
  );
  return row !== null && typeof row === "object";
}
