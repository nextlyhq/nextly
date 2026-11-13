/**
 * One page of a registry table's listing, its total and its order, derived in
 * memory from the listing the process already holds.
 *
 * **The registry is the documented exception to "filter and paginate in the
 * database".** Content lists page in SQL because a content table grows with
 * what people write. A registry table (`dynamic_collections`,
 * `dynamic_singles`, `dynamic_components`) holds one row per collection,
 * Single or field group, made by schema changes and never by content: tens of
 * rows, a few hundred on the largest installs reported. Its whole listing is
 * already kept in memory, keyed by the stored schema version
 * (`cachedRegistryListing`), and every other read of the whole registry is
 * derived from it. A page, its total, a search and a sort are narrower views
 * of the same rows, so they are derived here too rather than asked of the
 * database again on every request: one snapshot answers both the page and
 * the total, so the two cannot disagree, and a registry that has not changed
 * costs no statement. Above {@link REGISTRY_LISTING_WARN_ROWS} rows a warning
 * is logged once per table, the signal to revisit this.
 *
 * Every condition that decides what a reader may see (the permission
 * allowlist, the plugins' denylist) is applied to the rows BEFORE they are
 * counted and paged, so a total never counts a row the reader cannot see.
 *
 * Search is a literal, case-insensitive substring match folded as
 * `foldCase` folds it: the rule `ICONTAINS` applies in SQL on every dialect,
 * so a search here matches what it matched as a query.
 *
 * @module shared/lib/registry-listing-page
 */
import { foldCase } from "@nextlyhq/adapter-drizzle/text-match";

/** One stored registry row, as the listing holds it. */
export type RegistryRow = Readonly<Record<string, unknown>>;

/**
 * How many rows a registry table may list before a warning says the
 * in-memory page is worth revisiting. Above it every page still works.
 */
export const REGISTRY_LISTING_WARN_ROWS = 2000;

/** What one page of a registry listing asks for. */
export interface RegistryPageQuery {
  /** Rows the reader may see; applied before the total is counted. */
  include: (row: RegistryRow) => boolean;
  /** Text to find, and the columns it is looked for in. */
  search?: { text: string; columns: readonly string[] };
  /** The column to order by; `thenBy` and then `id` break ties. */
  orderBy: string;
  /**
   * A column that breaks a tie in `orderBy`, ascending, before `id` does: a
   * registry orders rows created in the same second by slug, since MySQL
   * keeps `created_at` to the second and `id` is random.
   */
  thenBy?: string;
  direction: "asc" | "desc";
  /** Rows skipped before the page. */
  offset?: number;
  /** The most rows on the page; all of them when absent. */
  limit?: number;
}

/** A page of rows and the total of rows that matched. */
export interface RegistryPage {
  rows: RegistryRow[];
  total: number;
}

/** A column's value as text a search looks in: a JSON column as its serialized text. */
function searchableText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** A column's value as something two rows compare by. */
function orderKey(value: unknown): number | string {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** -1, 0 or 1 as `a` sorts before, with or after `b`. */
function compareKeys(a: number | string, b: number | string): number {
  if (typeof a === typeof b) return a < b ? -1 : a > b ? 1 : 0;
  // A number before text: only a column mixing the two, which none does.
  return typeof a === "number" ? -1 : 1;
}

/**
 * The page `query` asks for of `rows`, and how many rows matched before
 * paging. `rows` are not changed, and the page holds the same row objects:
 * the caller copies what it hands out.
 */
export function registryPage(
  rows: readonly RegistryRow[],
  query: RegistryPageQuery
): RegistryPage {
  const needle =
    query.search && query.search.text !== ""
      ? foldCase(query.search.text)
      : undefined;
  const columns = query.search?.columns ?? [];
  const matching = rows.filter(
    row =>
      query.include(row) &&
      (needle === undefined ||
        columns.some(column =>
          foldCase(searchableText(row[column])).includes(needle)
        ))
  );
  const sign = query.direction === "asc" ? 1 : -1;
  const { thenBy } = query;
  const ordered = [...matching].sort(
    (a, b) =>
      sign *
        compareKeys(orderKey(a[query.orderBy]), orderKey(b[query.orderBy])) ||
      (thenBy === undefined
        ? 0
        : compareKeys(orderKey(a[thenBy]), orderKey(b[thenBy]))) ||
      compareKeys(orderKey(a.id), orderKey(b.id))
  );
  const offset = Math.max(0, query.offset ?? 0);
  const end = query.limit === undefined ? undefined : offset + query.limit;
  return { rows: ordered.slice(offset, end), total: matching.length };
}

/** The registries a size warning has been logged for in this process. */
const warnedRegistries = new Set<string>();

/**
 * Say once per registry (`registry` names it: "Collection", "Single"),
 * through `warn`, that its listing holds more rows than
 * {@link REGISTRY_LISTING_WARN_ROWS}: the registry is paged in memory on the
 * grounds that it stays small (see the module comment).
 */
export function warnIfRegistryListingLarge(
  registry: string,
  rowCount: number,
  warn: (message: string) => void
): void {
  if (
    rowCount <= REGISTRY_LISTING_WARN_ROWS ||
    warnedRegistries.has(registry)
  ) {
    return;
  }
  warnedRegistries.add(registry);
  warn(
    `The ${registry} registry lists ${rowCount} rows, more than ` +
      `${REGISTRY_LISTING_WARN_ROWS}. Its pages, totals, searches and sorts ` +
      "are worked out in memory from the whole listing, which suits a " +
      "registry of a few hundred rows; one this large is worth reporting."
  );
}
