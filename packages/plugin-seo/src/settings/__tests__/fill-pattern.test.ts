import { describe, expect, it } from "vitest";

import { fillPattern } from "../patterns";

describe("a pattern never adds the brand to a title that already ends with it", () => {
  it("leaves a rext.ai title that already names the brand as it is", () => {
    // A tool page's title as typed on rext.ai, which its old code wrapped
    // with a second brand.
    expect(
      fillPattern(
        "{Title} | {Site name}",
        {
          title: "Free AI Content Outline Generator for SEO Articles | Rext AI",
          siteName: "Rext AI",
        },
        {}
      )
    ).toBe("Free AI Content Outline Generator for SEO Articles | Rext AI");
  });

  it("leaves a nextlyhq.com title that already names the brand as it is", () => {
    expect(
      fillPattern(
        "{Title} | {Site name}",
        {
          title: "Nextly pricing: MIT licensed and self-hosted | Nextly",
          siteName: "Nextly",
        },
        {}
      )
    ).toBe("Nextly pricing: MIT licensed and self-hosted | Nextly");
  });

  it("matches the brand in any case", () => {
    expect(
      fillPattern(
        "{Title} — {Site name}",
        { title: "Our launch — rext ai", siteName: "Rext AI" },
        {}
      )
    ).toBe("Our launch — rext ai");
  });

  it("adds the brand where other words come between it and the title", () => {
    expect(
      fillPattern(
        "{Title} · {Category} | {Site name}",
        { title: "Surfer SEO vs Rext AI", siteName: "Rext AI" },
        { category: "Comparisons" }
      )
    ).toBe("Surfer SEO vs Rext AI · Comparisons | Rext AI");
  });

  it("still adds the brand where the title only ends with a longer word", () => {
    expect(
      fillPattern(
        "{Title} | {Site name}",
        { title: "Moving from SuperNextly", siteName: "Nextly" },
        {}
      )
    ).toBe("Moving from SuperNextly | Nextly");
    expect(
      fillPattern(
        "{Title} | {Site name}",
        { title: "Getting started", siteName: "Nextly" },
        {}
      )
    ).toBe("Getting started | Nextly");
  });

  it("keeps a brand the pattern puts before the title", () => {
    expect(
      fillPattern(
        "{Site name}: {Title}",
        { title: "Pricing | Nextly", siteName: "Nextly" },
        {}
      )
    ).toBe("Nextly: Pricing | Nextly");
  });
});

describe("a pattern's variables", () => {
  it("fills its tokens from the page, in any case or spacing", () => {
    expect(
      fillPattern(
        "{Title} in {category} | {Site name}",
        { title: "Hello", siteName: "Acme" },
        { category: "News" }
      )
    ).toBe("Hello in News | Acme");
  });

  it("fills a field named in words from its name", () => {
    expect(
      fillPattern(
        "{Title} ({Reading time} min)",
        { title: "Hello" },
        { readingTime: 4 }
      )
    ).toBe("Hello (4 min)");
  });

  it("gives nothing where a token has no value, so the next level answers", () => {
    expect(fillPattern("{Title} | {Site name}", { title: "Hello" }, {})).toBe(
      undefined
    );
  });
});
