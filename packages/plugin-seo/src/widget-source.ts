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
 * ## A count, or the issues grouped by kind, from one scan
 *
 * A bounded scan's grouping is honest because `WidgetResult`'s `groupBy` arm
 * says `atLeast`: every bucket found is real and every count may be short. It
 * does not say `truncated`, which would claim buckets were left out of what was
 * read. `where` on `issue` gives a card a per-kind count.
 *
 * Every question asked of this source in a batch is answered from ONE scan: the
 * scan tallies issues by kind, and each count or grouping is read from the
 * tally. `resolveMany` answers a batch's queries in one call, and a query
 * answered on its own shares the scan through the batch's scope.
 *
 * @module widget-source
 */

import {
  callerReadOptions,
  NextlyError,
  type FieldConfig,
  type PluginManySourceResolver,
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

/** The scope key this source's scan is kept under; scopes are per source, so it need only be unique here. */
const ISSUE_SCAN_KEY = "issue-scan";

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

/**
 * A membership operand as a list.
 *
 * A bare scalar is one member, which is what the collection query compiler does
 * with the same shape (`query-operators.ts` wraps a non-array before building
 * the clause). Reading it as an empty list instead made `in` match nothing and
 * `not_in` match everything -- the two worst answers available, and both look
 * like ordinary numbers.
 */
function asList(value: unknown): string[] {
  const members = Array.isArray(value) ? value : [value];
  return members.map(entry => String(entry));
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
  /** Whether pages were left unfetched because the budget ran out. */
  bounded: boolean;
  /**
   * This collection's issues alone, by kind. Kept apart from the shared tally
   * until the scan has finished, so a collection refused partway through
   * contributes nothing rather than the pages read before the refusal.
   */
  byIssue: Map<string, number>;
}

/**
 * Every issue the scan found, by kind, and whether the scan stopped at its bound.
 *
 * Kept by kind rather than as one total, so ONE scan answers every question this
 * source takes: a count of all issues, a count of some kinds, and the grouping by
 * kind -- each read from the same tally rather than from a scan of its own.
 */
interface IssueTally {
  byIssue: ReadonlyMap<string, number>;
  /** The rows read stopped at the budget, so every count is a floor. */
  bounded: boolean;
}

/**
 * Which documents a scan sees, and why this source writes no filter for it.
 *
 * 🔴 Core already decides this, correctly, and a filter written here could only
 * narrow it wrongly. `callerReadOptions` reads as the caller rather than
 * overriding access, and on that path `resolveStatusFilter` restricts the read
 * to the PUBLIC STATES DERIVED FROM THE COLLECTION'S WORKFLOW -- every state the
 * workflow declares public, not the single literal `published`. A collection
 * whose workflow adds `featured` keeps it; a collection with no lifecycle at all
 * is scanned whole, because that function returns no filter when there is no
 * status column to filter on.
 *
 * Writing `status = "published"` here was both redundant and narrower than what
 * core does: it dropped live content on any workflow that names its public state
 * anything else, and the card undercounted without appearing to.
 *
 * `status: "all"` is refused rather than answered -- see
 * {@link assertStatusIsAnswerable}.
 */

/**
 * Refuse a status selector this source cannot deliver.
 *
 * 🔴 `assertValidStatus` admits `all` for a source that declares no lifecycle,
 * so it arrives here -- but the managed `listEntries` forwards no lifecycle
 * status from its options, and the read is not an overriding one, so the rows
 * that come back are the public ones whatever the query asked for. Answering
 * that as if it were "all" reports a published-only number under a name that
 * promises every document, which nothing downstream could detect.
 *
 * So it refuses, and says which selector it cannot honour. Silently narrowing a
 * caller's question is the one outcome worse than refusing it.
 */
function assertStatusIsAnswerable(status: string | undefined): void {
  if (status === undefined) return;
  throw new NextlyError({
    code: "VALIDATION_ERROR",
    publicMessage: "This widget reports on published content only",
    logMessage:
      `plugin-seo: "${SEO_ISSUES_SOURCE_ID}" cannot answer status ` +
      `"${status}"; the managed read forwards no lifecycle selector`,
  });
}

/** What this scan looks for, and what it may read. */
interface ScanRules {
  checks: IssueChecks;
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
  rules: ScanRules,
  pagesAllowed: number,
  abandoned: () => boolean
): Promise<ScanTally> {
  let pagesUsed = 0;
  const byIssue = new Map<string, number>();

  for (let page = 1; ; page += 1) {
    if (pagesUsed >= pagesAllowed) return { pagesUsed, bounded: true, byIssue };
    if (abandoned()) throwAbandoned();

    const result = await services.collections.listEntries(
      slug,
      {
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
      for (const issue of issuesFor(row, rules.checks))
        addTo(byIssue, issue, 1);
    }

    if (!result.pagination.hasMore)
      return { pagesUsed, bounded: false, byIssue };
  }
}

/** Adds `count` to `issue`'s tally in `byIssue`. */
function addTo(
  byIssue: Map<string, number>,
  issue: string,
  count: number
): void {
  byIssue.set(issue, (byIssue.get(issue) ?? 0) + count);
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
 * A scan the host stopped waiting for, ended rather than reported.
 *
 * 🔴 Thrown, not returned as a short tally. A scan is shared by every question
 * asked of this source in a batch, so a partial tally returned here would reach
 * a card whose own wait had not ended, as a number that looks whole.
 */
function throwAbandoned(): never {
  throw new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: "This widget took too long to answer",
    logMessage: `plugin-seo: "${SEO_ISSUES_SOURCE_ID}" scan abandoned`,
  });
}

/**
 * Tally the issues across `collections`, by kind, for this caller, within the
 * budget.
 *
 * 🔴 Every read is scoped to the caller through `callerReadOptions`, so the
 * numbers describe what THEY can see. A tally assembled as `system` would be the
 * same for everyone and would tell an author how much content exists that they
 * cannot read.
 */
async function tallyIssues(
  services: SeoIssueServices,
  caller: Parameters<PluginSourceResolver>[1],
  collections: readonly string[],
  checks: IssueChecks,
  signal: AbortSignal | undefined
): Promise<IssueTally> {
  const byIssue = new Map<string, number>();
  const scanRules: ScanRules = {
    checks,
    readOptions: callerReadOptions(caller),
  };
  // Read through a call rather than inline: the value changes between awaits,
  // and an inline check narrows it for the rest of the block, so the second
  // look would be compiled away as unreachable.
  const abandoned = (): boolean => signal?.aborted === true;
  let pagesUsed = 0;
  let bounded = false;

  for (const slug of collections) {
    if (pagesUsed >= PAGE_BUDGET) {
      bounded = true;
      break;
    }
    // The host aborts this when the dashboard has stopped waiting. Checked
    // between collections and between pages rather than once at the top: a scan
    // that has already started is exactly the work worth abandoning.
    if (abandoned()) throwAbandoned();

    try {
      const tally = await scanCollection(
        services,
        slug,
        scanRules,
        PAGE_BUDGET - pagesUsed,
        abandoned
      );
      pagesUsed += tally.pagesUsed;
      if (tally.bounded) bounded = true;
      // Merged only now that the collection's scan has finished.
      for (const [issue, count] of tally.byIssue) addTo(byIssue, issue, count);
    } catch (error) {
      if (!isDenial(error)) throw error;
      // Denied: this collection contributes nothing rather than failing the card.
    }
  }

  return { byIssue, bounded };
}

/**
 * One query's answer, read from a tally: the count of the kinds it keeps, or
 * those kinds as groups. A floor is said as `atLeast` on either.
 */
function answerFrom(
  query: Parameters<PluginSourceResolver>[0],
  tally: IssueTally
): ReturnType<typeof countAnswer> | ReturnType<typeof groupAnswer> {
  return query.op === "groupBy"
    ? groupAnswer(query, tally)
    : countAnswer(query, tally);
}

function countAnswer(
  query: Parameters<PluginSourceResolver>[0],
  tally: IssueTally
) {
  const keep = issueFilter(query.where);
  let total = 0;
  for (const [issue, count] of tally.byIssue) if (keep(issue)) total += count;
  return {
    op: "count" as const,
    total,
    ...(tally.bounded ? { atLeast: true } : {}),
  };
}

/**
 * `buckets` as a grouped answer holds them: largest first, then by value, as
 * core's grouped read orders them, and at most `limit` of them, with
 * `truncated` saying when some were left out.
 */
function rankedBuckets(
  buckets: { value: string; count: number }[],
  limit: number | undefined
): { buckets: { value: string; count: number }[]; truncated: boolean } {
  const ranked = [...buckets].sort(
    (a, b) =>
      b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0)
  );
  const cap = limit ?? ranked.length;
  return { buckets: ranked.slice(0, cap), truncated: ranked.length > cap };
}

function groupAnswer(
  query: Parameters<PluginSourceResolver>[0],
  tally: IssueTally
) {
  const keep = issueFilter(query.where);
  const found = [...tally.byIssue]
    .filter(([issue]) => keep(issue))
    .map(([value, count]) => ({ value, count }));
  const { buckets, truncated } = rankedBuckets(found, query.limit);
  // Two different claims, and an answer can make both. Under the scan's bound
  // every bucket found is real and every count may be short: `atLeast`. Past
  // the query's limit some buckets found are left out: `truncated`.
  return {
    op: "groupBy" as const,
    buckets,
    ...(truncated ? { truncated: true } : {}),
    ...(tally.bounded ? { atLeast: true } : {}),
  };
}

/**
 * One query's answer from a tally the batch shares, or the error it was
 * refused with. Some refusals come only as the answer is read -- a filter
 * operator this source does not take passes the host's checks -- and one of
 * them must fail its own card, never every card the scan was shared with.
 */
function answerOrError(
  query: Parameters<PluginSourceResolver>[0],
  tally: IssueTally
): ReturnType<typeof answerFrom> | Error {
  try {
    return answerFrom(query, tally);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/** Refuse what this source cannot answer, before any row is read. */
function assertAnswerable(query: Parameters<PluginSourceResolver>[0]): void {
  assertStatusIsAnswerable(query.status);
  if (query.op !== "count" && query.op !== "groupBy") {
    throw new Error(
      `plugin-seo: "${SEO_ISSUES_SOURCE_ID}" answers "count" and "groupBy", not "${query.op}"`
    );
  }
  if (query.op === "groupBy" && query.groupBy !== ISSUE_FIELD) {
    throw new Error(
      `plugin-seo: "${SEO_ISSUES_SOURCE_ID}" groups by "${ISSUE_FIELD}" only`
    );
  }
}

/**
 * The source a plugin publishes, and the function that answers it.
 *
 * `installed` is the `seo` field set this project actually configured, because
 * `seoPlugin({ fields })` replaces the defaults -- see {@link checksFor}.
 *
 * `count`, and `groupBy` on `issue`, both read from one scan; see the module
 * docblock. `issue` is published so a card can ask for one kind of issue by name
 * or chart them all.
 */
export function seoIssuesWidgetSource(
  collections: readonly string[],
  installed: readonly FieldConfig[]
): PluginWidgetSource {
  const source: PluginWidgetSource["source"] = {
    id: SEO_ISSUES_SOURCE_ID,
    label: "SEO issues",
    kind: "plugin",
    supports: ["count", "groupBy"],
    fields: [{ name: ISSUE_FIELD, type: "string" }],
  };

  const checks = checksFor(installed);

  // ONE scan per batch for this caller, however many of this source's cards it
  // holds: through the batch's scope when the host hands one, so a card answered
  // on its own still shares the scan with its neighbours.
  const tallyFor = (
    caller: Parameters<PluginSourceResolver>[1],
    ctx: Parameters<PluginSourceResolver>[2],
    opts: Parameters<PluginSourceResolver>[3]
  ): Promise<IssueTally> => {
    const scan = () =>
      tallyIssues(ctx.services, caller, collections, checks, opts?.signal);
    return opts?.scope ? opts.scope.getOrCompute(ISSUE_SCAN_KEY, scan) : scan();
  };

  const resolve: PluginSourceResolver = async (query, caller, ctx, opts) => {
    assertAnswerable(query);
    return answerFrom(query, await tallyFor(caller, ctx, opts));
  };

  // Several of this source's cards in one call: each query is checked on its
  // own, so one it cannot answer fails alone, and the rest share one scan.
  const resolveMany: PluginManySourceResolver = async (
    queries,
    caller,
    ctx,
    opts
  ) => {
    const refusals = queries.map(query => {
      try {
        assertAnswerable(query);
        return undefined;
      } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
      }
    });
    if (refusals.every(refusal => refusal !== undefined)) {
      return refusals.map(refusal => refusal ?? new Error("unanswerable"));
    }
    const tally = await tallyFor(caller, ctx, opts);
    return queries.map(
      (query, index) => refusals[index] ?? answerOrError(query, tally)
    );
  };

  return { source, resolve, resolveMany };
}
