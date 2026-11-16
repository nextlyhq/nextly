/**
 * Which pages robots.txt keeps search engines from: the one judgement the
 * problem list and the settings screen's confirmation both read, made over
 * the file as served, the plugin's own lines and the site's together, as
 * crawlers read it.
 *
 * A page counts as blocked when Googlebot, Bingbot or a crawler the file does
 * not name is kept from it. The AI crawlers' groups are the AI tools choice,
 * not a block on search, so they are not asked.
 *
 * @module settings/robots-blocks
 */
import { robotsTxt } from "../outputs/robots";

import type { AiCrawlerChoice } from "./contract";
import {
  blockingRule,
  groupsOf,
  readOwnRules,
  type BlockedPagesOfLine,
  type PathRule,
  type RuleGroup,
} from "./robots-rules";

/** The crawlers whose block keeps a page out of search. */
const SEARCH_CRAWLERS = ["googlebot", "bingbot", "*"];

/** The rule keeping search engines from a page, and the own line it is on. */
export interface RobotsBlock {
  /** Its line in the site's own rules; none for one of Nextly's own. */
  line?: number;
  /** The rule as a line of robots.txt, such as `Disallow: /blog`. */
  rule: string;
}

/** The groups of the file as served: the plugin's, then the site's own. */
export function servedGroups(options: {
  aiCrawlers: AiCrawlerChoice;
  ownRules?: string;
}): RuleGroup[] {
  // The plugin's lines carry no line of the box: 0 marks them as its own.
  const plugin = groupsOf(robotsTxt({ aiCrawlers: options.aiCrawlers })).map(
    group => ({
      ...group,
      rules: group.rules.map(rule => ({ ...rule, line: 0 })),
    })
  );
  const own =
    options.ownRules === undefined || readOwnRules(options.ownRules).refused
      ? []
      : groupsOf(options.ownRules);
  return [...plugin, ...own];
}

/** A rule as a line of robots.txt. */
function ruleLine(rule: PathRule): string {
  return `${rule.allow ? "Allow" : "Disallow"}: ${rule.pattern}`;
}

/** The rule keeping search engines from the page at `path`, where one does. */
export function robotsBlockOf(
  groups: readonly RuleGroup[],
  path: string
): RobotsBlock | undefined {
  for (const agent of SEARCH_CRAWLERS) {
    const rule = blockingRule(groups, agent, path);
    if (rule !== undefined) {
      return {
        ...(rule.line === 0 ? {} : { line: rule.line }),
        rule: ruleLine(rule),
      };
    }
  }
  return undefined;
}

/** The path, with its query, of a page's address, absolute or from the root. */
export function crawledPathOf(address: string): string {
  const url = new URL(address, "http://site.invalid");
  return `${url.pathname}${url.search}`;
}

/**
 * The sitemap's pages the site's own lines block, by line, and every
 * blocked path, which a confirmation is tied to. Pages Nextly's own lines
 * block are left to the problem list: the box can't unblock them.
 */
export function blockedByOwnRules(
  groups: readonly RuleGroup[],
  paths: readonly string[],
  examples = 3
): { lines: BlockedPagesOfLine[]; paths: string[] } {
  const byLine = new Map<number, BlockedPagesOfLine>();
  const blocked: string[] = [];
  for (const path of new Set(paths)) {
    const block = robotsBlockOf(groups, path);
    if (block?.line === undefined) continue;
    blocked.push(path);
    const entry = byLine.get(block.line) ?? {
      line: block.line,
      rule: block.rule,
      count: 0,
      examples: [],
    };
    entry.count += 1;
    if (entry.examples.length < examples) entry.examples.push(path);
    byLine.set(block.line, entry);
  }
  return {
    lines: [...byLine.values()].sort((a, b) => a.line - b.line),
    paths: blocked,
  };
}
