/**
 * The robots.txt each AI crawler choice produces: search engines always
 * allowed, the admin kept out, the AI crawlers each choice names asked to stay
 * away, and the sitemap named by its absolute address.
 */
import { FRAMEWORK_CRAWL_EXCLUSIONS } from "@nextlyhq/plugin-sdk";
import { nextlyRobots } from "nextly/runtime";
import { describe, expect, it } from "vitest";

import { blockingRule, groupsOf } from "../../settings/robots-rules";
import {
  AI_CRAWLERS,
  AI_CRAWLERS_CHECKED,
  AI_SEARCH_CRAWLERS,
  AI_TRAINING_CRAWLERS,
  AI_USER_TRIGGERED_FETCHERS,
  robotsTxt,
  type AiCrawlerChoice,
} from "../robots";

const SITEMAP = "https://example.com/sitemap.xml";

/** The shared AI-training opt-out's policy token. */
const OPT_OUT = "__usage_ai-training";

/**
 * The crawlers a file shuts out entirely, in the order it names them: the
 * shared AI-training opt-out is a policy token, not a crawler, so it is read
 * on its own.
 */
function shutOut(file: string): string[] {
  return file
    .split("\n\n")
    .filter(group => /^Disallow: \/$/m.test(group))
    .flatMap(group =>
      group
        .split("\n")
        .filter(line => line.startsWith("User-agent: "))
        .map(line => line.slice("User-agent: ".length))
    )
    .filter(agent => agent !== OPT_OUT);
}

describe("robots.txt for each AI crawler choice", () => {
  it("allow all: every crawler may read every page but the admin", () => {
    const file = robotsTxt({ sitemap: SITEMAP, aiCrawlers: "all" });
    expect(file).toBe(
      [
        "User-agent: *",
        "Allow: /",
        "Disallow: /admin/",
        "Disallow: /admin$",
        "Disallow: /admin?",
        "Disallow: /api/",
        "Disallow: /api$",
        "Disallow: /api?",
        // Share cards, under the admin's API, are fetched by networks.
        "Allow: /admin/api/plugins/@nextlyhq/plugin-seo/share-card/",
        "",
        `Sitemap: ${SITEMAP}`,
        "",
      ].join("\n")
    );
    expect(shutOut(file)).toEqual([]);
  });

  it("search but not training: only the crawlers that collect pages for training are asked to stay away", () => {
    const file = robotsTxt({ sitemap: SITEMAP, aiCrawlers: "search" });
    expect(shutOut(file)).toEqual([...AI_TRAINING_CRAWLERS]);
    // Asking Google not to train is Google-Extended, which also limits Gemini.
    expect(shutOut(file)).toContain("Google-Extended");
    for (const searching of AI_SEARCH_CRAWLERS) {
      expect(file).not.toContain(`User-agent: ${searching}\n`);
    }
  });

  it("block all: every known AI crawler is asked to stay away", () => {
    const file = robotsTxt({ sitemap: SITEMAP, aiCrawlers: "block" });
    expect(shutOut(file)).toEqual([
      ...AI_TRAINING_CRAWLERS,
      ...AI_SEARCH_CRAWLERS,
      ...AI_USER_TRIGGERED_FETCHERS,
    ]);
    // The tools that answer questions as well as those that train.
    for (const agent of [
      "GPTBot",
      "OAI-SearchBot",
      "PerplexityBot",
      "ClaudeBot",
    ]) {
      expect(shutOut(file)).toContain(agent);
    }
  });

  it.each(["all", "search", "block"] as AiCrawlerChoice[])(
    "%s: search engines are never named, and the file ends naming the sitemap",
    aiCrawlers => {
      const file = robotsTxt({ sitemap: SITEMAP, aiCrawlers });
      for (const search of ["Googlebot", "Bingbot", "bingbot"]) {
        expect(file).not.toContain(`User-agent: ${search}`);
      }
      expect(file.trimEnd().split("\n").at(-1)).toBe(`Sitemap: ${SITEMAP}`);
    }
  );

  it("names no sitemap where the site serves none", () => {
    const file = robotsTxt({ aiCrawlers: "all" });
    expect(file).not.toContain("Sitemap:");
    expect(file.startsWith("User-agent: *\nAllow: /\n")).toBe(true);
  });

  it("names each crawler once, in one group of its own", () => {
    const file = robotsTxt({ sitemap: SITEMAP, aiCrawlers: "block" });
    const agents = shutOut(file);
    expect(new Set(agents).size).toBe(agents.length);
    expect(file).toContain("User-agent: GPTBot\nDisallow: /\n");
  });

  it("keeps crawlers out of the paths nextlyRobots keeps them out of, read from one list", () => {
    const file = robotsTxt({ aiCrawlers: "all" });
    const kept = file
      .split("\n")
      .filter(line => line.startsWith("Disallow: "))
      .map(line => line.slice("Disallow: ".length));
    expect(kept).toEqual([...FRAMEWORK_CRAWL_EXCLUSIONS]);
    expect(nextlyRobots()().rules).toMatchObject({
      disallow: [...FRAMEWORK_CRAWL_EXCLUSIONS],
    });
  });
});

describe("the AI crawler names, as data", () => {
  it("states each crawler's provider page and the day the names were checked", () => {
    expect(AI_CRAWLERS_CHECKED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const crawler of AI_CRAWLERS) {
      // A provider that publishes no page for its crawler says so with null,
      // rather than pointing at someone else's list.
      if (crawler.source !== null) {
        expect(new URL(crawler.source).protocol).toBe("https:");
      }
    }
    const names = AI_CRAWLERS.map(crawler => crawler.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps the names the providers' pages list today", () => {
    const of = (use: string) =>
      AI_CRAWLERS.filter(crawler => crawler.use === use).map(
        crawler => crawler.name
      );
    expect(of("training")).toEqual(
      expect.arrayContaining(["MistralAI-Training"])
    );
    expect(of("answers")).toEqual(
      expect.arrayContaining([
        "Meta-WebIndexer",
        "MistralAI-Index",
        "Amzn-SearchBot",
        "Claude-Agent",
      ])
    );
    // Each provider says these may not follow robots.txt, since a person
    // asked for the page.
    expect(of("user-triggered")).toEqual([
      "ChatGPT-User",
      "Perplexity-User",
      "meta-externalfetcher",
      "Amzn-User",
      "Google-Agent",
      "Google-GeminiNotebook",
    ]);
    expect(of("own-request")).toEqual(["OAI-AdsBot", "Google-CloudVertexBot"]);
  });

  it.each(["all", "search", "block"] as AiCrawlerChoice[])(
    "%s: never asks a crawler that visits only what the site itself asked for",
    aiCrawlers => {
      const file = robotsTxt({ sitemap: SITEMAP, aiCrawlers });
      for (const agent of ["OAI-AdsBot", "Google-CloudVertexBot"]) {
        expect(file).not.toContain(agent);
      }
    }
  );

  it("search but not training leaves the user-triggered fetchers alone; block asks them", () => {
    const search = robotsTxt({ sitemap: SITEMAP, aiCrawlers: "search" });
    const block = robotsTxt({ sitemap: SITEMAP, aiCrawlers: "block" });
    for (const agent of ["ChatGPT-User", "Google-Agent"]) {
      expect(shutOut(search)).not.toContain(agent);
      expect(shutOut(block)).toContain(agent);
    }
  });

  it("search but not training asks Mistral's training crawler, not its index", () => {
    const file = robotsTxt({ sitemap: SITEMAP, aiCrawlers: "search" });
    expect(shutOut(file)).toContain("MistralAI-Training");
    expect(shutOut(file)).not.toContain("MistralAI-Index");
  });
});

describe("robots.txt with the site's own rules", () => {
  const own =
    "User-agent: *\nDisallow: /search  \n\nContent-Signal: search=yes, ai-train=no\n\n";

  it("serves them after the plugin's own lines, which stay as they are", () => {
    const plain = robotsTxt({ sitemap: SITEMAP, aiCrawlers: "search" });
    const file = robotsTxt({
      sitemap: SITEMAP,
      aiCrawlers: "search",
      ownRules: own,
    });
    expect(file.startsWith(plain)).toBe(true);
    expect(file.slice(plain.length)).toBe(
      [
        "",
        "# Your own rules, from the SEO settings",
        "User-agent: *",
        "Disallow: /search",
        "",
        "Content-Signal: search=yes, ai-train=no",
        "",
      ].join("\n")
    );
  });

  it("serves nothing more for an empty box", () => {
    expect(
      robotsTxt({ sitemap: SITEMAP, aiCrawlers: "all", ownRules: " \n\n" })
    ).toBe(robotsTxt({ sitemap: SITEMAP, aiCrawlers: "all" }));
  });

  it("never serves rules their own check refuses", () => {
    expect(
      robotsTxt({
        sitemap: SITEMAP,
        aiCrawlers: "all",
        ownRules: "User-agent: *\nDisallow: /",
      })
    ).toBe(robotsTxt({ sitemap: SITEMAP, aiCrawlers: "all" }));
  });
});

describe("the shared AI-training opt-out", () => {
  /**
   * Whether the file asks the opt-out's readers away from `path`, read as the
   * draft reads it: only from groups naming the token, never from the group
   * for every crawler, which doesn't apply to it.
   */
  const optedOut = (file: string, path: string) =>
    blockingRule(
      groupsOf(file).filter(group => group.agents.includes(OPT_OUT)),
      OPT_OUT,
      path
    ) !== undefined;

  it.each(["search", "block"] as AiCrawlerChoice[])(
    "%s: writes the token in a group of its own, disallowing every page",
    aiCrawlers => {
      const file = robotsTxt({ sitemap: SITEMAP, aiCrawlers });
      expect(file).toContain(`\n\nUser-agent: ${OPT_OUT}\nDisallow: /\n\n`);
      // A group of its own: the group for every crawler never applies to the
      // token, so it is named, and nothing else is named beside it.
      const group = groupsOf(file).find(each => each.agents.includes(OPT_OUT));
      expect(group?.agents).toEqual([OPT_OUT]);
    }
  );

  it("all: writes no opt-out, so every AI tool may train", () => {
    const file = robotsTxt({ sitemap: SITEMAP, aiCrawlers: "all" });
    expect(file).not.toContain(OPT_OUT);
    expect(optedOut(file, "/blog/hello")).toBe(false);
  });

  it("search: the group keeps every page the site keeps crawlers from, its own rules' included", () => {
    const ownRules = "User-agent: *\nDisallow: /search";
    const file = robotsTxt({
      sitemap: SITEMAP,
      aiCrawlers: "search",
      ownRules,
    });
    const kept = [...FRAMEWORK_CRAWL_EXCLUSIONS, "/search"].map(path =>
      path.replace(/[$?]$/, "")
    );
    for (const path of kept) {
      // Disallowed for every crawler...
      expect(blockingRule(groupsOf(file), "*", path)).toBeDefined();
      // ...and for the opt-out too, as its own group repeats them.
      expect(optedOut(file, path)).toBe(true);
    }
    // And the pages every crawler may read, which only the opt-out closes.
    expect(blockingRule(groupsOf(file), "*", "/blog/hello")).toBeUndefined();
    expect(optedOut(file, "/blog/hello")).toBe(true);
  });
});

describe("the Content-Signal line", () => {
  it("is written only when ticked", () => {
    expect(robotsTxt({ sitemap: SITEMAP, aiCrawlers: "all" })).not.toContain(
      "Content-Signal"
    );
    expect(
      robotsTxt({ sitemap: SITEMAP, aiCrawlers: "all", contentSignal: false })
    ).not.toContain("Content-Signal");
  });

  it.each([
    ["all", "search=yes, ai-input=yes, ai-train=yes"],
    ["search", "search=yes, ai-input=yes, ai-train=no"],
    ["block", "search=yes, ai-input=no, ai-train=no"],
  ] as [AiCrawlerChoice, string][])(
    "%s: states the choice under User-agent: *",
    (aiCrawlers, values) => {
      const file = robotsTxt({
        sitemap: SITEMAP,
        aiCrawlers,
        contentSignal: true,
      });
      expect(
        file.startsWith(`User-agent: *\nContent-Signal: ${values}\nAllow: /\n`)
      ).toBe(true);
      expect(file.match(/Content-Signal:/g)).toHaveLength(1);
    }
  );

  it("changes no rule of the file", () => {
    // Each group's crawlers and rules, without the lines they are on, which
    // the extra line moves.
    const rulesOf = (file: string) =>
      groupsOf(file).map(group => ({
        agents: group.agents,
        rules: group.rules.map(({ allow, pattern }) => ({ allow, pattern })),
      }));
    for (const aiCrawlers of ["all", "search", "block"] as AiCrawlerChoice[]) {
      const plain = robotsTxt({ sitemap: SITEMAP, aiCrawlers });
      const signalled = robotsTxt({
        sitemap: SITEMAP,
        aiCrawlers,
        contentSignal: true,
      });
      expect(signalled).not.toBe(plain);
      expect(rulesOf(signalled)).toEqual(rulesOf(plain));
    }
  });
});
