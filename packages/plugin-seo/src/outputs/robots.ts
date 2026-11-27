/**
 * The site's robots.txt: search engines may read every page but the admin,
 * the AI crawlers the site's choice names are asked to stay away, the shared
 * AI-training opt-out is written wherever the choice asks trainers away, and
 * the sitemap is named by its absolute address.
 *
 * Every rule here is a request. Well-behaved crawlers follow it; some do not.
 *
 * @module outputs/robots
 */
// The admin and the API, kept out by the one list every robots.txt of a
// Nextly site reads, `nextlyRobots` among them.
import { FRAMEWORK_CRAWL_EXCLUSIONS } from "@nextlyhq/plugin-sdk";

import type { AiCrawlerChoice } from "../settings/contract";
import { readOwnRules } from "../settings/robots-rules";
import { SHARE_CARD_PREFIX } from "../social/share-card";

import {
  AI_TRAINING_OPT_OUT,
  askedAway,
  contentSignalOf,
  shutOutBy,
} from "./ai-crawlers";

// The list itself lives where the settings screen can read it too.
export {
  AI_CRAWLERS,
  AI_CRAWLERS_CHECKED,
  AI_SEARCH_CRAWLERS,
  AI_TRAINING_CRAWLERS,
  AI_USER_TRIGGERED_FETCHERS,
} from "./ai-crawlers";

/**
 * What AI crawlers are asked: `all` lets every one read the site, `search`
 * asks only those that collect pages to train AI models to stay away, and
 * `block` asks every known one to. The SEO settings offer the same choices.
 */
export type { AiCrawlerChoice } from "../settings/contract";

/**
 * The shared AI-training opt-out's group, for a choice that asks trainers to
 * stay away: "search" and "block" both do, "all" asks nothing. It is a group
 * of its own because a `User-agent: *` group never applies to the token, and
 * its `Disallow: /` covers every page, the admin and the site's own
 * disallowed paths among them.
 */
function trainingOptOut(choice: AiCrawlerChoice): string[][] {
  return askedAway("training", choice)
    ? [[`User-agent: ${AI_TRAINING_OPT_OUT}`, "Disallow: /"]]
    : [];
}

/**
 * The site's own lines as served: each trimmed, without the blank lines at
 * either end, and none at all for an empty box or one its own check refuses,
 * so a line that would keep crawlers from the whole site is never served.
 */
function ownLinesOf(ownRules: string | undefined): string[] {
  if (ownRules === undefined || readOwnRules(ownRules).refused) return [];
  const lines = ownRules.split(/\r\n|\r|\n/).map(line => line.trim());
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  return lines;
}

/**
 * The robots.txt for a site: `sitemap` is the sitemap's absolute address,
 * absent where the site serves none; `ownRules` are the lines the site adds
 * in the SEO settings, served after every line of the plugin's own; and
 * `contentSignal` adds a Content-Signal line stating the AI tools choice to
 * the group for every crawler. That line is not a standard: crawlers that
 * don't know it skip it, and no rule of the file changes with it.
 */
export function robotsTxt(options: {
  sitemap?: string;
  aiCrawlers: AiCrawlerChoice;
  ownRules?: string;
  contentSignal?: boolean;
}): string {
  const groups = [
    [
      "User-agent: *",
      // Under the crawlers' names, where Cloudflare's own files put it.
      ...(options.contentSignal === true
        ? [`Content-Signal: ${contentSignalOf(options.aiCrawlers)}`]
        : []),
      "Allow: /",
      ...FRAMEWORK_CRAWL_EXCLUSIONS.map(path => `Disallow: ${path}`),
      // The share cards the plugin serves under the admin's API, which
      // networks fetch as crawlers do: the longer rule wins over the
      // admin's, so nothing else under it is opened.
      `Allow: ${SHARE_CARD_PREFIX}`,
    ],
    // A group of its own for each crawler: a crawler that finds its own name
    // reads that group alone, and some read a group naming several poorly.
    ...shutOutBy(options.aiCrawlers).map(agent => [
      `User-agent: ${agent}`,
      "Disallow: /",
    ]),
    ...trainingOptOut(options.aiCrawlers),
  ];
  if (options.sitemap !== undefined) {
    groups.push([`Sitemap: ${options.sitemap}`]);
  }
  // Last, so they add to the plugin's lines and never stand in for them: a
  // crawler joins every group naming it, wherever in the file it is.
  const own = ownLinesOf(options.ownRules);
  if (own.length > 0) {
    groups.push(["# Your own rules, from the SEO settings", ...own]);
  }
  return `${groups.map(lines => lines.join("\n")).join("\n\n")}\n`;
}
