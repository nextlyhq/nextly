/**
 * The SEO issues in the collections a reader can see, as a dashboard source.
 *
 * A plugin publishes a queryable data source through `contributes.widgetSources`
 * -- the source describes what can be asked, and the resolver answers it. This
 * one is built entirely from `@nextlyhq/plugin-sdk`, using nothing a third party
 * could not import, which is the point of it existing at all.
 *
 * ## Why the resolver scans rows instead of counting in the database
 *
 * 🔴 It is not a missed optimisation. `plugin-seo` stores its fields in a
 * `group`, and a group compiles to ONE JSON column -- so `seo.metaTitle` is not
 * a column the query compiler can see, and `where: { "seo.metaTitle": ... }`
 * has nothing to compile to. A pushdown `count` cannot express this question at
 * all, so the rows are read and inspected here.
 *
 * That makes the work proportional to the corpus, which is why it is bounded.
 * Past {@link ISSUE_SCAN_ROW_BUDGET} the answer says `atLeast` and the card
 * renders `N+`: a reader learns the scale, and nothing claims to be whole that
 * is not. The same choice core's own `versions-widget-source` makes, for the
 * same reason.
 *
 * ## Why `count` and not a chart, yet
 *
 * A grouped answer cannot be reported honestly under a bound. `WidgetResult`'s
 * `groupBy` arm carries `truncated`, which means BUCKETS WERE LEFT OUT -- not
 * "these bucket counts are floors". A bounded scan produces the second, and
 * saying the first would be a different claim. Until the grouped shape can
 * express a bounded grouping, this source supports the op it can answer
 * truthfully -- and `where` on `issue` gives a card the same per-issue number
 * without needing one.
 *
 * @module widget-source
 */

import {
  callerReadOptions,
  NextlyError,
  type FieldConfig,
  type PluginSourceResolver,
  type PluginWidgetSource,
} from "@nextlyhq/plugin-sdk";

import type { CollectionReads } from "./collection-reads";

/** The source id, in the `plugin:` namespace every contributed source must use. */
export const SEO_ISSUES_SOURCE_ID = "plugin:seo/issues";

/** The one field this source publishes, and the only thing a query may name. */
export const ISSUE_FIELD = "issue";

/**
 * How many published rows one answer may read before it reports a floor.
 *
 * Rows, not documents, and shared across every configured collection: the bound
 * exists to cap the WORK one dashboard card causes, and work is rows read. A
 * per-collection budget would multiply by however many collections a project
 * configures, which is the opposite of a bound.
 *
 * Two thousand, matching core's own count budget, because the two answer the
 * same kind of question at the same place in a request.
 */
export const ISSUE_SCAN_ROW_BUDGET = 2000;

/**
 * Rows per page while scanning.
 *
 * 🔴 FIXED for every page of every scan. The managed service derives its offset
 * as `(page - 1) * limit`, so narrowing the limit on a later page moves that
 * page's window BACKWARDS -- page 10 at a limit of 150 starts at row 1350 rather
 * than 1800, re-reading rows already counted and skipping the ones that follow.
 * Keeping it constant is what makes the offsets correct by construction.
 *
 * 🔴 As LARGE as the managed service permits, which is the opposite of the usual
 * reason to page. `listEntries` runs a full filtered `countEntries` alongside
 * EVERY page to build its pagination metadata, and offers no way to decline it
 * -- so each page costs a collection-wide count as well as its rows. Pages are
 * therefore the expensive unit here, and the fewest that cover the budget is the
 * cheapest scan. 500 is the service's own `maxLimit`; asking for more is clamped
 * to it, which would quietly halve the budget.
 */
export const ISSUE_SCAN_PAGE_SIZE = 500;

/**
 * How many pages one answer may fetch.
 *
 * 🔴 The bound is on PAGES, not on rows returned, and that is the difference
 * between a bound and an intention. `data.length` is what survived the
 * collection's `afterRead` hooks; `hasMore` is computed from the database total,
 * before them. A hook that drops rows -- or returns none -- therefore leaves a
 * row counter untouched while paging continues, and the scan walks the entire
 * collection issuing a query and running hooks for every page of it.
 *
 * Counting the fetches cannot be fooled that way: whatever comes back, the work
 * this answer causes is bounded by {@link ISSUE_SCAN_ROW_BUDGET} rows' worth of
 * pages.
 */
const PAGE_BUDGET = Math.ceil(ISSUE_SCAN_ROW_BUDGET / ISSUE_SCAN_PAGE_SIZE);

/** Only what the scan reads: the SEO group, and the id the sort orders by. */
const SCAN_SELECT = { id: true, seo: true } as const;

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
 * source ever sees it, and a stripped value is indistinguishable from one
 * nobody filled in. Counting it would report every document the caller CAN see
 * as missing a field that is populated and merely hidden from them -- a number
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
 * Every issue this source can report, in the order a reader should meet them.
 *
 * Priority, not declaration convenience: a `noindex` that nobody intended and a
 * missing title both remove a page from results, while a missing social image
 * changes how a link previews. The order is the one Screaming Frog, Search
 * Console and Lighthouse agree on.
 *
 * Derived from the same {@link IssueChecks} the resolver counts by, so a card
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

/** Absent, or present and empty once trimmed -- both are "not filled in". */
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

/** Operators that mean something about a value drawn from a closed set. */
const SUPPORTED_OPERATORS = ["equals", "not_equals", "in", "not_in"] as const;

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(entry => String(entry)) : [];
}

/**
 * One operator's test, or a refusal.
 *
 * 🔴 Refusing is the point. The source PUBLISHES `issue`, so validation admits a
 * `where` naming it -- and a resolver that accepted the query and then counted
 * every issue anyway would answer a narrower question with a wider number, which
 * nothing downstream could detect. An operator this source cannot honour is
 * named in the refusal rather than ignored.
 *
 * Ordering and substring operators are absent deliberately: `issue` is a closed
 * set of labels, so "greater than" and "contains" have no meaning over it.
 */
function operatorTest(
  operator: string,
  operand: unknown
): (label: string) => boolean {
  switch (operator) {
    case "equals":
      return label => label === String(operand);
    case "not_equals":
      return label => label !== String(operand);
    case "in":
      return label => asList(operand).includes(label);
    case "not_in":
      return label => !asList(operand).includes(label);
    default:
      throw new NextlyError({
        code: "VALIDATION_ERROR",
        publicMessage: `This widget cannot filter issues with "${operator}"`,
        logMessage:
          `plugin-seo: "${SEO_ISSUES_SOURCE_ID}" supports ` +
          `${SUPPORTED_OPERATORS.join(", ")} on "${ISSUE_FIELD}", not "${operator}"`,
      });
  }
}

/**
 * One field condition's test.
 *
 * A bare scalar is the equality shorthand the query validator accepts -- `where:
 * { issue: "Missing meta title" }` is the same request as the `equals` object,
 * and reading only the object form would have answered it with the unfiltered
 * total. Several operators on one field are ANDed, matching how the collection
 * query compiler reads the same shape.
 */
function conditionTest(condition: unknown): (label: string) => boolean {
  if (!isRecord(condition)) {
    return label => label === String(condition);
  }
  const tests = Object.entries(condition).map(([operator, operand]) =>
    operatorTest(operator, operand)
  );
  return label => tests.every(test => test(label));
}

/**
 * The predicate a query's `where` puts on each issue label.
 *
 * 🔴 Walks the whole accepted grammar, not the shape this plugin's own card
 * happens to generate. `validateReadWidgetQuery` admits a bare scalar and
 * recursively admits `and`/`or`, so a widget somebody else writes against this
 * source can arrive in any of them -- and a resolver that recognised one form
 * and silently returned match-all for the rest would answer a narrowed question
 * with a wider number.
 *
 * Sibling keys are ANDed, which is how the collection query compiler reads the
 * same object.
 */
export function issueFilter(where: unknown): (label: string) => boolean {
  if (!isRecord(where)) return () => true;

  const tests = Object.entries(where).map(([key, value]) => {
    if (key === "and" || key === "or") {
      const parts = (Array.isArray(value) ? value : []).map(issueFilter);
      return key === "and"
        ? (label: string) => parts.every(part => part(label))
        : (label: string) => parts.some(part => part(label));
    }
    if (key !== ISSUE_FIELD) {
      // Unreachable for a validated query -- the source declares one field and
      // validation refuses any other name. Refused rather than ignored, because
      // ignoring it is what turns a narrowed question into a wider answer.
      throw new NextlyError({
        code: "VALIDATION_ERROR",
        publicMessage: "This widget cannot filter on that field",
        logMessage:
          `plugin-seo: "${SEO_ISSUES_SOURCE_ID}" publishes "${ISSUE_FIELD}" ` +
          `alone, and was asked about "${key}"`,
      });
    }
    return conditionTest(value);
  });

  return label => tests.every(test => test(label));
}

/**
 * What this resolver reads, scoped to whoever asked.
 *
 * The same shape the sitemap reads through, under a different identity: see
 * `CollectionReads`.
 */
type SeoIssueServices = CollectionReads<ReturnType<typeof callerReadOptions>>;

/** What one collection's scan contributed. */
interface ScanTally {
  /** Pages FETCHED, which is the work this scan caused. */
  pagesUsed: number;
  issues: number;
  /** Whether pages were left unfetched because the budget ran out. */
  bounded: boolean;
}

/**
 * The filter that leaves only what search engines see.
 *
 * A draft's SEO is not live yet, so a missing title on one is not a problem the
 * site has. A collection without the built-in lifecycle has no `status` column
 * to filter on -- and may define an ordinary field by that name -- so it is
 * scanned whole.
 */
async function publishedOnly(
  services: SeoIssueServices,
  slug: string
): Promise<Record<string, unknown> | undefined> {
  const meta = await services.collections.getCollection(slug, {});
  return isRecord(meta) && meta.status === true
    ? { status: { equals: "published" } }
    : undefined;
}

/** How this scan counts one page's rows, and what it is allowed to read. */
interface ScanRules {
  checks: IssueChecks;
  keep: (label: string) => boolean;
  readOptions: ReturnType<typeof callerReadOptions>;
}

/**
 * Page through one collection, fetching at most `pagesAllowed` pages.
 *
 * Paged by 1-indexed `page`, because that is what the managed service reads --
 * advancing an offset it ignores would re-read the first page forever while
 * `hasMore` stayed true.
 *
 * Every row that comes back is counted. The page has already been fetched and
 * its hooks have already run, so reading all of it costs nothing further and
 * gives a closer answer than discarding a remainder would.
 */
async function scanCollection(
  services: SeoIssueServices,
  slug: string,
  where: Record<string, unknown> | undefined,
  rules: ScanRules,
  pagesAllowed: number,
  abandoned: () => boolean
): Promise<ScanTally> {
  let pagesUsed = 0;
  let issues = 0;

  for (let page = 1; ; page += 1) {
    if (pagesUsed >= pagesAllowed) return { pagesUsed, issues, bounded: true };
    if (abandoned()) return { pagesUsed, issues, bounded: false };

    const result = await services.collections.listEntries(
      slug,
      {
        ...(where === undefined ? {} : { where }),
        depth: 0,
        // Only the SEO group and the id the sort reads. Without it every page
        // carries each document whole -- rich text, blocks, every JSON payload
        // -- so the page cap would bound the QUERIES while the bytes behind
        // them stayed unbounded.
        select: { ...SCAN_SELECT },
        // A stable, unique sort, so consecutive pages neither repeat nor skip
        // rows.
        sort: { field: "id", direction: "asc" as const },
        pagination: { limit: ISSUE_SCAN_PAGE_SIZE, page },
      },
      rules.readOptions
    );
    pagesUsed += 1;

    for (const row of result.data) {
      issues += issuesFor(row, rules.checks).filter(rules.keep).length;
    }

    if (!result.pagination.hasMore)
      return { pagesUsed, issues, bounded: false };
  }
}

/**
 * Whether this failure means "you may not read that", rather than "that broke".
 *
 * 🔴 The distinction decides whether the card shows a number or an error, and
 * only one of them may be swallowed. A denial is an ordinary fact about the
 * reader and the collection contributes zero. A database outage, a failing hook
 * or a malformed query is not: folding those into a successful partial count
 * shows a figure that is quietly too small, with nothing anywhere to say the
 * scan did not finish.
 */
function isDenial(error: unknown): boolean {
  return NextlyError.isCode(error, "FORBIDDEN");
}

/**
 * Count the issues across `collections`, for this caller, within the budget.
 *
 * 🔴 Every read is scoped to the caller through `callerReadOptions`, so the
 * number describes what THEY can see. A count assembled as `system` would be the
 * same figure for everyone and would tell an author how much content exists that
 * they cannot read.
 */
async function countIssues(
  services: SeoIssueServices,
  caller: Parameters<PluginSourceResolver>[1],
  collections: readonly string[],
  rules: Omit<ScanRules, "readOptions">,
  signal: AbortSignal | undefined
): Promise<{ total: number; atLeast: boolean }> {
  const scanRules: ScanRules = {
    ...rules,
    readOptions: callerReadOptions(caller),
  };
  // Read through a call rather than inline: the value changes between awaits,
  // and an inline check narrows it for the rest of the block, so the second
  // look would be compiled away as unreachable.
  const abandoned = (): boolean => signal?.aborted === true;
  let pagesUsed = 0;
  let total = 0;
  let bounded = false;

  for (const slug of collections) {
    if (pagesUsed >= PAGE_BUDGET) {
      bounded = true;
      break;
    }
    // The host aborts this when the dashboard has stopped waiting. Checked
    // between collections and between pages rather than once at the top: a scan
    // that has already started is exactly the work worth abandoning.
    if (abandoned()) break;

    try {
      const tally = await scanCollection(
        services,
        slug,
        await publishedOnly(services, slug),
        scanRules,
        PAGE_BUDGET - pagesUsed,
        abandoned
      );
      pagesUsed += tally.pagesUsed;
      total += tally.issues;
      if (tally.bounded) bounded = true;
    } catch (error) {
      if (!isDenial(error)) throw error;
      // Denied: this collection contributes zero rather than failing the card.
    }
  }

  return { total, atLeast: bounded };
}

/**
 * The source a plugin publishes, and the function that answers it.
 *
 * `installed` is the `seo` field set this project actually configured, because
 * `seoPlugin({ fields })` replaces the defaults -- see {@link checksFor}.
 *
 * `count` alone: see the module docblock for why a grouped answer cannot be
 * reported honestly under a bound. `issue` is published so a card can ask for
 * one kind of issue by name, which is the per-issue number a chart would
 * otherwise be needed for.
 */
export function seoIssuesWidgetSource(
  collections: readonly string[],
  installed: readonly FieldConfig[]
): PluginWidgetSource {
  const source: PluginWidgetSource["source"] = {
    id: SEO_ISSUES_SOURCE_ID,
    label: "SEO issues",
    kind: "plugin",
    supports: ["count"],
    fields: [{ name: ISSUE_FIELD, type: "string" }],
  };

  const checks = checksFor(installed);

  const resolve: PluginSourceResolver = async (query, caller, ctx, opts) => {
    if (query.op !== "count") {
      throw new Error(
        `plugin-seo: "${SEO_ISSUES_SOURCE_ID}" answers "count", not "${query.op}"`
      );
    }

    const { total, atLeast } = await countIssues(
      ctx.services,
      caller,
      collections,
      { checks, keep: issueFilter(query.where) },
      opts?.signal
    );

    return { op: "count", total, ...(atLeast ? { atLeast: true } : {}) };
  };

  return { source, resolve };
}
