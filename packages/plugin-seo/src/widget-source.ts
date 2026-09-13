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
 * truthfully.
 *
 * @module widget-source
 */

import {
  callerReadOptions,
  type PluginSourceResolver,
  type PluginWidgetSource,
} from "@nextlyhq/plugin-sdk";

/** The source id, in the `plugin:` namespace every contributed source must use. */
export const SEO_ISSUES_SOURCE_ID = "plugin:seo/issues";

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

/** Rows per page while scanning. Trades round trips against peak memory. */
const PAGE_SIZE = 200;

/**
 * What each issue is called.
 *
 * The reader's words, not the field's: a card that reads "Missing meta title"
 * says what to fix, where "metaTitle: null" says what is stored.
 */
const ISSUE = {
  noindex: "Hidden from search engines",
  title: "Missing meta title",
  canonical: "Missing canonical URL",
  description: "Missing meta description",
  image: "Missing social image",
} as const;

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
export function issuesFor(entry: unknown): string[] {
  const seo = isRecord(entry) && isRecord(entry.seo) ? entry.seo : undefined;
  if (seo?.noindex === true) return [ISSUE.noindex];

  const found: string[] = [];
  if (isBlank(seo?.metaTitle)) found.push(ISSUE.title);
  if (isBlank(seo?.canonical)) found.push(ISSUE.canonical);
  if (isBlank(seo?.metaDescription)) found.push(ISSUE.description);
  if (isBlank(seo?.ogImage)) found.push(ISSUE.image);
  return found;
}

/**
 * The services this resolver calls, as a structural slice.
 *
 * Declared rather than `Pick<PluginCollectionService, ...>` for the reason
 * `sitemap.ts` declares its own: a test satisfies this with a plain object,
 * while the real, richer service stays assignable to it.
 */
interface SeoIssueServices {
  collections: {
    getCollection(
      slug: string,
      context: Record<string, never>
    ): Promise<unknown>;
    listEntries(
      slug: string,
      query: {
        where?: Record<string, unknown>;
        depth?: number;
        sort?: { field: string; direction: "asc" | "desc" };
        pagination?: { limit?: number; page?: number };
      },
      opts: ReturnType<typeof callerReadOptions>
    ): Promise<{ data: unknown[]; pagination: { hasMore: boolean } }>;
  };
}

/** What one collection's scan contributed. */
interface ScanTally {
  rowsRead: number;
  issues: number;
  /** Whether rows were left unread because the budget ran out. */
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

/**
 * Page through one collection, reading at most `budget` rows.
 *
 * Paged by 1-indexed `page`, because that is what the managed service reads --
 * advancing an offset it ignores would re-read the first page forever while
 * `hasMore` stayed true. The sort is unique and stable so consecutive pages
 * neither repeat nor skip rows.
 */
async function scanCollection(
  services: SeoIssueServices,
  slug: string,
  where: Record<string, unknown> | undefined,
  readOptions: ReturnType<typeof callerReadOptions>,
  budget: number,
  abandoned: () => boolean
): Promise<ScanTally> {
  let rowsRead = 0;
  let issues = 0;

  for (let page = 1; ; page += 1) {
    const remaining = budget - rowsRead;
    if (remaining <= 0) return { rowsRead, issues, bounded: true };
    if (abandoned()) return { rowsRead, issues, bounded: false };

    const result = await services.collections.listEntries(
      slug,
      {
        ...(where === undefined ? {} : { where }),
        depth: 0,
        sort: { field: "id", direction: "asc" as const },
        pagination: { limit: Math.min(PAGE_SIZE, remaining), page },
      },
      readOptions
    );

    for (const row of result.data) {
      rowsRead += 1;
      issues += issuesFor(row).length;
    }

    if (!result.pagination.hasMore) return { rowsRead, issues, bounded: false };
  }
}

/**
 * Count the issues across `collections`, for this caller, within the budget.
 *
 * 🔴 Every read is scoped to the caller through `callerReadOptions`, so the
 * number describes what THEY can see. A count assembled as `system` would be the
 * same figure for everyone and would tell an author how much content exists that
 * they cannot read.
 *
 * A collection the caller may not read contributes zero rather than failing the
 * card: the managed service THROWS on a full denial rather than returning an
 * empty page, so a caught refusal here is the difference between a dashboard
 * that degrades and one that goes blank. Core's own recent-activity source
 * handles denial the same way.
 */
async function countIssues(
  services: SeoIssueServices,
  caller: Parameters<PluginSourceResolver>[1],
  collections: readonly string[],
  signal: AbortSignal | undefined
): Promise<{ total: number; atLeast: boolean }> {
  const readOptions = callerReadOptions(caller);
  // Read through a call rather than inline: the value changes between awaits,
  // and an inline check narrows it for the rest of the block, so the second
  // look would be compiled away as unreachable.
  const abandoned = (): boolean => signal?.aborted === true;
  let rowsRead = 0;
  let total = 0;
  let bounded = false;

  for (const slug of collections) {
    if (rowsRead >= ISSUE_SCAN_ROW_BUDGET) {
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
        readOptions,
        ISSUE_SCAN_ROW_BUDGET - rowsRead,
        abandoned
      );
      rowsRead += tally.rowsRead;
      total += tally.issues;
      if (tally.bounded) bounded = true;
    } catch {
      // Denied, or unreadable for any other reason: contributes zero.
      continue;
    }
  }

  return { total, atLeast: bounded };
}

/**
 * The source a plugin publishes, and the function that answers it.
 *
 * `count` alone: see the module docblock for why a grouped answer cannot be
 * reported honestly under a bound. `fields` names the one dimension a future
 * grouped query would use, so the declared shape does not have to change when it
 * can be answered.
 */
export function seoIssuesWidgetSource(
  collections: readonly string[]
): PluginWidgetSource {
  const source: PluginWidgetSource["source"] = {
    id: SEO_ISSUES_SOURCE_ID,
    label: "SEO issues",
    kind: "plugin",
    supports: ["count"],
    fields: [{ name: "issue", type: "string" }],
  };

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
      opts?.signal
    );

    return { op: "count", total, ...(atLeast ? { atLeast: true } : {}) };
  };

  return { source, resolve };
}
