/**
 * The site's robots.txt: search engines may read every page but the admin,
 * the AI crawlers the site's choice names are asked to stay away, and the
 * sitemap is named by its absolute address.
 *
 * Every rule here is a request. Well-behaved crawlers follow it; some do not.
 *
 * @module outputs/robots
 */
// The admin and the API, kept out by the one list every robots.txt of a
// Nextly site reads, `nextlyRobots` among them.
import { FRAMEWORK_CRAWL_EXCLUSIONS } from "@nextlyhq/plugin-sdk";

import type { AiCrawlerChoice } from "../settings/contract";

/**
 * What AI crawlers are asked: `all` lets every one read the site, `search`
 * asks only those that collect pages to train AI models to stay away, and
 * `block` asks every known one to. The SEO settings offer the same choices.
 */
export type { AiCrawlerChoice } from "../settings/contract";

/**
 * What an AI crawler reads pages for, as its provider describes it:
 * `training` collects pages to train AI models; `answers` reads pages to
 * answer a question and cite them, for a search index or because a person
 * asked; `own-request` visits only what the site itself asked for, such as a
 * page it submitted as an ad, so no choice asks it to stay away.
 */
export type AiCrawlerUse = "training" | "answers" | "own-request";

/** One AI crawler, by the name robots.txt addresses it by. */
export interface AiCrawler {
  /** The user-agent token, as its provider spells it in robots.txt. */
  readonly name: string;
  readonly provider: string;
  readonly use: AiCrawlerUse;
  /**
   * The provider's own page naming the crawler, which each release checks
   * the names against; null where the provider publishes none.
   */
  readonly source: string | null;
}

/**
 * The day every name below was last checked against its provider's page.
 * Check them again before each release and move this date: providers add,
 * rename and split their crawlers.
 */
export const AI_CRAWLERS_CHECKED = "2026-11-13";

const OPENAI = "https://developers.openai.com/api/docs/bots";
const ANTHROPIC =
  "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler";
const GOOGLE =
  "https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers";
const META =
  "https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/";
const AMAZON = "https://developer.amazon.com/amazonbot";
const PERPLEXITY = "https://docs.perplexity.ai/guides/bots";
const MISTRAL = "https://docs.mistral.ai/robots";

/**
 * Every AI crawler the plugin knows, in the order robots.txt names them.
 * `Google-Extended` is how Google is asked not to train on a site, which
 * also limits what Gemini can use from it; Google Search reads as
 * `Googlebot` and is not affected. robots.txt matches names whatever their
 * case, so a provider's change of case changes nothing a crawler reads.
 */
export const AI_CRAWLERS: readonly AiCrawler[] = [
  { name: "GPTBot", provider: "OpenAI", use: "training", source: OPENAI },
  {
    name: "ClaudeBot",
    provider: "Anthropic",
    use: "training",
    source: ANTHROPIC,
  },
  {
    name: "Google-Extended",
    provider: "Google",
    use: "training",
    source: GOOGLE,
  },
  {
    name: "Applebot-Extended",
    provider: "Apple",
    use: "training",
    source: "https://support.apple.com/en-us/119829",
  },
  {
    name: "CCBot",
    provider: "Common Crawl",
    use: "training",
    source: "https://commoncrawl.org/ccbot",
  },
  {
    name: "meta-externalagent",
    provider: "Meta",
    use: "training",
    source: META,
  },
  // ByteDance and Cohere publish no page for these; kept because sites
  // still see them, and asked to stay away only by the choices that ask
  // trainers to.
  { name: "Bytespider", provider: "ByteDance", use: "training", source: null },
  { name: "Amazonbot", provider: "Amazon", use: "training", source: AMAZON },
  {
    name: "cohere-training-data-crawler",
    provider: "Cohere",
    use: "training",
    source: null,
  },
  {
    name: "MistralAI-Training",
    provider: "Mistral",
    use: "training",
    source: MISTRAL,
  },
  {
    name: "OAI-SearchBot",
    provider: "OpenAI",
    use: "answers",
    source: OPENAI,
  },
  { name: "ChatGPT-User", provider: "OpenAI", use: "answers", source: OPENAI },
  {
    name: "Claude-SearchBot",
    provider: "Anthropic",
    use: "answers",
    source: ANTHROPIC,
  },
  {
    name: "Claude-User",
    provider: "Anthropic",
    use: "answers",
    source: ANTHROPIC,
  },
  {
    name: "PerplexityBot",
    provider: "Perplexity",
    use: "answers",
    source: PERPLEXITY,
  },
  {
    name: "Perplexity-User",
    provider: "Perplexity",
    use: "answers",
    source: PERPLEXITY,
  },
  {
    name: "DuckAssistBot",
    provider: "DuckDuckGo",
    use: "answers",
    source:
      "https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot",
  },
  {
    name: "MistralAI-User",
    provider: "Mistral",
    use: "answers",
    source: MISTRAL,
  },
  {
    name: "meta-externalfetcher",
    provider: "Meta",
    use: "answers",
    source: META,
  },
  {
    name: "Claude-Agent",
    provider: "Anthropic",
    use: "answers",
    source: ANTHROPIC,
  },
  {
    name: "Meta-WebIndexer",
    provider: "Meta",
    use: "answers",
    source: META,
  },
  {
    name: "MistralAI-Index",
    provider: "Mistral",
    use: "answers",
    source: MISTRAL,
  },
  {
    name: "Amzn-SearchBot",
    provider: "Amazon",
    use: "answers",
    source: AMAZON,
  },
  { name: "Amzn-User", provider: "Amazon", use: "answers", source: AMAZON },
  // Visits only landing pages the site itself submitted as ads in ChatGPT,
  // to check they are safe; collects nothing for training. Asking it to
  // stay away would stop OpenAI checking ads the site placed.
  {
    name: "OAI-AdsBot",
    provider: "OpenAI",
    use: "own-request",
    source: OPENAI,
  },
  // Crawls only what a site owner asked for to build a Vertex AI agent, and
  // does not affect Google Search.
  {
    name: "Google-CloudVertexBot",
    provider: "Google",
    use: "own-request",
    source: GOOGLE,
  },
];

/** The names of the crawlers that read pages for `use`, in the list's order. */
function namesFor(use: AiCrawlerUse): readonly string[] {
  return AI_CRAWLERS.filter(crawler => crawler.use === use).map(
    crawler => crawler.name
  );
}

/** The crawlers that collect pages to train AI models. */
export const AI_TRAINING_CRAWLERS: readonly string[] = namesFor("training");

/**
 * The crawlers AI tools read pages with to answer a question and cite them,
 * and to fetch a page a person asked about.
 */
export const AI_SEARCH_CRAWLERS: readonly string[] = namesFor("answers");

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
    [
      "User-agent: *",
      "Allow: /",
      ...FRAMEWORK_CRAWL_EXCLUSIONS.map(path => `Disallow: ${path}`),
    ],
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
