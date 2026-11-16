/**
 * Each check one page is put through, with a page that passes it and one
 * that fails it.
 */
import { describe, expect, it } from "vitest";

import type { SeoAnswer } from "../../resolver/order";
import type { Problem } from "../contract";
import { canonicalIsOwn, pageProblems, type PageFacts } from "../page-checks";

const SUBJECT = {
  type: "posts",
  id: "7",
  label: "Harbour walk",
  detail: "/blog/harbour-walk",
};

/** A page with nothing wrong: every fact clean, every value present. */
function facts(over: Partial<PageFacts> = {}): PageFacts {
  return {
    subject: SUBJECT,
    answer: {
      title: { value: "Harbour walk", from: "content", field: "title" },
      description: { value: "A walk along the harbour.", from: "page" },
      image: {
        value: { url: "/c.jpg", width: 1200, height: 630 },
        from: "page",
      },
      canonical: { value: "/blog/harbour-walk", from: "address" },
      robots: { value: { index: true, follow: true }, from: "site" },
    },
    canonicalIsOwn: true,
    canonicalConfirmed: false,
    shareImage: [],
    structuredData: [],
    images: [],
    brokenLinks: [],
    languageCodes: [],
    ...over,
  };
}

function withAnswer(answer: Partial<SeoAnswer>): PageFacts {
  return facts({ answer: { ...facts().answer, ...answer } });
}

const kinds = (problems: Problem[]) => problems.map(p => p.kind);

describe("pageProblems", () => {
  it("reports nothing for a page with nothing wrong", () => {
    expect(pageProblems(facts())).toEqual([]);
  });

  it("reports a page left with no title or description after every level", () => {
    const problems = pageProblems(
      withAnswer({ title: undefined, description: undefined })
    );
    expect(kinds(problems)).toEqual(["noTitle", "noDescription"]);
    expect(problems[0]).toMatchObject({
      subject: SUBJECT,
      fix: { place: "page", tab: "seo", field: "metaTitle" },
    });
    expect(problems[1]?.fix).toEqual({
      place: "page",
      tab: "seo",
      field: "metaDescription",
    });
  });

  it("does not report an empty field whose value a lower level supplies", () => {
    // The page's own SEO title is empty; the pattern supplies one.
    const problems = pageProblems(
      withAnswer({
        title: {
          value: "Harbour walk | Example",
          from: "pattern",
          pattern: "{Title} | {Site name}",
        },
        description: { value: "From the site.", from: "site" },
      })
    );
    expect(problems).toEqual([]);
  });

  it("judges a title and description by how wide Google draws them, not by characters", () => {
    // 65 characters of narrow letters fit Google's 600 px, and 176 of a
    // narrow description fit its 920 px: a character count would flag both.
    const narrow = pageProblems(
      withAnswer({
        title: {
          value:
            "Little tips: fill it in, lift it, tilt it, till it is still. jilt",
          from: "page",
        },
        description: { value: "lilt it ".repeat(22), from: "page" },
      })
    );
    expect(narrow).toEqual([]);
    // 50 characters of wide capitals and 70 of "W" are cut: a character
    // count would pass both.
    const wide = pageProblems(
      withAnswer({
        title: {
          value: "WOMEN'S WORKWEAR MADE WELL: MEMBER OFFERS AND NEWS",
          from: "page",
        },
        description: { value: "W".repeat(70), from: "page" },
      })
    );
    expect(kinds(wide)).toEqual(["longTitle", "longDescription"]);
    // A warning with the width measured and the characters as a hint: the
    // value is saved and served.
    expect(wide[0]?.what).toBe("646 of 600 px · 50 characters");
    expect(wide[1]?.what).toBe("925 of 920 px · 70 characters");
  });

  it("reports a title one pixel past what Google shows, not at it", () => {
    // "i" draws 4.443 px: 135 of them are 600 px, 136 are 604.
    const at = pageProblems(
      withAnswer({ title: { value: "i".repeat(135), from: "page" } })
    );
    expect(at).toEqual([]);
    const past = pageProblems(
      withAnswer({ title: { value: "i".repeat(136), from: "page" } })
    );
    expect(kinds(past)).toEqual(["longTitle"]);
  });

  it("measures an emoji once, not as its two UTF-16 units", () => {
    // 30 emoji draw one em each, 600 px; counted per unit they would be 60.
    const problems = pageProblems(
      withAnswer({ title: { value: "😀".repeat(30), from: "page" } })
    );
    expect(problems).toEqual([]);
  });

  it("sends a title only the route's code sets to a developer", () => {
    const problems = pageProblems(
      withAnswer({ title: { value: "W".repeat(40), from: "code" } })
    );
    expect(problems[0]?.fix.place).toBe("developer");
  });

  it("reports a canonical a person typed that names another address", () => {
    const own = pageProblems(
      withAnswer({ canonical: { value: "/blog/harbour-walk/", from: "page" } })
    );
    expect(own).toEqual([]);
    const elsewhere = pageProblems({
      ...withAnswer({ canonical: { value: "/blog/other", from: "page" } }),
      canonicalIsOwn: false,
    });
    expect(kinds(elsewhere)).toEqual(["canonical"]);
    expect(elsewhere[0]?.what).toBe("Points search engines to /blog/other");
    expect(elsewhere[0]?.fix).toEqual({
      place: "page",
      tab: "seo",
      field: "canonical",
    });
  });

  it("reports no canonical a person confirmed, as the page first appeared elsewhere", () => {
    const confirmed = pageProblems({
      ...withAnswer({
        canonical: { value: "https://first.example/harbour", from: "page" },
      }),
      canonicalIsOwn: false,
      canonicalConfirmed: true,
    });
    expect(confirmed).toEqual([]);
  });

  it("reports a missing share image, and each share image problem with its fix", () => {
    const none = pageProblems(withAnswer({ image: undefined }));
    expect(kinds(none)).toEqual(["shareImage"]);
    expect(none[0]?.fix).toEqual({
      place: "page",
      tab: "seo",
      field: "ogImage",
    });

    const sized = pageProblems(
      facts({
        shareImage: [
          {
            detail: "size",
            message: "800 × 600, LinkedIn will crop it",
            fix: "make",
            from: "page",
          },
          {
            detail: "size",
            message: "800 × 600, LinkedIn will crop it",
            fix: "route",
            from: "code",
          },
          {
            detail: "siteAddress",
            message: "The share image has no full address",
            fix: "settings",
            from: "page",
          },
        ],
      })
    );
    expect(sized.map(p => [p.what, p.action, p.fix.place])).toEqual([
      ["800 × 600, LinkedIn will crop it", "Make a share image", "page"],
      [
        "800 × 600, LinkedIn will crop it",
        "Copy a note for a developer",
        "developer",
      ],
      ["The share image has no full address", "Set the address", "settings"],
    ]);
    // The site's missing address is the whole site's, not this page's.
    expect(sized.map(p => p.subject.label)).toEqual([
      "Harbour walk",
      "Harbour walk",
      "Whole site",
    ]);
  });

  it("reports structured data missing a detail, fixed where the detail is kept", () => {
    const problems = pageProblems(
      facts({
        structuredData: [
          {
            type: "blogPosting",
            detail: "author",
            message: "Missing: author.",
            fix: "content",
            field: "writer",
          },
          {
            type: "blogPosting",
            detail: "datePublished",
            message: "Missing: date published.",
            fix: "mapping",
          },
          {
            type: "blogPosting",
            detail: "siteAddress",
            message: "Missing: the site's address.",
            fix: "settings",
          },
        ],
      })
    );
    expect(problems.map(p => [p.kind, p.action, p.fix])).toEqual([
      [
        "structuredData",
        "Add the author",
        { place: "page", tab: "content", field: "writer" },
      ],
      [
        "structuredData",
        "Copy a note for a developer",
        {
          place: "developer",
          note: "/blog/harbour-walk: no field of posts holds the date published. Map one in seoPlugin({ structuredData: { types: { posts: { details } } } }).",
        },
      ],
      [
        "structuredData",
        "Set the address",
        { place: "settings", tab: "general" },
      ],
    ]);
    expect(problems[2]?.subject).toEqual({ label: "Whole site" });
  });

  it("reports images with no alt text, by field, and passes a decorative one", () => {
    const problems = pageProblems(
      facts({
        images: [
          { field: "body", name: "chart.png", media: false, alt: "" },
          { field: "body", name: "table.png", media: false, alt: undefined },
          {
            field: "body",
            name: "rule.png",
            media: false,
            alt: "",
            decorative: true,
          },
          { field: "body", name: "map.png", media: false, alt: "A map" },
          { field: "cover", name: "cover.jpg", media: true, alt: null },
        ],
      })
    );
    expect(problems.map(p => [p.what, p.fix])).toEqual([
      [
        "2 images: chart.png, table.png",
        { place: "page", tab: "content", field: "body" },
      ],
      ["1 image: cover.jpg", { place: "media" }],
    ]);
  });

  it("reports each broken internal link, fixed in the field holding it", () => {
    const problems = pageProblems(
      facts({ brokenLinks: [{ field: "body", url: "/blog/gone" }] })
    );
    expect(problems).toEqual([
      {
        kind: "brokenLink",
        subject: SUBJECT,
        what: "Links to /blog/gone, which is not found",
        action: "Edit the link",
        fix: { place: "page", tab: "content", field: "body" },
      },
    ]);
  });

  it("reports only what visitors meet on a page kept out of search on purpose", () => {
    const problems = pageProblems({
      ...withAnswer({
        title: undefined,
        description: undefined,
        image: undefined,
        canonical: { value: "/elsewhere", from: "page" },
        robots: { value: { index: false, follow: true }, from: "page" },
      }),
      structuredData: [
        {
          type: "blogPosting",
          detail: "author",
          message: "Missing: author.",
          fix: "content",
          field: "writer",
        },
      ],
      images: [{ field: "body", name: "chart.png", media: false, alt: "" }],
      brokenLinks: [{ field: "body", url: "/blog/gone" }],
    });
    expect(kinds(problems)).toEqual(["brokenLink", "imageAlt"]);
  });

  it("reports a page whose date to drop from search has passed, fixed on its SEO tab", () => {
    const problems = pageProblems(
      withAnswer({
        robots: { value: { index: false, follow: true }, from: "page" },
        display: {
          unavailableAfter: {
            value: "2026-11-01T00:00:00.000Z",
            passed: true,
          },
        },
      })
    );
    expect(problems).toEqual([
      {
        kind: "dropDatePassed",
        subject: SUBJECT,
        what: "Dropped from search after 2026-11-01 00:00 UTC",
        action: "Remove the date",
        fix: { place: "page", tab: "seo", field: "unavailableAfter" },
      },
    ]);
  });

  it("reports nothing for a date to drop from search still to come", () => {
    const problems = pageProblems(
      withAnswer({
        display: {
          unavailableAfter: {
            value: "2099-01-01T00:00:00.000Z",
            passed: false,
          },
        },
      })
    );
    expect(problems).toEqual([]);
  });

  it("reports a language left out of language links once, for the whole site", () => {
    const problems = pageProblems(
      facts({
        languageCodes: [
          {
            language: "klingon",
            detail: "code",
            message: '"klingon" is not a language code search engines accept.',
            fix: "settings",
          },
        ],
      })
    );
    expect(problems).toEqual([
      {
        kind: "languageCode",
        subject: { label: "Whole site" },
        what: '"klingon" is not a language code search engines accept.',
        action: "Copy a note for a developer",
        fix: {
          place: "developer",
          note: 'Give the language "klingon" a code search engines accept, such as "de" or "pt-BR", where the site\'s languages are set: localization in nextly.config.ts, or Settings.',
        },
      },
    ]);
  });
});

describe("canonicalIsOwn", () => {
  const listed = {
    value: { index: true, follow: true },
    from: "site",
  } as const;
  const typed = (value: string): SeoAnswer => ({
    canonical: { value, from: "page" },
    robots: listed,
  });

  it("takes a typed canonical naming the page's own address as its own", () => {
    expect(
      canonicalIsOwn(typed("/blog/same"), "https://example.com", "/blog/same")
    ).toBe(true);
    expect(
      canonicalIsOwn(
        typed("https://example.com/blog/caf%C3%A9"),
        "https://example.com",
        "/blog/café"
      )
    ).toBe(true);
  });

  it("keeps a language's own domain: the same path on another names elsewhere", () => {
    expect(
      canonicalIsOwn(
        typed("https://en.example.com/blog/same"),
        "https://en.example.com",
        "https://fr.example.com/blog/same"
      )
    ).toBe(false);
    expect(
      canonicalIsOwn(typed("/blog/other"), "https://example.com", "/blog/same")
    ).toBe(false);
  });
});

describe("a page robots.txt blocks", () => {
  const blocked = { line: 3, rule: "Disallow: /blog" };

  it("is a problem while a rule of the site's own keeps crawlers from it", () => {
    const problems = pageProblems(facts({ robotsBlock: blocked }));
    expect(problems).toEqual([
      {
        kind: "robotsBlocked",
        subject: SUBJECT,
        what: "Line 3 of your own robots.txt rules keeps crawlers away: Disallow: /blog",
        action: "Change your own rules",
        fix: { place: "settings", tab: "crawlers" },
      },
    ]);
  });

  it("is said of Nextly's own rule where that is the one blocking it", () => {
    const problems = pageProblems(
      facts({ robotsBlock: { rule: "Disallow: /admin$" } })
    );
    expect(problems[0]?.what).toBe(
      "Nextly's own robots.txt rule keeps crawlers away: Disallow: /admin$"
    );
  });

  it("is no problem on a page hidden from search, which robots.txt may block", () => {
    const hidden = facts({
      robotsBlock: blocked,
      answer: {
        ...facts().answer,
        robots: { value: { index: false, follow: true }, from: "page" },
      },
    });
    expect(kinds(pageProblems(hidden))).toEqual([]);
  });
});

describe("a page robots.txt blocks, whose canonical names another address", () => {
  it("is no sitemap conflict, since the sitemap leaves such a page out", () => {
    const problems = pageProblems(
      facts({
        robotsBlock: { line: 3, rule: "Disallow: /blog" },
        canonicalIsOwn: false,
        answer: {
          ...facts().answer,
          canonical: { value: "/original", from: "address" },
        },
      })
    );
    expect(kinds(problems)).not.toContain("robotsBlocked");
  });
});
