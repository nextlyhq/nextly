/**
 * The AI crawlers robots.txt names, as data: each by the name robots.txt
 * addresses it by, its provider, what it reads pages for, and the provider's
 * page the name is checked against; and the lines that state the AI tools
 * choice to every AI company at once. It imports nothing but a type, so the
 * settings screen reads the same list and lines robots.txt is written from.
 *
 * @module outputs/ai-crawlers
 */
import type { AiCrawlerChoice } from "../settings/contract";

/**
 * What an AI crawler reads pages for, as its provider describes it:
 * `training` collects pages to train AI models; `answers` reads pages to
 * answer a question and cite them, for a search index or because a person
 * asked; `user-triggered` fetches a page because a person asked for it, and
 * its provider says robots.txt may not apply to it, so a request to stay
 * away may go unread; `own-request` visits only what the site itself asked
 * for, such as a page it submitted as an ad, so no choice asks it to stay
 * away.
 */
export type AiCrawlerUse =
  | "training"
  | "answers"
  | "user-triggered"
  | "own-request";

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
export const AI_CRAWLERS_CHECKED = "2026-11-27";

const OPENAI = "https://developers.openai.com/api/docs/bots";
const ANTHROPIC =
  "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler";
const GOOGLE =
  "https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers";
const GOOGLE_USER_TRIGGERED =
  "https://developers.google.com/search/docs/crawling-indexing/google-user-triggered-fetchers";
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
  // Fetched because a person asked for the page, and each provider says
  // robots.txt may not apply: "Block all AI tools" still asks them, since
  // asking costs nothing, but the screen says the request may go unread.
  {
    name: "ChatGPT-User",
    provider: "OpenAI",
    use: "user-triggered",
    source: OPENAI,
  },
  {
    name: "Perplexity-User",
    provider: "Perplexity",
    use: "user-triggered",
    source: PERPLEXITY,
  },
  {
    name: "meta-externalfetcher",
    provider: "Meta",
    use: "user-triggered",
    source: META,
  },
  {
    name: "Amzn-User",
    provider: "Amazon",
    use: "user-triggered",
    source: AMAZON,
  },
  {
    name: "Google-Agent",
    provider: "Google",
    use: "user-triggered",
    source: GOOGLE_USER_TRIGGERED,
  },
  {
    name: "Google-GeminiNotebook",
    provider: "Google",
    use: "user-triggered",
    source: GOOGLE_USER_TRIGGERED,
  },
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

/**
 * Whether a choice asks the crawlers of `use` to stay away: "block" asks
 * every one but those visiting only what the site asked for, "search" only
 * those that train, "all" none. robots.txt and the settings screen's table
 * both read it here.
 */
export function askedAway(use: AiCrawlerUse, choice: AiCrawlerChoice): boolean {
  if (use === "own-request") return false;
  return choice === "block" || (choice === "search" && use === "training");
}

/** The crawlers a choice asks to stay away, in the order the list names them. */
export function shutOutBy(choice: AiCrawlerChoice): readonly string[] {
  return AI_CRAWLERS.filter(crawler => askedAway(crawler.use, choice)).map(
    crawler => crawler.name
  );
}

/** The crawlers that collect pages to train AI models. */
export const AI_TRAINING_CRAWLERS: readonly string[] = namesFor("training");

/**
 * The crawlers AI tools read pages with to answer a question and cite them,
 * and to fetch a page a person asked about where the provider says the
 * fetch follows robots.txt.
 */
export const AI_SEARCH_CRAWLERS: readonly string[] = namesFor("answers");

/**
 * The fetchers that read a page because a person asked for it, whose
 * providers say robots.txt may not apply to them.
 */
export const AI_USER_TRIGGERED_FETCHERS: readonly string[] =
  namesFor("user-triggered");

/**
 * The shared AI-training opt-out: a robots.txt group named by this policy
 * token, rather than by any crawler, asks every AI company that reads it not
 * to train on the pages it disallows (an individual IETF draft,
 * draft-kelley-aipref-training-preference-signal, not yet a standard). A
 * `User-agent: *` group never applies to it, so it is asked only by name.
 * Anthropic honours it now; Google and Microsoft say they will in 2027.
 */
export const AI_TRAINING_OPT_OUT = "__usage_ai-training";

/**
 * The Content-Signal values an AI tools choice states (Cloudflare's Content
 * Signals Policy, not a standard): search always, AI answers unless every
 * AI tool is asked away, and training only where every AI tool may read the
 * site. Each value is spelled out, so a reader never has to guess what an
 * absent one means.
 */
export function contentSignalOf(choice: AiCrawlerChoice): string {
  const yes = (on: boolean) => (on ? "yes" : "no");
  return [
    "search=yes",
    `ai-input=${yes(choice !== "block")}`,
    `ai-train=${yes(choice === "all")}`,
  ].join(", ");
}
