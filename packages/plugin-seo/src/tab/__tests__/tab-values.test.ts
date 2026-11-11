/**
 * What the SEO tab works out on its own between answers from the server:
 * the page level from what a person typed, the problems an answer shows, and
 * whether a typed official address may be used.
 */
import { describe, expect, it } from "vitest";

import { resolveOrder, type Levels } from "../../resolver/order";
import { checkCanonical, storedCanonical } from "../canonical";
import { problemsBadge, seoProblems } from "../problems";
import { typedPageLevel, withoutTyped } from "../typed";

const none: Levels = {
  page: {},
  code: {},
  template: {},
  pattern: {},
  content: {},
  site: {},
};

describe("the page level from what a person typed", () => {
  it("reads each typed value under the name the order gives it", () => {
    expect(
      typedPageLevel({
        metaTitle: "Typed title",
        metaDescription: "Typed description",
        socialTitle: "Shared title",
        socialDescription: "Shared description",
        canonical: "https://example.com/elsewhere",
        noindex: true,
      })
    ).toEqual({
      title: "Typed title",
      description: "Typed description",
      socialTitle: "Shared title",
      socialDescription: "Shared description",
      canonical: "https://example.com/elsewhere",
      hidden: true,
    });
  });

  it("holds nothing for blank text, a cleared field or a switch left off", () => {
    expect(
      typedPageLevel({
        metaTitle: "  ",
        metaDescription: null,
        canonical: "",
        noindex: false,
      })
    ).toEqual({});
    expect(typedPageLevel(undefined)).toEqual({});
  });

  it("carries the chosen share image once it has an address", () => {
    const image = { url: "/media/share.jpg", width: 1200, height: 630 };
    expect(typedPageLevel({ ogImage: "m1" }, image)).toEqual({ image });
  });

  it("wins over every automatic level, as the page's head is answered", () => {
    const automatic: Levels = {
      ...none,
      pattern: { title: { value: "Post | Acme", pattern: "{Title} | Acme" } },
      content: { description: { value: "Excerpt", field: "excerpt" } },
    };
    const answer = resolveOrder({
      ...automatic,
      page: typedPageLevel({ metaTitle: "Typed" }),
    });
    expect(answer.title).toEqual({ value: "Typed", from: "page" });
    expect(answer.description).toMatchObject({ from: "content" });
    expect(answer.socialTitle).toEqual({ value: "Typed", from: "page" });
  });
});

describe("a document without what a person typed", () => {
  it("keeps every other field and the group's other values", () => {
    expect(
      withoutTyped({
        title: "Post",
        seo: { metaTitle: "Typed", noindex: true, focusKeyword: "kept" },
      })
    ).toEqual({ title: "Post", seo: { focusKeyword: "kept" } });
  });

  it("leaves a document with no group as it is", () => {
    expect(withoutTyped({ title: "Post" })).toEqual({ title: "Post" });
  });
});

describe("the problems an answer shows", () => {
  const title = (value: string) => ({ value, from: "content" as const });

  it("finds none in a page whose title and description fit", () => {
    expect(
      seoProblems({
        title: title("A".repeat(60)),
        description: title("B".repeat(160)),
        robots: { value: { index: true, follow: true }, from: "site" },
      })
    ).toEqual([]);
  });

  it("counts a title Google cuts short, and a description from no level", () => {
    const problems = seoProblems({
      title: title("A".repeat(61)),
      robots: { value: { index: true, follow: true }, from: "site" },
    });
    expect(problems.map(p => p.id)).toEqual([
      "title-too-long",
      "no-description",
    ]);
    expect(problemsBadge(problems)).toEqual({
      count: 2,
      label: "2 things to fix",
      tone: "attention",
    });
  });

  it("counts a missing title and a description Google cuts short", () => {
    const problems = seoProblems({
      description: title("B".repeat(161)),
      robots: { value: { index: true, follow: true }, from: "site" },
    });
    expect(problems.map(p => p.id)).toEqual([
      "no-title",
      "description-too-long",
    ]);
    expect(problemsBadge(problems.slice(0, 1))).toMatchObject({
      count: 1,
      label: "1 thing to fix",
    });
  });

  it("shows no count while there is nothing to fix", () => {
    expect(problemsBadge([])).toBeNull();
  });
});

describe("a typed official address", () => {
  const SITE = ["acme.com", "www.acme.com"];

  it.each([
    ["", { kind: "empty" }],
    ["   ", { kind: "empty" }],
    ["https://acme.com/blog/post", { kind: "same" }],
    ["https://www.acme.com/blog/post", { kind: "same" }],
    ["/blog/post", { kind: "same" }],
    [
      "https://news.example.org/post",
      { kind: "elsewhere", host: "news.example.org" },
    ],
  ] as const)("reads %j as %j", (typed, expected) => {
    expect(checkCanonical(typed, SITE)).toEqual(expected);
  });

  it.each([
    ["https://acme.com/a b", "An address can't contain spaces."],
    ["mailto:team@acme.com", "Only web addresses can be used here"],
    ["javascript:alert(1)", "Only web addresses can be used here"],
    ["acme.com/blog/post", "Enter the full address, starting with https://"],
    ["https://", "That isn't a complete web address"],
    ["https://acme/blog", "The address is missing the site's name"],
    ["https://me:secret@acme.com/post", "Remove the sign-in details"],
  ])("refuses %j, saying why", (typed, reason) => {
    const check = checkCanonical(typed, SITE);
    expect(check.kind).toBe("bad");
    expect(check.kind === "bad" ? check.message : "").toContain(reason);
  });

  it("accepts a host the site is served from although it has no dot", () => {
    expect(checkCanonical("http://localhost:3000/post", ["localhost"])).toEqual(
      { kind: "same" }
    );
  });

  it("is stored as typed on the site, and elsewhere only once confirmed", () => {
    expect(storedCanonical(" https://acme.com/post ", SITE, false)).toEqual({
      canonical: "https://acme.com/post",
      canonicalElsewhere: null,
    });
    // Not stored until confirmed, so neither the preview nor the page's
    // head uses it meanwhile.
    expect(storedCanonical("https://other.org/post", SITE, false)).toEqual({
      canonical: null,
      canonicalElsewhere: null,
    });
    expect(storedCanonical("https://other.org/post", SITE, true)).toEqual({
      canonical: "https://other.org/post",
      canonicalElsewhere: true,
    });
    // Confirming says nothing about an address on the site itself.
    expect(storedCanonical("https://acme.com/post", SITE, true)).toEqual({
      canonical: "https://acme.com/post",
      canonicalElsewhere: null,
    });
    expect(storedCanonical("mailto:a@b.c", SITE, true)).toEqual({
      canonical: null,
      canonicalElsewhere: null,
    });
    expect(storedCanonical("  ", SITE, true)).toEqual({
      canonical: null,
      canonicalElsewhere: null,
    });
  });
});
