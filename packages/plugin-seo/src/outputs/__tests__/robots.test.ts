/**
 * The robots.txt each AI crawler choice produces: search engines always
 * allowed, the admin kept out, the AI crawlers each choice names asked to stay
 * away, and the sitemap named by its absolute address.
 */
import { FRAMEWORK_CRAWL_EXCLUSIONS } from "@nextlyhq/plugin-sdk";
import { nextlyRobots } from "nextly/runtime";
import { describe, expect, it } from "vitest";

import {
  AI_CRAWLERS,
  AI_CRAWLERS_CHECKED,
  AI_SEARCH_CRAWLERS,
  AI_TRAINING_CRAWLERS,
  robotsTxt,
  type AiCrawlerChoice,
} from "../robots";

const SITEMAP = "https://example.com/sitemap.xml";

/** The user agents a file shuts out entirely, in the order it names them. */
function shutOut(file: string): string[] {
  return file
    .split("\n\n")
    .filter(group => /^Disallow: \/$/m.test(group))
    .flatMap(group =>
      group
        .split("\n")
        .filter(line => line.startsWith("User-agent: "))
        .map(line => line.slice("User-agent: ".length))
    );
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
        "Amzn-User",
        "Claude-Agent",
      ])
    );
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
