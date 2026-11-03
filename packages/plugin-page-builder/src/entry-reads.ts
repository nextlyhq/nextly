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
import { requireNextly } from "nextly/runtime";

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
  /** The language to read in, when the request named one. */
  readonly locale?: string;
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
    ...(args.locale === undefined ? {} : { locale: args.locale }),
  });
  return { items: result.items, meta: result.meta };
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
