/**
 * What the Pages and addresses screen shows, worked out from the list the
 * server answers: the counts above the table, which addresses a filter and
 * a search keep, and the text of Google's result. Pure, so each is tested
 * without the screen.
 *
 * @module admin/pages-view
 */
import type { AutomaticValue, SiteAddress } from "../code-pages/contract";

/** The filters above the table, by key, with their labels. */
export const FILTERS = [
  ["all", "All"],
  ["entry", "Entries"],
  ["code", "Built in code"],
  ["not-connected", "Not connected"],
] as const;

export type FilterKey = (typeof FILTERS)[number][0];

/** How many addresses there are of each kind, for the summary row. */
export interface AddressCounts {
  all: number;
  entries: number;
  built: number;
  dynamic: number;
  notConnected: number;
}

/** The counts of `items`, read from the list itself. */
export function countsOf(items: readonly SiteAddress[]): AddressCounts {
  return {
    all: items.length,
    entries: items.filter(item => item.source === "entry").length,
    built: items.filter(item => item.source === "built").length,
    dynamic: items.filter(item => item.source === "dynamic").length,
    notConnected: items.filter(item => item.standing === "not-connected")
      .length,
  };
}

/** Whether `item` is one `filter` keeps. */
function kept(item: SiteAddress, filter: FilterKey): boolean {
  switch (filter) {
    case "all":
      return true;
    case "entry":
      return item.source === "entry";
    case "code":
      return item.source !== "entry";
    case "not-connected":
      return item.standing === "not-connected";
  }
}

/**
 * The addresses `filter` keeps whose address or name holds `query`, case
 * aside, in the order they came.
 */
export function shownAddresses(
  items: readonly SiteAddress[],
  filter: FilterKey,
  query: string
): SiteAddress[] {
  const wanted = query.trim().toLowerCase();
  return items.filter(
    item =>
      kept(item, filter) &&
      (wanted === "" ||
        item.path.toLowerCase().includes(wanted) ||
        item.name.toLowerCase().includes(wanted))
  );
}

/** `text` cut to `length` characters, as Google cuts a long one. */
export function cut(text: string, length: number): string {
  return text.length > length
    ? `${text.slice(0, length - 1).trimEnd()} …`
    : text;
}

/**
 * The address as Google's result writes it under the site's name:
 * `https://example.com › pricing`.
 */
export function resultAddress(canonical: string): string {
  try {
    const url = new URL(canonical);
    const parts = url.pathname.split("/").filter(part => part !== "");
    return [`${url.protocol}//${url.host}`, ...parts].join(" › ");
  } catch {
    return canonical;
  }
}

/** The site's host, from an address on it; nothing where there is none. */
export function hostOf(canonical: string | undefined): string | undefined {
  if (canonical === undefined) return undefined;
  try {
    return new URL(canonical).host;
  } catch {
    return undefined;
  }
}

/** The note a person copies for a developer whose route is not connected. */
export function developerNote(item: SiteAddress): string {
  return `${item.path} (${item.from}) needs the SEO metadata line: export generateMetadata from it with seoMetadata("${item.path}"). See the SEO plugin's docs, Pages built in code.`;
}

/**
 * Where a field's value comes from, as the line under it says: typed for
 * the address; set in the route's code, which wins until the route is
 * connected or until a person types; or automatic, from the site's pattern
 * or its defaults.
 */
export type ValueSource =
  | { kind: "typed" }
  | { kind: "code"; connected: boolean }
  | { kind: "pattern"; pattern: string }
  | { kind: "site"; field: "title" | "description"; found: boolean };

/** Where the value of `field` comes from, as the panel stands. */
export function valueSource(
  item: SiteAddress,
  field: "title" | "description",
  typed: boolean
): ValueSource {
  const automatic: AutomaticValue | undefined = item.seo?.automatic[field];
  if (typed) return { kind: "typed" };
  if (item.standing === "not-connected" || automatic?.from === "code") {
    return { kind: "code", connected: item.standing !== "not-connected" };
  }
  if (automatic?.from === "pattern" && automatic.pattern !== undefined) {
    return { kind: "pattern", pattern: automatic.pattern };
  }
  return { kind: "site", field, found: automatic !== undefined };
}
