/**
 * The published order of who wins: each value, field by field, from the
 * first level that has it, with the level that supplied it.
 */
import { describe, expect, it } from "vitest";

import { resolveOrder, type Levels } from "../order";

const none: Levels = {
  page: {},
  code: {},
  template: {},
  pattern: {},
  content: {},
  site: {},
};

const IMAGE = { url: "/media/cover.jpg", width: 1200, height: 630 };

describe("who wins, for the title", () => {
  const every: Levels = {
    page: { title: "Typed" },
    code: { title: "From code" },
    template: { title: "From the template" },
    pattern: { title: { value: "From the pattern", pattern: "{Title} | X" } },
    content: { title: { value: "From the content", field: "title" } },
    site: { title: "The site" },
  };
  // Each row takes the levels above it away, so the next one wins.
  it.each([
    ["page", "Typed", {}],
    ["code", "From code", { page: {} }],
    ["template", "From the template", { page: {}, code: {} }],
    ["pattern", "From the pattern", { page: {}, code: {}, template: {} }],
    [
      "content",
      "From the content",
      { page: {}, code: {}, template: {}, pattern: {} },
    ],
    [
      "site",
      "The site",
      { page: {}, code: {}, template: {}, pattern: {}, content: {} },
    ],
  ] as const)("%s wins when nothing above has one", (from, value, gone) => {
    const answer = resolveOrder({ ...every, ...gone });
    expect(answer.title).toMatchObject({ value, from });
  });

  it("is absent where no level has one, never empty", () => {
    expect(resolveOrder(none).title).toBeUndefined();
  });

  it("passes over a level whose value is blank", () => {
    const answer = resolveOrder({
      ...none,
      page: { title: "   " },
      code: { title: "" },
      content: { title: { value: "From the content", field: "title" } },
    });
    expect(answer.title).toEqual({
      value: "From the content",
      from: "content",
      field: "title",
    });
  });

  it("names the pattern a pattern value came from", () => {
    const answer = resolveOrder({
      ...none,
      pattern: {
        title: { value: "Hello | Acme", pattern: "{Title} | {Site name}" },
      },
    });
    expect(answer.title).toEqual({
      value: "Hello | Acme",
      from: "pattern",
      pattern: "{Title} | {Site name}",
    });
  });
});

describe("who wins, for the description", () => {
  it("goes page, code, template, pattern, content, site", () => {
    const full: Levels = {
      page: { description: "a" },
      code: { description: "b" },
      template: { description: "c" },
      pattern: { description: { value: "d", pattern: "{Excerpt}" } },
      content: { description: { value: "e", field: "excerpt" } },
      site: { description: "f" },
    };
    const order = ["page", "code", "template", "pattern", "content", "site"];
    const values = ["a", "b", "c", "d", "e", "f"];
    let levels: Levels = full;
    order.forEach((from, at) => {
      expect(resolveOrder(levels).description).toMatchObject({
        value: values[at],
        from,
      });
      levels = { ...levels, [from]: {} };
    });
  });
});

describe("the social card", () => {
  // The social text's own order: what a person typed for the card, then
  // what they typed for search, then the route's card, then the design's,
  // then the search value as the main order works it out. Each row takes
  // the candidates above it away, so the next one wins.
  describe.each([
    ["title", "socialTitle"],
    ["description", "socialDescription"],
  ] as const)("for the %s", (key, social) => {
    const every: Levels = {
      ...none,
      page: { [social]: "Typed for sharing", [key]: "Typed for search" },
      code: { [social]: "The route's card", [key]: "The route's own" },
      template: { [social]: "The design's card" },
      site: { [key]: "The site's" },
    };
    it.each([
      ["the card text a person typed", "Typed for sharing", "page", every],
      [
        "the search text a person typed",
        "Typed for search",
        "page",
        { ...every, page: { [key]: "Typed for search" } },
      ],
      [
        "the route's card text",
        "The route's card",
        "code",
        { ...every, page: {} },
      ],
      [
        "the design's card text",
        "The design's card",
        "template",
        { ...every, page: {}, code: { [key]: "The route's own" } },
      ],
      [
        "the search text as the order works it out",
        "The route's own",
        "code",
        {
          ...every,
          page: {},
          code: { [key]: "The route's own" },
          template: {},
        },
      ],
    ] as const)(
      "%s wins when nothing above has one",
      (_, value, from, levels) => {
        expect(resolveOrder(levels)[social]).toEqual({ value, from });
      }
    );
  });

  it("shows a typed title where the route copies its heading into the card", () => {
    const answer = resolveOrder({
      ...none,
      page: { title: "How we price our plans" },
      code: { title: "Blog", socialTitle: "Blog" },
    });
    expect(answer.socialTitle).toEqual({
      value: "How we price our plans",
      from: "page",
    });
  });

  it("keeps the route's own card text where nothing is typed for the page", () => {
    const answer = resolveOrder({
      ...none,
      code: { title: "Blog", socialTitle: "Read the Acme blog" },
      pattern: { title: { value: "Blog | Acme", pattern: "{Title} | X" } },
    });
    expect(answer.socialTitle).toEqual({
      value: "Read the Acme blog",
      from: "code",
    });
  });

  it("passes over blank typed text to the next candidate", () => {
    const answer = resolveOrder({
      ...none,
      page: { socialTitle: "  ", title: " " },
      code: { socialTitle: "The route's card" },
    });
    expect(answer.socialTitle).toEqual({
      value: "The route's card",
      from: "code",
    });
  });

  it("falls back to the page's title and description, with their source", () => {
    const answer = resolveOrder({
      ...none,
      code: { title: "From code", description: "Said in code" },
    });
    expect(answer.socialTitle).toEqual({ value: "From code", from: "code" });
    expect(answer.socialDescription).toEqual({
      value: "Said in code",
      from: "code",
    });
  });

  it("takes the image from the first level with one, down to the site's", () => {
    expect(resolveOrder({ ...none, site: { image: IMAGE } }).image).toEqual({
      value: IMAGE,
      from: "site",
    });
    expect(
      resolveOrder({
        ...none,
        content: { image: { value: IMAGE, field: "cover" } },
        site: { image: { url: "/site.jpg" } },
      }).image
    ).toEqual({ value: IMAGE, from: "content", field: "cover" });
    expect(
      resolveOrder({
        ...none,
        page: { image: { url: "/typed.jpg" } },
        code: { image: IMAGE },
      }).image
    ).toEqual({ value: { url: "/typed.jpg" }, from: "page" });
  });
});

describe("visibility and the canonical", () => {
  it("is listed unless the page is hidden", () => {
    expect(resolveOrder(none).robots).toEqual({
      value: { index: true, follow: true },
      from: "site",
    });
    expect(resolveOrder({ ...none, page: { hidden: true } }).robots).toEqual({
      value: { index: false, follow: true },
      from: "page",
    });
  });

  it("takes code's word on neither listing a page nor its canonical", () => {
    const answer = resolveOrder({
      ...none,
      code: { title: "From code" },
      address: "/about",
    });
    expect(answer.robots.from).toBe("site");
    expect(answer.canonical).toEqual({ value: "/about", from: "address" });
  });

  it("is hidden where the route's code hides the page, and code shows none a person hid", () => {
    expect(resolveOrder({ ...none, code: { hidden: true } }).robots).toEqual({
      value: { index: false, follow: true },
      from: "code",
    });
    // A person's own choice, or the type's, is named as the reason first.
    expect(
      resolveOrder({ ...none, page: { hidden: true }, code: { hidden: true } })
        .robots.from
    ).toBe("page");
    expect(
      resolveOrder({ ...none, code: { hidden: false }, page: { hidden: true } })
        .robots
    ).toEqual({ value: { index: false, follow: true }, from: "page" });
    expect(
      resolveOrder({ ...none, code: { hidden: true }, typeHidden: true }).robots
        .from
    ).toBe("type");
  });

  it("is the page's declared address, unless one is typed under Advanced", () => {
    expect(resolveOrder({ ...none, address: "/de/ueber" }).canonical).toEqual({
      value: "/de/ueber",
      from: "address",
    });
    expect(
      resolveOrder({
        ...none,
        page: {
          canonical: "https://elsewhere.example/original",
          canonicalElsewhere: true,
        },
        address: "/de/ueber",
      }).canonical
    ).toEqual({ value: "https://elsewhere.example/original", from: "page" });
  });

  it("has none where the page has no declared address", () => {
    expect(resolveOrder(none).canonical).toBeUndefined();
  });
});

describe("a hidden group of pages", () => {
  it("keeps every page in it hidden, whatever the page's own setting", () => {
    for (const page of [{}, { hidden: true }]) {
      expect(resolveOrder({ ...none, page, typeHidden: true }).robots).toEqual({
        value: { index: false, follow: true },
        from: "type",
      });
    }
  });

  it("returns each page to its own setting once shown again", () => {
    expect(
      resolveOrder({ ...none, page: { hidden: true }, typeHidden: false })
        .robots
    ).toEqual({ value: { index: false, follow: true }, from: "page" });
    expect(resolveOrder({ ...none, typeHidden: false }).robots).toEqual({
      value: { index: true, follow: true },
      from: "site",
    });
  });
});
