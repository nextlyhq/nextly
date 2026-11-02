/**
 * The SEO issues in the collections a reader can see: which issues a document
 * has, and the scan that tallies them for the dashboard card and the Needs
 * attention item.
 *
 * Both read through the services core hands a widget's `load` and an
 * attention item's `count`, which are already bound to the person asking: no
 * read here can name another person or override access, so every number
 * describes what THAT reader may see.
 *
 * ## Why the scan reads rows instead of counting in the database
 *
 * 🔴 It is not a missed optimisation. `plugin-seo` stores its fields in a
 * `group`, and a group compiles to ONE JSON column -- so `seo.metaTitle` is not
 * a column the query compiler can see, and `where: { "seo.metaTitle": ... }`
 * has nothing to compile to. A `count` cannot express this question at all, so
 * the rows are read and inspected here.
 *
 * That makes the work proportional to the corpus, which is why it is bounded.
 * Past {@link ISSUE_SCAN_ROW_BUDGET} the answer says `atLeast` and the card
 * renders `N+`: a reader learns the scale, and nothing claims to be whole that
 * is not.
 *
 * @module widget-source
 */

import type { AttentionItem, FieldConfig } from "@nextlyhq/plugin-sdk";

/**
 * How many published rows one answer may read before it reports a floor.
 *
 * Rows, not documents, and shared across every configured collection: the bound
 * exists to cap the WORK one card or item causes, and work is rows read. A
 * per-collection budget would multiply by however many collections a project
 * configures, which is the opposite of a bound.
 *
 * Two thousand, matching core's own count budget, because the two answer the
 * same kind of question at the same place in a request.
 */
export const ISSUE_SCAN_ROW_BUDGET = 2000;

/**
 * Rows per page while scanning: the most one widget read answers.
 *
 * 🔴 Core clamps every widget read to fifty rows (its `MAX_WIDGET_LIMIT`, which
 * the SDK does not publish), so asking for more is quietly answered with fifty.
 * The scan decides whether rows remain from how many matched against how many
 * it asked for, so a page size above the clamp would read a short page as the
 * last one and stop with most of the collection unread.
 */
export const ISSUE_SCAN_PAGE_SIZE = 50;

/**
 * How many pages one answer may fetch.
 *
 * 🔴 The bound is on PAGES, not on rows returned, and that is the difference
 * between a bound and an intention. The rows a page answers are what survived
 * the collection's `afterRead` hooks and the reader's own rules; how many
 * matched is counted before them. Counting the fetches cannot be fooled that
 * way: whatever comes back, the work this answer causes is bounded by
 * {@link ISSUE_SCAN_ROW_BUDGET} rows' worth of pages.
 */
const PAGE_BUDGET = Math.ceil(ISSUE_SCAN_ROW_BUDGET / ISSUE_SCAN_PAGE_SIZE);

/**
 * Only what the scan reads: the SEO group, and the id the pages are ordered
 * and continued by.
 */
const SCAN_SELECT = ["id", "seo"] as const;

/**
 * The reads a scan makes: the services a widget's `load` and an attention
 * item's `count` are both handed, bound to the person asking. Taken from the
 * item's published type so the two can never be declared apart.
 */
type IssueReads = Parameters<AttentionItem["count"]>[0]["services"];

/**
 * The field whose presence means "kept out of search deliberately", rather than
 * a field somebody failed to fill in.
 */
const NOINDEX_FIELD = "noindex";

/**
 * A field left empty, and what to call that.
 *
 * The reader's words, not the field's: a card that reads "Missing meta title"
 * says what to fix, where "metaTitle: null" says what is stored.
 */
const MISSING_FIELD_ISSUES = [
  { field: "metaTitle", label: "Missing meta title" },
  { field: "canonical", label: "Missing canonical URL" },
  { field: "metaDescription", label: "Missing meta description" },
  { field: "ogImage", label: "Missing social image" },
] as const;

/** What a document being hidden from search is called. */
const NOINDEX_ISSUE = "Hidden from search engines";

/**
 * Which checks apply, given the fields actually installed.
 *
 * 🔴 Derived from the configured set, never from the defaults.
 * `seoPlugin({ fields })` REPLACES the default group, so a project that
 * configures `[focusKeyword]` has no `metaTitle` on any document -- and a check
 * that ran regardless would report every document in the site as missing four
 * things it was never asked to store.
 */
export interface IssueChecks {
  /** Whether the installed set can express "kept out of search". */
  noindex: boolean;
  /** The installed fields whose emptiness is worth reporting. */
  missing: readonly { field: string; label: string }[];
}

/**
 * Whether a field declares its own read rule.
 *
 * 🔴 A field carrying `access.read` may be stripped from the row before this
 * scan ever sees it, and a stripped value is indistinguishable from one nobody
 * filled in. Counting it would report every document the reader CAN see as
 * missing a field that is populated and merely hidden from them -- a number
 * that is wrong in the direction that invents work.
 *
 * So such a field is not checked at all. Reporting nothing about it is the only
 * honest option: the alternative is reading it as somebody else, which would
 * make the card describe rows the reader is not allowed to know about.
 */
function hasOwnReadRule(field: FieldConfig): boolean {
  const access = (field as { access?: unknown }).access;
  return isRecord(access) && access.read !== undefined;
}

/** The checks the installed `seo` fields support. */
export function checksFor(installed: readonly FieldConfig[]): IssueChecks {
  const names = new Set(
    installed
      .filter(field => !hasOwnReadRule(field))
      .map(field => (field as { name?: unknown }).name)
      .filter((name): name is string => typeof name === "string")
  );
  return {
    noindex: names.has(NOINDEX_FIELD),
    missing: MISSING_FIELD_ISSUES.filter(check => names.has(check.field)),
  };
}

/**
 * Every issue the scan can report, listed by priority.
 *
 * Priority, not declaration convenience: a `noindex` that nobody intended and a
 * missing title both remove a page from results, while a missing social image
 * changes how a link previews. The order is the one Screaming Frog, Search
 * Console and Lighthouse agree on. It is the order of what the card's `load`
 * answers; the bars view draws its rows by count, largest first.
 *
 * Derived from the same {@link IssueChecks} the scan counts by, so a card
 * built from this cannot offer a number for a field the project never
 * installed.
 */
export function reportableIssues(
  checks: IssueChecks
): readonly { key: string; label: string }[] {
  return [
    ...(checks.noindex ? [{ key: NOINDEX_FIELD, label: NOINDEX_ISSUE }] : []),
    ...checks.missing.map(check => ({ key: check.field, label: check.label })),
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Absent, or present and empty once trimmed -- both are "not filled in".
 *
 * Read from rows fetched at `depth: 0`, so a link is its stored id: a social
 * image is missing when no id is stored, and an id whose file is gone counts
 * as present, whoever reads.
 */
function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  return typeof value === "string" && value.trim() === "";
}

/**
 * The issues one document has.
 *
 * 🔴 A noindexed document reports exactly ONE issue and none of the others. The
 * remaining checks all ask how a page appears in search results, and this page
 * has been deliberately kept out of them -- so counting a missing title on it
 * describes a problem that cannot happen. Reporting all five would also make one
 * intentionally hidden page weigh five times an ordinary one, which is the
 * fastest way to make a count nobody trusts.
 *
 * `noindex` is still an issue rather than a silent exclusion: an accidental one
 * removes a page from search with nothing on the page to show it, which is why
 * Screaming Frog, Search Console and Lighthouse all surface it.
 */
export function issuesFor(entry: unknown, checks: IssueChecks): string[] {
  const seo = isRecord(entry) && isRecord(entry.seo) ? entry.seo : undefined;
  if (checks.noindex && seo?.[NOINDEX_FIELD] === true) return [NOINDEX_ISSUE];

  return checks.missing
    .filter(check => isBlank(seo?.[check.field]))
    .map(check => check.label);
}

/**
 * Every issue a scan found, by kind, and whether the scan stopped at its bound.
 *
 * Kept by kind rather than as one total, so the card draws each kind and the
 * attention item sums them, from one scan each.
 */
export interface IssueTally {
  byIssue: ReadonlyMap<string, number>;
  /** The rows read stopped at the budget, so every count is a floor. */
  bounded: boolean;
}

/** What one collection's scan contributed. */
interface CollectionTally {
  /** Whether rows were left unread because the budget ran out. */
  bounded: boolean;
}

/**
 * The pages a scan may still fetch, shared by every scan handed the same one:
 * the bound on the work one answer causes, whichever scan spends it.
 */
export interface ScanBudget {
  pagesLeft: number;
}

/** A budget of {@link ISSUE_SCAN_ROW_BUDGET} rows' worth of pages. */
export function scanBudget(): ScanBudget {
  return { pagesLeft: PAGE_BUDGET };
}

/** Adds one to `issue`'s tally in `byIssue`. */
function countOne(byIssue: Map<string, number>, issue: string): void {
  byIssue.set(issue, (byIssue.get(issue) ?? 0) + 1);
}

/** The value a row continues the scan from: its id, as the read answered it. */
function cursorOf(row: unknown): string | number | undefined {
  const id = isRecord(row) ? row.id : undefined;
  return typeof id === "string" || typeof id === "number" ? id : undefined;
}

/**
 * Page through one collection, fetching pages while `budget` has any left.
 *
 * Paged by the id, ascending: each page asks for the rows after the last one
 * the previous page answered. A read takes no offset, and an id is unique and
 * ordered the same way by the sort and by the comparison on every dialect, so
 * consecutive pages neither repeat nor skip a row.
 *
 * 🔴 Whether rows remain is read from how many MATCHED (`total`, counted by the
 * same read) against how many were asked for, never from how many came back.
 * The rows that come back are what survived the reader's rules and the
 * collection's hooks, so a short page is not the last page; reading it as one
 * stopped with the rest unread and no floor said. A page that answered no row
 * at all while more matched leaves nothing to continue from, so the scan stops
 * there and says its counts are floors.
 *
 * 🔴 The cursor is the id a row came back with, after the collection's
 * `afterRead` hooks, and a read takes no offset to page by instead. A hook that
 * rewrites ids makes it a value the stored ids do not order by, so the next
 * page could skip rows or repeat them. Each page is therefore held to what the
 * stored ids say (see `followsOn`) before its rows are counted, and a page that
 * does not follow on stops the scan with its counts said to be floors: an
 * undercount the card shows as "N+", never a wrong whole number.
 *
 * Every row that comes back is counted: its page has already been fetched and
 * its hooks have already run, so reading all of it costs nothing further.
 */
async function scanCollection(
  services: IssueReads,
  slug: string,
  checks: IssueChecks,
  budget: ScanBudget,
  byIssue: Map<string, number>
): Promise<CollectionTally> {
  let cursor: string | number | undefined;
  let previous: ScanPage | undefined;
  const counted = new Set<string | number>();

  while (budget.pagesLeft > 0) {
    // Taken before the read, so scans sharing the budget never fetch more
    // pages between them than it holds, however their reads interleave.
    budget.pagesLeft -= 1;
    const page = await readPage(services, slug, cursor);
    if (previous !== undefined && !followsOn(previous, page, counted)) {
      return { bounded: true };
    }
    tallyRows(page.items, checks, byIssue);
    rememberRows(page.items, counted);

    const step = nextStep(page);
    if (step.done) return { bounded: step.bounded };
    cursor = step.cursor;
    previous = page;
  }
  return { bounded: true };
}

/**
 * Whether `page` continues from `previous` as a page after a stored id does:
 * fewer rows match it, by no more than one page's worth, and none of its rows
 * was already counted.
 *
 * Judged by `total`, which the read counts over the stored ids before any hook
 * runs, and by the rows' own ids, rather than by comparing ids in this process:
 * a hook's id need not order the way the database orders the stored one, and
 * an id compared as text here does not order as a number or a collation does
 * there. Fewer than a page's worth less means the cursor skipped rows; no fewer
 * means it went nowhere or back; a row seen again would be counted twice.
 */
function followsOn(
  previous: ScanPage,
  page: ScanPage,
  counted: ReadonlySet<string | number>
): boolean {
  return advancedOnePage(previous, page) && !repeatsARow(page.items, counted);
}

/**
 * Whether the rows matching `page` are fewer than `previous`'s by one to a
 * page's worth. Not judged where either total is missing or a floor, which
 * says nothing exact about how many rows the cursor passed.
 */
function advancedOnePage(previous: ScanPage, page: ScanPage): boolean {
  const before = previous.total;
  const after = page.total;
  if (before === undefined || after === undefined) return true;
  if (previous.atLeast === true || page.atLeast === true) return true;
  return after < before && after >= before - ISSUE_SCAN_PAGE_SIZE;
}

/** Whether any of `rows` was already counted, by the id it came back with. */
function repeatsARow(
  rows: readonly unknown[],
  counted: ReadonlySet<string | number>
): boolean {
  return rows.some(row => {
    const id = cursorOf(row);
    return id !== undefined && counted.has(id);
  });
}

/** Keeps each counted row's id, so a later page cannot count it again. */
function rememberRows(
  rows: readonly unknown[],
  counted: Set<string | number>
): void {
  for (const row of rows) {
    const id = cursorOf(row);
    if (id !== undefined) counted.add(id);
  }
}

/** One page of a scan, as the read answers it. */
type ScanPage = Awaited<ReturnType<IssueReads["find"]>>;

/** One page of `slug`'s rows: the page after `cursor`, or the first. */
function readPage(
  services: IssueReads,
  slug: string,
  cursor: string | number | undefined
): Promise<ScanPage> {
  return services.find(slug, {
    select: SCAN_SELECT,
    sort: "id",
    limit: ISSUE_SCAN_PAGE_SIZE,
    total: true,
    // 🔴 Each link as the id it stores, never expanded. Expanded, the social
    // image of a reader who may not read media comes back null, a hidden
    // image indistinguishable from a missing one, and every page that has
    // one counted as missing it (see `isBlank`).
    depth: 0,
    ...(cursor === undefined
      ? {}
      : { where: { id: { greater_than: cursor } } }),
  });
}

/** Adds the issues of every row of a page to `byIssue`. */
function tallyRows(
  rows: readonly unknown[],
  checks: IssueChecks,
  byIssue: Map<string, number>
): void {
  for (const row of rows) {
    for (const issue of issuesFor(row, checks)) countOne(byIssue, issue);
  }
}

/** How a scan goes on after a page: done, and whether short of the end, or on from a row. */
type ScanStep =
  | { done: true; bounded: boolean }
  | { done: false; cursor: string | number };

/**
 * What follows `page`: the end, when no more rows matched than it asked for;
 * the row it continues from; or a stop with its counts said to be floors, when
 * more matched and the page answered no row to continue from.
 *
 * 🔴 The end is exact only when the rows the page answered cover every row it
 * matched. Fewer means a hook or the reader's rules left some out, which this
 * cannot tell from rows the reader may not see, so the counts are floors: a
 * hook keeping 30 rows of each answer leaves the last ten of a hundred unread,
 * and the card says "90+" rather than 90.
 */
function nextStep(page: ScanPage): ScanStep {
  const matched = matchedBy(page);
  if (matched <= ISSUE_SCAN_PAGE_SIZE) {
    return { done: true, bounded: page.items.length < matched };
  }
  const next = cursorOf(page.items.at(-1));
  if (next === undefined) return { done: true, bounded: true };
  return { done: false, cursor: next };
}

/**
 * How many rows matched the read a page came from.
 *
 * A read that answered no total is taken as one that may have more, while its
 * page was full: the cautious reading, bounded by the budget.
 */
function matchedBy(page: ScanPage): number {
  if (page.total !== undefined) return page.total;
  return page.items.length >= ISSUE_SCAN_PAGE_SIZE
    ? ISSUE_SCAN_PAGE_SIZE + 1
    : page.items.length;
}

/**
 * Tally the issues across `collections`, by kind, for the person the services
 * are bound to, within `budget`: a budget of its own unless the caller hands
 * one several tallies share, as the Needs attention lines do.
 *
 * 🔴 Nothing here decides access. Each read runs as that person, through
 * core's one access path, so a collection or a row they may not read is not
 * counted, and the answer is never the same for everyone. A failure is not
 * caught: a read that breaks fails the card or the item, rather than becoming
 * a quietly smaller number.
 *
 * The published rows only, because the reads name no status: core then reads
 * the PUBLIC STATES its workflow declares, and a collection with no lifecycle
 * whole. A filter written here could only narrow that wrongly.
 */
export async function tallyIssues(
  services: IssueReads,
  collections: readonly string[],
  checks: IssueChecks,
  budget: ScanBudget = scanBudget()
): Promise<IssueTally> {
  const byIssue = new Map<string, number>();
  let bounded = false;

  for (const slug of collections) {
    if (budget.pagesLeft <= 0) {
      bounded = true;
      break;
    }
    const tally = await scanCollection(services, slug, checks, budget, byIssue);
    if (tally.bounded) bounded = true;
  }

  return { byIssue, bounded };
}
