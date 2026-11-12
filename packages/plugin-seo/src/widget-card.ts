/**
 * What this plugin puts on the dashboard: the SEO issues card, and its count
 * as a line of the Needs attention card.
 *
 * Both are declarations the host reads through `contributes.dashboard`, built
 * from `@nextlyhq/plugin-sdk` alone. The card is drawn by core's `bars` view,
 * so this plugin ships no admin component: nothing of its code enters the admin
 * bundle, and the card cannot break a dashboard it is placed on.
 *
 * ## What they count
 *
 * The problem list's findings, as the person asking may read the list
 * (`problems/card-source`): the same kept rows, read by the same reader, so a
 * number on the dashboard is the number of problems the list shows them. One
 * bar per kind, named as the list names its groups, since the breakdown is
 * what a reader acts on; one Needs attention line, the whole count, since it
 * says only that there is something to look at.
 *
 * @module widget-card
 */

import {
  defineAttentionItem,
  defineWidget,
  type AttentionItem,
  type PluginContributions,
} from "@nextlyhq/plugin-sdk";

import type { ProblemsFor } from "./problems/card-source";
import {
  KIND_ORDER,
  KIND_TEXT,
  PROBLEMS_PAGE_HREF,
  problemsToFix,
  severityCounts,
  type Problem,
} from "./problems/contract";

/** The card's id, in the `namespace/name` shape every widget id takes. */
export const SEO_ISSUES_WIDGET_ID = "seo/issues";

/**
 * The key the list read for one answer is kept under, in the scope core
 * hands this plugin's card and line; scopes are per owner and per person,
 * so what one answer asks reads the list once.
 */
const PROBLEMS_KEY = "problem-list";

/** The scope core hands a card's `load` and the line's `count`. */
type CardScope = Parameters<AttentionItem["count"]>[0]["scope"];

/** What a card's `load` and the line's `count` are handed. */
type CardInput = Parameters<AttentionItem["count"]>[0];

/**
 * A widget as `contributes.dashboard.widgets` holds it, named from the SDK's
 * own contribution type because the SDK publishes no name for it.
 */
type DashboardWidget = NonNullable<
  NonNullable<PluginContributions["dashboard"]>["widgets"]
>[number];

/**
 * One bar of the card: a kind of problem, and how many there are. A type
 * rather than an interface, so it has the implicit index signature the check
 * of what JSON carries reads a widget's data through.
 */
type IssueBucket = { value: string; count: number };

/** What the card and its line are built from. */
export interface SeoIssuesSetup {
  /** The collections SEO is added to. */
  collections: readonly string[];
  /** The problem list as the person asking may read it. */
  problemsFor: ProblemsFor;
}

/** Where the problem list is, as a path relative to the admin. */
const PROBLEMS_LINK = PROBLEMS_PAGE_HREF.replace(/^\/admin\//, "");

/**
 * The card's bars for `problems`: one per kind found, in the list's order,
 * named as the list names its group. A kind with none is left out, so a site
 * with nothing to fix answers no bars and the frame draws the card's empty
 * state, rather than a chart of zeros.
 */
function issueBuckets(problems: readonly Problem[]): {
  buckets: IssueBucket[];
} {
  const buckets = KIND_ORDER.map(kind => ({
    value: KIND_TEXT[kind].title,
    count: problems.filter(problem => problem.kind === kind).length,
  })).filter(bucket => bucket.count > 0);
  return { buckets };
}

/**
 * The preview page's sample: a few kinds of problem with sample counts, drawn
 * through the same `issueBuckets` the card's `load` answers by.
 */
function sampleProblems(): Problem[] {
  const sample: Problem[] = [];
  const counts = { noDescription: 6, longTitle: 4, shareImage: 3, imageAlt: 2 };
  for (const [kind, count] of Object.entries(counts)) {
    for (let at = 0; at < count; at++) {
      sample.push({
        kind: kind as Problem["kind"],
        subject: { label: "Sample page" },
        what: "",
        action: "",
        fix: { place: "page", tab: "seo" },
      });
    }
  }
  return sample;
}

/**
 * The list as `input`'s person may read it, read once for every card and
 * line of one answer.
 */
function listFor(
  setup: SeoIssuesSetup,
  input: Pick<CardInput, "user" | "services"> & { scope: CardScope }
): Promise<readonly Problem[]> {
  return input.scope.getOrCompute(PROBLEMS_KEY, () =>
    setup.problemsFor({ user: input.user, services: input.services })
  );
}

/**
 * The card, or nothing when no collection carries SEO: a plugin registered
 * with no collections checks no page of one.
 *
 * 🔴 `access` names the collections the list reads, so only a person who may
 * read every one of them is offered the card; anyone else is told it is not
 * available. Its `load` reads the list as that person, so the number is
 * theirs.
 */
export function seoIssuesWidget(
  setup: SeoIssuesSetup
): DashboardWidget | undefined {
  if (setup.collections.length === 0) return undefined;

  return defineWidget({
    id: SEO_ISSUES_WIDGET_ID,
    title: "SEO issues",
    description: "What the SEO problem list finds, by kind",
    icon: "search",
    category: "SEO",
    // A third of the row by default and three rows tall, room for a bar per
    // kind; from a quarter to half the row.
    size: {
      default: { w: 4, h: 3 },
      min: { w: 3, h: 3 },
      max: { w: 6, h: 4 },
    },
    access: { collections: [...setup.collections] },
    load: async input => issueBuckets(await listFor(setup, input)),
    view: "bars",
    skeleton: "bars",
    empty: { message: "The SEO problem list has nothing to fix." },
    preview: [
      {
        name: "Some pages need work",
        data: issueBuckets(sampleProblems()),
      },
    ],
  });
}

/** The Needs attention line's id. */
export const SEO_PROBLEMS_ATTENTION_ID = "seo/problems";

/**
 * The card's count as one line of the Needs attention card: the errors and
 * warnings the list shows the person, counted as the list and the Overview
 * count them, linked to the list; none where the card is withheld. The SEO
 * menu's Problems item shows the same number as its badge. Notices wait on
 * the list without asking for attention.
 *
 * 🔴 It names every collection SEO is added to, so core shows it to anyone
 * who may read one of them and lets it read those, as that person. The list
 * it counts asks only of the types that person may read, so a reader of one
 * collection is counted that collection's pages and the whole site's
 * problems, as the list shows them.
 */
export function seoProblemsAttentionItem(
  setup: SeoIssuesSetup
): AttentionItem | undefined {
  const [first, ...rest] = setup.collections;
  if (first === undefined) return undefined;
  return defineAttentionItem({
    id: SEO_PROBLEMS_ATTENTION_ID,
    label: "SEO problems",
    collections: [first, ...rest],
    count: async input =>
      problemsToFix(severityCounts(await listFor(setup, input))),
    link: PROBLEMS_LINK,
  });
}
