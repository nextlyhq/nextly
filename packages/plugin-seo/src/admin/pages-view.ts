/**
 * What the Pages screen shows, worked out from the list the server answers
 * and the shared problem list: each page's status, its type for the Type
 * filter, which pages a search and the filters keep, and what the line under
 * a title says about where it comes from. Pure, so each is tested without
 * the screen.
 *
 * @module admin/pages-view
 */
import type {
  AutomaticValue,
  SiteAddress,
  ValueSource as SourceLevel,
} from "../code-pages/contract";
import {
  KIND_SEVERITY,
  seoTabIdOf,
  SEVERITY_ORDER,
  type CheckedPage,
  type Problem,
  type ProblemSeverity,
} from "../problems/contract";

/**
 * How a page stands, as its Status says: the most serious problem the
 * problem list holds for it; else, for a page built in code whose route
 * doesn't call the plugin, not connected; else hidden from search, or good.
 */
export type PageStatus =
  | ProblemSeverity
  | "not-connected"
  | "hidden"
  | "good"
  | "unknown";

/** Each status's word, as the Status column and its filter say it. */
export const STATUS_TEXT: Readonly<Record<PageStatus, string>> = {
  error: "Error",
  warning: "Warning",
  notice: "Notice",
  "not-connected": "Not connected",
  hidden: "Hidden",
  good: "Good",
  unknown: "Not checked",
};

/** The statuses in the order the Status filter offers them. */
export const STATUS_ORDER: readonly PageStatus[] = [
  "good",
  ...SEVERITY_ORDER,
  "not-connected",
  "hidden",
];

/** The key the problem list names a page by: its type, id and language. */
function pageKey(type: string, id: string, locale: string | undefined): string {
  return [type, id, locale ?? ""].join("\u0000");
}

/**
 * The content type an entry's problems name it by: a collection's slug, or
 * `single:<slug>` for a Single.
 */
export function entryTypeKey(entry: NonNullable<SiteAddress["entry"]>): string {
  return entry.kind === "single" ? `single:${entry.slug}` : entry.slug;
}

/**
 * The problem list as Pages reads it: its problems about each page, by the
 * page's key, and the pages it checked for the reader, where it says.
 */
export interface ProblemsByPage {
  pages: ReadonlyMap<string, readonly Problem[]>;
  /** The keys of the pages the list checked for this reader. */
  checked?: ReadonlySet<string>;
}

/**
 * The problem list's problems grouped by the page each is about, and the
 * pages it checked for the reader: read once for the whole list. A problem
 * about the whole site names no page.
 */
export function problemsByPage(
  problems: readonly Problem[],
  checked?: readonly CheckedPage[]
): ProblemsByPage {
  const pages = new Map<string, Problem[]>();
  for (const problem of problems) {
    const { type, id, locale } = problem.subject;
    if (type === undefined || id === undefined) continue;
    const key = pageKey(type, id, locale);
    pages.set(key, [...(pages.get(key) ?? []), problem]);
  }
  return checked === undefined
    ? { pages }
    : {
        pages,
        checked: new Set(
          checked.map(page => pageKey(page.type, page.id, page.locale))
        ),
      };
}

/** The key the problem list names an entry's page by. */
function entryKey(entry: NonNullable<SiteAddress["entry"]>): string {
  return pageKey(entryTypeKey(entry), entry.id, entry.locale);
}

/** The problems the list holds about `item`; none for a page built in code. */
export function problemsOf(
  item: SiteAddress,
  byPage: ProblemsByPage
): readonly Problem[] {
  const { entry } = item;
  if (entry === undefined) return [];
  return byPage.pages.get(entryKey(entry)) ?? [];
}

/**
 * How `item` stands, from the problem list grouped by `problemsByPage`:
 * unknown while there is no list to read it from, since a page the list
 * was never read for is not one with no problems.
 */
export function statusOf(
  item: SiteAddress,
  byPage: ProblemsByPage | undefined
): PageStatus {
  if (byPage === undefined) return "unknown";
  // A page the list didn't check for this reader, such as one their read
  // rule leaves out or one published since, has no problem listed and no
  // evidence of none.
  const { entry } = item;
  if (
    entry !== undefined &&
    byPage.checked !== undefined &&
    !byPage.checked.has(entryKey(entry))
  ) {
    return "unknown";
  }
  const severities = new Set(
    problemsOf(item, byPage).map(problem => KIND_SEVERITY[problem.kind])
  );
  const worst = SEVERITY_ORDER.find(severity => severities.has(severity));
  if (worst !== undefined) return worst;
  if (item.standing === "not-connected") return "not-connected";
  if (item.standing === "hidden" || item.standing === "type-hidden") {
    return "hidden";
  }
  return "good";
}

/** The Type filter's choice for pages built in code. */
const CODE_TYPE = "code";

/** The Type filter's choice for every Single. */
const SINGLES_TYPE = "singles";

/**
 * The Type filter's choice `item` falls under: its collection, every Single
 * together, or every page built in code together.
 */
function typeOf(item: SiteAddress): string {
  if (item.entry === undefined) return CODE_TYPE;
  return item.entry.kind === "single"
    ? SINGLES_TYPE
    : `collection:${item.entry.slug}`;
}

/** One choice of the Type filter. */
export interface TypeChoice {
  value: string;
  label: string;
}

/**
 * The Type filter's choices for `items`: each collection by its name, in the
 * order first listed, then the Singles, then the pages built in code, each
 * only where the list has one.
 */
export function typeChoices(items: readonly SiteAddress[]): TypeChoice[] {
  const collections = new Map<string, string>();
  let singles = false;
  let code = false;
  for (const item of items) {
    const type = typeOf(item);
    if (type === CODE_TYPE) code = true;
    else if (type === SINGLES_TYPE) singles = true;
    else if (!collections.has(type)) collections.set(type, item.from);
  }
  return [
    ...[...collections].map(([value, label]) => ({ value, label })),
    ...(singles ? [{ value: SINGLES_TYPE, label: "Singles" }] : []),
    ...(code ? [{ value: CODE_TYPE, label: "Built in code" }] : []),
  ];
}

/** What the list is narrowed to: a search, a type and a status. */
export interface PagesFilter {
  query: string;
  /** A `typeOf` value, or `all`. */
  type: string;
  status: PageStatus | "all";
}

/**
 * The pages `filter` keeps, in the order they came: of its type and status,
 * with the search in their address or their name, case aside.
 */
export function shownPages(
  items: readonly SiteAddress[],
  filter: PagesFilter,
  statusFor: (item: SiteAddress) => PageStatus
): SiteAddress[] {
  const wanted = filter.query.trim().toLowerCase();
  return items.filter(
    item =>
      (filter.type === "all" || typeOf(item) === filter.type) &&
      (filter.status === "all" || statusFor(item) === filter.status) &&
      (wanted === "" ||
        item.path.toLowerCase().includes(wanted) ||
        item.name.toLowerCase().includes(wanted))
  );
}

/**
 * Where a value comes from, as the line under it says: `level` is the level
 * of the order that gave it, and `pattern` the pattern a title was made from.
 */
export function sourceText(
  level: SourceLevel | undefined,
  pattern?: string
): string {
  switch (level) {
    case "page":
      return "Own value";
    case "code":
      return "From the page\u2019s code";
    case "template":
      return "From its design";
    case "pattern":
      return pattern === undefined ? "From the pattern" : `Pattern: ${pattern}`;
    case "content":
      return "From its content";
    case "site":
      return "Site default";
    case undefined:
      return "None";
  }
}

/** What the line under a page's title says of where that title comes from. */
export function titleSourceText(
  item: Pick<SiteAddress, "sources" | "titlePattern">
): string {
  return sourceText(item.sources.title, item.titlePattern);
}

/**
 * Where an entry is edited in the admin, in its own language: on its SEO tab
 * where `tab` says so.
 */
export function entryHref(
  entry: NonNullable<SiteAddress["entry"]>,
  tab?: "seo"
): string {
  const page =
    entry.kind === "single"
      ? `/admin/singles/${encodeURIComponent(entry.slug)}`
      : `/admin/collections/${encodeURIComponent(entry.slug)}/${encodeURIComponent(entry.id)}`;
  const query = new URLSearchParams();
  if (tab === "seo") query.set("tab", seoTabIdOf(entry.kind));
  if (entry.locale !== undefined) query.set("locale", entry.locale);
  const search = query.toString();
  return search === "" ? page : `${page}?${search}`;
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
  // Only a value the route's code supplied is said to be set in code; the
  // panel's note says separately whether the route is connected.
  if (automatic?.from === "code") {
    return { kind: "code", connected: item.standing !== "not-connected" };
  }
  if (automatic?.from === "pattern" && automatic.pattern !== undefined) {
    return { kind: "pattern", pattern: automatic.pattern };
  }
  return { kind: "site", field, found: automatic !== undefined };
}
