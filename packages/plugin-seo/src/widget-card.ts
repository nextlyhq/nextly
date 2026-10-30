/**
 * What this plugin puts on the dashboard: the SEO issues card, and its issue
 * count as a line of the Needs attention card.
 *
 * Both are declarations the host reads through `contributes.dashboard`, built
 * from `@nextlyhq/plugin-sdk` alone. The card is drawn by core's `bars` view,
 * so this plugin ships no admin component: nothing of its code enters the admin
 * bundle, and the card cannot break a dashboard it is placed on.
 *
 * ## Why one bar per issue
 *
 * The breakdown is what a reader acts on: "eleven pages have no title" says
 * what to do, where "twenty-three SEO issues" does not. The Needs attention
 * line is the opposite case: one number saying there is something to look at,
 * beside the other things that need the reader.
 *
 * ## Why the issues are computed
 *
 * From the same {@link IssueChecks} the scan counts by, so a project that
 * replaced the default fields is shown only what it installed. A hand written
 * list would offer a bar for a field nobody stores, and it would sit at zero
 * forever with nothing to say why.
 *
 * @module widget-card
 */

import {
  defineAttentionItem,
  defineWidget,
  type AttentionCount,
  type AttentionItem,
  type FieldConfig,
  type PluginContributions,
} from "@nextlyhq/plugin-sdk";

import {
  checksFor,
  reportableIssues,
  tallyIssues,
  type IssueChecks,
  type IssueTally,
} from "./widget-source";

/** The card's id, in the `namespace/name` shape every widget id takes. */
export const SEO_ISSUES_WIDGET_ID = "seo/issues";

/**
 * The most Needs attention items core takes from one plugin. Core's own bound,
 * restated because the SDK does not publish it; a plugin past it is refused at
 * startup, so no more lines than this are declared.
 */
const MAX_ATTENTION_ITEMS = 10;

/**
 * A widget as `contributes.dashboard.widgets` holds it, named from the SDK's
 * own contribution type because the SDK publishes no name for it.
 */
type DashboardWidget = NonNullable<
  NonNullable<PluginContributions["dashboard"]>["widgets"]
>[number];

/**
 * One bar of the card: an issue, and how many there are. A type rather than an
 * interface, so it has the implicit index signature the check of what JSON
 * carries reads a widget's data through.
 */
type IssueBucket = { value: string; count: number };

/**
 * The card's data from a tally: each kind found, in the order `issues` lists
 * them, and whether the counts are floors. The bars view draws its rows by
 * count, largest first, so that order is the answer's and not the drawn one.
 *
 * A kind counted at zero is left out, so a site with nothing to fix answers no
 * bars and the frame draws the card's empty state, rather than a chart of
 * zeros.
 */
function issueBuckets(
  tally: IssueTally,
  issues: readonly { label: string }[]
): { buckets: IssueBucket[]; atLeast?: true } {
  const buckets = issues
    .map(({ label }) => ({
      value: label,
      count: tally.byIssue.get(label) ?? 0,
    }))
    .filter(bucket => bucket.count > 0);
  return tally.bounded ? { buckets, atLeast: true } : { buckets };
}

/**
 * A tally for the preview page to draw: each issue the configured fields can
 * report, with a sample count, fewer for each issue further down the list.
 *
 * Built from the same `issues` the card's `load` draws, and drawn through the
 * same `issueBuckets`, so the preview offers a bar only for a check the project
 * installed.
 */
function sampleTally(issues: readonly { label: string }[]): IssueTally {
  return {
    byIssue: new Map(
      issues.map(({ label }, index) => [label, (issues.length - index) * 3])
    ),
    bounded: false,
  };
}

/** Every issue in a tally, as one count, said as a floor when the scan was. */
function issueCount(tally: IssueTally): AttentionCount {
  let count = 0;
  for (const found of tally.byIssue.values()) count += found;
  return tally.bounded ? { count, atLeast: true } : count;
}

/**
 * The card, or nothing when it would have nothing to say.
 *
 * Withheld when no installed field can be checked, and when no collection
 * carries the fields: a plugin registered with no collections extends nothing,
 * so every bar would answer zero and the card would report a clean site for a
 * plugin that is doing nothing at all.
 *
 * 🔴 `access` names the collections it reads, so only a person who may read
 * every one of them is offered the card; anyone else is told it is not
 * available, never shown a number about content they cannot see. Its `load`
 * reads through the services it is handed, bound to that person, so the
 * number is theirs.
 */
export function seoIssuesWidget(
  collections: readonly string[],
  installed: readonly FieldConfig[]
): DashboardWidget | undefined {
  const checks = checksFor(installed);
  const issues = reportableIssues(checks);
  if (issues.length === 0 || collections.length === 0) return undefined;

  return defineWidget({
    id: SEO_ISSUES_WIDGET_ID,
    title: "SEO issues",
    description: "Published pages missing search and social metadata",
    icon: "search",
    category: "SEO",
    // A third of the row by default and three rows tall, room for a bar per
    // issue; from a quarter, where the five still read, to half the row.
    size: {
      default: { w: 4, h: 3 },
      min: { w: 3, h: 3 },
      max: { w: 6, h: 4 },
    },
    access: { collections: [...collections] },
    load: async ({ services }) =>
      issueBuckets(await tallyIssues(services, collections, checks), issues),
    view: "bars",
    skeleton: "bars",
    empty: { message: "No SEO issues in published pages." },
    preview: [
      {
        name: "Some pages need work",
        data: issueBuckets(sampleTally(issues), issues),
      },
    ],
  });
}

/**
 * The card's issue count, as lines of the Needs attention card: one per
 * configured collection, each naming that collection alone, linking to its
 * list and counting its issues; none when the card would have nothing to say
 * (see {@link seoIssuesWidget}).
 *
 * 🔴 One per collection, because an item's link is one path for every reader
 * it shows to. Core shows an item naming one collection only to a reader of
 * it, and reads its count as that reader, so every line a reader is shown
 * links to a list they can open and counts what they may read there.
 *
 * Needs attention lists up to ten SEO collections, the most items core takes
 * from one plugin: the first ten configured get a line each, and a collection
 * past them gets none. The card covers all of them, so no issue goes uncounted
 * where a reader may see it.
 */
export function seoIssuesAttentionItems(
  collections: readonly string[],
  installed: readonly FieldConfig[]
): AttentionItem[] {
  const checks = checksFor(installed);
  if (reportableIssues(checks).length === 0) return [];

  const listed = collections.slice(0, MAX_ATTENTION_ITEMS);
  const ids = attentionIds(listed);
  return listed.map((slug, index) =>
    issuesItem(ids[index], `SEO issues in ${slug}`, [slug], checks)
  );
}

/** One line counting the issues in `collections`, linked to the first's list. */
function issuesItem(
  id: string,
  label: string,
  collections: readonly [string, ...string[]],
  checks: IssueChecks
): AttentionItem {
  return defineAttentionItem({
    id,
    label,
    collections,
    count: async ({ services }) =>
      issueCount(await tallyIssues(services, collections, checks)),
    link: `collections/${collections[0]}`,
  });
}

/**
 * An item id for each name, `seo/issues-<name>`: lowercase letters, digits and
 * dashes, which is all an item id may hold, and each one distinct, so two
 * slugs that read alike (`blog_posts`, `blog-posts`) cannot become one id,
 * which core would refuse at startup.
 *
 * 🔴 A repeat takes the first `-2`, `-3`, ... that no id holds yet, checked
 * against every id already taken. A suffix chosen without that check can be
 * an id another slug already has (`blog-posts-3` beside `blog-posts`).
 */
function attentionIds(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map(name => {
    const base = `seo/issues-${name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
    let id = base;
    for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`;
    taken.add(id);
    return id;
  });
}
