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

describe("the brand is left out only where the pattern ends with it", () => {
  it("keeps the mark where the pattern goes on after the site's name (nextlyhq.com's blog)", () => {
    // nextlyhq.com's blog posts: `{Title} | {Site name} Blog`, as served.
    const blog = (title: string) =>
      fillPattern(
        "{Title} | {Site name} Blog",
        { title, siteName: "Nextly" },
        {}
      );
    expect(blog("Why we chose Nextly")).toBe(
      "Why we chose Nextly | Nextly Blog"
    );
    expect(blog("What is Nextly?")).toBe("What is Nextly? | Nextly Blog");
    expect(blog("Nextly Team")).toBe("Nextly Team | Nextly Blog");
  });

  it("adds the brand after a title that names it before its end (nextlyhq.com's pages)", () => {
    const page = (title: string) =>
      fillPattern("{Title} | {Site name}", { title, siteName: "Nextly" }, {});
    expect(page("Nextly changelog: releases and upgrade notes")).toBe(
      "Nextly changelog: releases and upgrade notes | Nextly"
    );
    expect(page("Nextly for developers")).toBe(
      "Nextly for developers | Nextly"
    );
    expect(page("Nextly 0.0.2-alpha.74 release notes")).toBe(
      "Nextly 0.0.2-alpha.74 release notes | Nextly"
    );
  });

  it("fills rext.ai's patterns as its pages are served", () => {
    expect(
      fillPattern(
        "{Title} | {Site name}",
        { title: "Case study: how WPGrit uses Rext AI", siteName: "Rext AI" },
        {}
      )
    ).toBe("Case study: how WPGrit uses Rext AI");
    expect(
      fillPattern(
        "{Title} | {Site name}",
        {
          title: "How WPGrit increased SEO-driven leads by 138% in 90 days",
          siteName: "Rext AI",
        },
        {}
      )
    ).toBe(
      "How WPGrit increased SEO-driven leads by 138% in 90 days | Rext AI"
    );
    expect(
      fillPattern(
        "{Title} articles | {Site name}",
        { title: "Alternatives", siteName: "Rext AI" },
        {}
      )
    ).toBe("Alternatives articles | Rext AI");
    expect(
      fillPattern(
        "{Name}, author at {Site name}",
        { siteName: "Rext AI" },
        { name: "Muhammad Usman" }
      )
    ).toBe("Muhammad Usman, author at Rext AI");
    expect(
      fillPattern(
        "{Title} — Free SEO Tool | {Site name}",
        { title: "Grammar checker", siteName: "Rext AI" },
        {}
      )
    ).toBe("Grammar checker — Free SEO Tool | Rext AI");
  });

  it("adds the brand after a title that names it only mid-way", () => {
    // Only a brand at the very end is a brand already said: a rext.ai post
    // naming it mid-way, served without it today, keeps its typed title.
    expect(
      fillPattern(
        "{Title} | {Site name}",
        {
          title: "Jasper vs Rext AI: which AI writing tool is worth it?",
          siteName: "Rext AI",
        },
        {}
      )
    ).toBe("Jasper vs Rext AI: which AI writing tool is worth it? | Rext AI");
  });

  it("drops only a last mark with nothing after it", () => {
    expect(
      fillPattern(
        "{Title} | {Site name}  ",
        { title: "Pricing | Acme", siteName: "Acme" },
        {}
      )
    ).toBe("Pricing | Acme");
    expect(
      fillPattern(
        "{Title} | {Site name} · {Site name}",
        { title: "Pricing | Acme", siteName: "Acme" },
        {}
      )
    ).toBe("Pricing | Acme | Acme");
  });
});
