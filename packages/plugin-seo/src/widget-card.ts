/**
 * The dashboard card that draws this plugin's SEO issues.
 *
 * `contributes.admin.widgets` is the presentation half of what
 * `contributes.widgetSources` publishes: the source answers a question, and the
 * card says how a reader meets the answer. The host draws it -- this plugin
 * ships no admin component, so nothing of its code enters the admin bundle and
 * the card cannot break a dashboard it is placed on.
 *
 * ## Why several numbers rather than one
 *
 * `stats` gives one labelled number per issue, which is the breakdown a reader
 * acts on: "eleven pages have no title" says what to do, where "twenty-three SEO
 * issues" does not.
 *
 * 🔴 Each cell is its OWN count query, by the archetype's design -- that is what
 * keeps every number an ordinary access-controlled read rather than one
 * composite answer covering all of them. So the card costs one bounded scan per
 * cell. A grouped query would collapse them into a single scan, and this source
 * cannot answer one honestly while `WidgetResult`'s grouped arm has no way to
 * say its bucket counts are floors.
 *
 * ## Why the cells are computed
 *
 * From the same {@link IssueChecks} the resolver counts by, so a project that
 * replaced the default fields gets cells only for what it installed. A hand
 * written list would offer a number for a field nobody stores, and the card
 * would sit at zero forever with nothing to say why.
 *
 * @module widget-card
 */

import type { FieldConfig, PluginAdminStatsWidget } from "@nextlyhq/plugin-sdk";

import {
  checksFor,
  ISSUE_FIELD,
  reportableIssues,
  SEO_ISSUES_SOURCE_ID,
} from "./widget-source";

/** The card's id, in the `namespace/name` shape every widget id takes. */
export const SEO_ISSUES_WIDGET_ID = "seo/issues";

/**
 * The card, or nothing when no installed field can be checked.
 *
 * A `stats` card with no cells is refused at boot, and rightly: it would draw an
 * empty frame. A project whose `fields` override leaves nothing this source
 * understands gets no card rather than a broken one.
 */
export function seoIssuesWidget(
  installed: readonly FieldConfig[]
): PluginAdminStatsWidget | undefined {
  const issues = reportableIssues(checksFor(installed));
  if (issues.length === 0) return undefined;

  return {
    id: SEO_ISSUES_WIDGET_ID,
    archetype: "stats",
    title: "SEO issues",
    description: "Published pages missing search and social metadata",
    size: "half",
    cells: issues.map(issue => ({
      key: issue.key,
      label: issue.label,
      query: {
        source: SEO_ISSUES_SOURCE_ID,
        op: "count" as const,
        // The published `issue` field, which the resolver honours -- this is
        // the per-issue number a grouped query would otherwise be needed for.
        where: { [ISSUE_FIELD]: { equals: issue.label } },
      },
    })),
  };
}
