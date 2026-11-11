/**
 * The site's robots.txt: search engines may read every page but the admin,
 * the AI crawlers the site's choice names are asked to stay away, and the
 * sitemap is named by its absolute address.
 *
 * Every rule here is a request. Well-behaved crawlers follow it; some do not.
 *
 * @module outputs/robots
 */

/**
 * What AI crawlers are asked: `all` lets every one read the site, `search`
 * asks only those that collect pages to train AI models to stay away, and
 * `block` asks every known one to.
 */
export type AiCrawlerChoice = "all" | "search" | "block";

/**
 * The crawlers that collect pages to train AI models. `Google-Extended` is how
 * Google is asked not to train on a site, which also limits what Gemini can
 * use from it; Google Search reads as `Googlebot` and is not affected.
 */
export const AI_TRAINING_CRAWLERS: readonly string[] = [
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "meta-externalagent",
  "Bytespider",
  "Amazonbot",
  "cohere-training-data-crawler",
];

/**
 * The crawlers AI tools read pages with to answer a question and cite them,
 * and to fetch a page a person asked about.
 */
export const AI_SEARCH_CRAWLERS: readonly string[] = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "DuckAssistBot",
  "MistralAI-User",
  "meta-externalfetcher",
];

/**
 * The admin and the API, on a path boundary: the trailing-slash form covers
 * everything below, `$` pins the bare root where a crawler reads it, and `?`
 * covers the root with a query. None takes `/administration`, which is a page
 * a site may serve. The same paths `nextlyRobots` keeps out.
 */
const KEPT_OUT = ["/admin/", "/admin$", "/admin?", "/api/", "/api$", "/api?"];

/** The crawlers a choice asks to stay away, in the order the file names them. */
function shutOut(choice: AiCrawlerChoice): readonly string[] {
  if (choice === "search") return AI_TRAINING_CRAWLERS;
  if (choice === "block") {
    return [...AI_TRAINING_CRAWLERS, ...AI_SEARCH_CRAWLERS];
  }
  return [];
}

/**
 * The robots.txt for a site: `sitemap` is the sitemap's absolute address,
 * absent where the site serves none.
 */
export function robotsTxt(options: {
  sitemap?: string;
  aiCrawlers: AiCrawlerChoice;
}): string {
  const groups = [
    ["User-agent: *", "Allow: /", ...KEPT_OUT.map(path => `Disallow: ${path}`)],
    // A group of its own for each crawler: a crawler that finds its own name
    // reads that group alone, and some read a group naming several poorly.
    ...shutOut(options.aiCrawlers).map(agent => [
      `User-agent: ${agent}`,
      "Disallow: /",
    ]),
  ];
  if (options.sitemap !== undefined) {
    groups.push([`Sitemap: ${options.sitemap}`]);
  }
  return `${groups.map(lines => lines.join("\n")).join("\n\n")}\n`;
}
