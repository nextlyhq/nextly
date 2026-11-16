/**
 * What one found page carries: the item built from a row, its path and
 * status, where a page stands, and which field refusals a read can step
 * around.
 *
 * Part of the pages search. `pages-search-route.ts` is the entry, and its
 * header explains what the search reads, who decides access, and paging.
 *
 * @module pages-search-items
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { previewUrlFromTemplate } from "nextly/config";

import { documentVersionOf } from "./document-version";
import { entryOf } from "./entry-reads";
import type { PageCollection } from "./pages-search-collections";
import type { PageItem, PageState, PageStatus } from "./pages-search-contract";
import { STATUS_COLUMN } from "./pages-search-request";

/** The refusal codes core answers a filter or an order on an unreadable field with. */
const FIELD_REFUSALS: ReadonlySet<string> = new Set([
  "FIELD_NOT_FILTERABLE",
  "FIELD_NOT_SORTABLE",
]);

/**
 * Whether an error is core refusing a filter or an order on `field` because
 * this caller may not read it.
 *
 * Read from the validation error's own entries, which name the position and
 * the field, so an unrelated validation failure is never mistaken for one and
 * swallowed. The top-level code is also accepted, the shape the entries route
 * reads.
 */
export function refusesField(error: unknown, field: string): boolean {
  if (!NextlyError.is(error)) return false;
  if (FIELD_REFUSALS.has(error.code)) return true;
  if (!NextlyError.isValidation(error)) return false;
  const data = error.publicData as { errors?: unknown } | undefined;
  if (!Array.isArray(data?.errors)) return false;
  return data.errors.some(entry => namesFieldRefusal(entry, field));
}

/** Whether one validation entry is a filter or order refusal naming `field`. */
function namesFieldRefusal(entry: unknown, field: string): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const { code, path } = entry as { code?: unknown; path?: unknown };
  return (
    typeof code === "string" &&
    FIELD_REFUSALS.has(code) &&
    (path === `where.${field}` || path === `sort.${field}`)
  );
}

/** One row as a search result, or nothing when it is not one the caller can open. */
export function itemOf(
  row: unknown,
  source: PageCollection
): PageItem | undefined {
  // A page whose Page Builder field this caller may not read is not one it
  // can open, so it is not listed. Core's field-level read decided that, by
  // leaving the field out of the row.
  if (!holdsField(row, source.field)) return undefined;
  return pageItemOf(row, source);
}

/**
 * One row as a page item, or nothing when it carries no usable id. Shared with
 * the writes, which answer the page they wrote in the shape the search lists.
 *
 * The id and title by the rule the entries route names an entry by, so an
 * untitled page carries the same neutral label. The status travels only from
 * a lifecycle collection, and only as one of the two values it holds.
 */
export function pageItemOf(
  row: unknown,
  source: PageCollection
): PageItem | undefined {
  const entry = entryOf(row, source.title?.name);
  if (entry === undefined) return undefined;
  const status = source.lifecycle ? statusOf(row) : undefined;
  const rev = documentVersionOf(row);
  return {
    id: entry.id,
    collection: source.slug,
    collectionLabel: source.label,
    ...(source.pluralLabel === undefined
      ? {}
      : { collectionPluralLabel: source.pluralLabel }),
    field: source.field,
    title: entry.title,
    ...(status === undefined ? {} : { status }),
    ...(rev === undefined ? {} : { rev }),
    ...pathOf(row, source),
  };
}

/**
 * Where a page is served, resolved from its collection's `pathTemplate`, or
 * nothing where the collection has none or the row cannot fill it (a page
 * with no slug yet).
 */
export function pathOf(
  row: unknown,
  source: PageCollection
): { path?: string } {
  if (source.pathTemplate === undefined) return {};
  if (typeof row !== "object" || row === null) return {};
  // Only the plugin's own Pages have a template, and their slug is a path
  // (`db.slugPaths`), so its `/` stays, as in their preview.
  const path = previewUrlFromTemplate(source.pathTemplate, {
    pathFields: source.slugField === undefined ? [] : [source.slugField.name],
  })(row as Record<string, unknown>);
  return typeof path === "string" && path !== "" ? { path } : {};
}

/** The top-level key a form path is stored under: `hero` for `hero.body`. */
export function topKeyOf(path: string): string {
  return path.split(".")[0] ?? path;
}

/**
 * Whether a row carries the field at `path`, or core withheld it.
 *
 * Core withholds a field by DELETING its key from the row (there is no
 * marker), at the field's own level, inside a group as at the top. Only the
 * top-level key is evidence: it is a column the read selected, so it comes
 * back (as `null` when empty) unless it was withheld. Below it, an absent key
 * is also what a group stored before the field existed holds, so it says
 * nothing, and the page is listed: an editor that opens on a field it then
 * shows empty costs less than a page the author can open never being offered.
 */
function holdsField(row: unknown, path: string): boolean {
  return (
    typeof row === "object" &&
    row !== null &&
    Object.hasOwn(row, topKeyOf(path))
  );
}

/** A row's stored status, when it is one the lifecycle holds. */
function statusOf(row: unknown): PageStatus | undefined {
  const value = (row as Record<string, unknown>)[STATUS_COLUMN];
  return value === "draft" || value === "published" ? value : undefined;
}

/**
 * Where a page stands in publishing, from the facts the admin's status pill
 * is drawn from (`pillStateFromForm(status, false, hasWorkingDraft)`): its
 * stored status and whether a working draft waits on it; and, beside them,
 * whether a scheduled release will publish it, which the author must know
 * first. `undefined` for a plainly published page and for a page without the
 * lifecycle.
 */
export function pageStateOf(
  status: PageStatus | undefined,
  hasWorkingDraft: boolean,
  scheduled: boolean
): PageState | undefined {
  if (status === undefined) return undefined;
  if (scheduled) return "scheduled";
  if (status === "published") return hasWorkingDraft ? "changed" : undefined;
  return "draft";
}
