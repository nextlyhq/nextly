/**
 * How search results may show a page: the site's large-image default, each
 * page's own choices under Advanced, and the date after which it leaves
 * search, as the answer and the page's head carry them.
 */
import { describe, expect, it } from "vitest";

import { typedPageLevel } from "../../tab/typed";
import { typedDisplay } from "../display";
import { resolveOrder, type Levels } from "../order";
import { answerOf } from "../provider";

const none: Levels = {
  page: {},
  code: {},
  template: {},
  pattern: {},
  content: {},
  site: {},
};

const NOW = Date.parse("2026-11-13T12:00:00.000Z");

/** The robots a page with `seo` typed is served, on a site with `site`. */
function robotsOf(
  seo: Record<string, unknown>,
  site: Levels["site"] = {},
  levels: Partial<Levels> = {}
) {
  const answer = resolveOrder(
    { ...none, ...levels, page: typedPageLevel(seo), site },
    NOW
  );
  return answerOf(answer, {}).robots;
}

describe("what a page's seo group says about its display", () => {
  it("reads each control a person set", () => {
    expect(
      typedDisplay({
        maxImagePreview: "standard",
        maxSnippet: 80,
        nosnippet: true,
        noimageindex: true,
        unavailableAfter: "2026-12-31T23:59:00.000Z",
        noarchive: true,
        nocache: true,
      })
    ).toEqual({
      imagePreview: "standard",
      maxSnippet: 80,
      nosnippet: true,
      noimageindex: true,
      unavailableAfter: "2026-12-31T23:59:00.000Z",
      noarchive: true,
      nocache: true,
    });
  });

  it.each([
    ["a size Google has no name for", { maxImagePreview: "huge" }],
    ["a snippet of no characters", { maxSnippet: 0 }],
    ["a negative snippet length", { maxSnippet: -1 }],
    ["a fractional snippet length", { maxSnippet: 2.5 }],
    ["a date that names no moment", { unavailableAfter: "soon" }],
    ["switches stored as text", { nosnippet: "true", noarchive: "yes" }],
  ])("reads %s as nothing set", (_, seo) => {
    expect(typedDisplay(seo)).toEqual({});
  });
});

describe("large image previews", () => {
  it("are asked for on every indexable page by default", () => {
    expect(robotsOf({})).toEqual({
      index: true,
      follow: true,
      maxImagePreview: "large",
    });
  });

  it("are not asked for once the site turns its default off", () => {
    expect(robotsOf({}, { largeImagePreviews: false })).toEqual({
      index: true,
      follow: true,
    });
  });

  it.each(["standard", "none", "large"])(
    "give way to the page's own size, %s",
    size => {
      expect(
        robotsOf({ maxImagePreview: size }, { largeImagePreviews: false })
      ).toMatchObject({ maxImagePreview: size });
      expect(robotsOf({ maxImagePreview: size })).toMatchObject({
        maxImagePreview: size,
      });
    }
  );

  it("say whether the size is the page's own or the site's", () => {
    const own = resolveOrder(
      { ...none, page: typedPageLevel({ maxImagePreview: "none" }) },
      NOW
    );
    const automatic = resolveOrder(none, NOW);
    expect(own.display?.imagePreview).toEqual({ value: "none", from: "page" });
    expect(automatic.display?.imagePreview).toEqual({
      value: "large",
      from: "site",
    });
  });

  it("are not asked for on a page kept out of search", () => {
    expect(robotsOf({ noindex: true, maxImagePreview: "standard" })).toEqual({
      index: false,
      follow: true,
    });
    expect(robotsOf({}, {}, { typeHidden: true })).toEqual({
      index: false,
      follow: true,
    });
  });
});

describe("the text under the link", () => {
  it("is limited to the characters the page allows", () => {
    expect(robotsOf({ maxSnippet: 80 })).toMatchObject({ maxSnippet: 80 });
  });

  it("is stopped by no snippet, which leaves the length limit out", () => {
    const robots = robotsOf({ maxSnippet: 80, nosnippet: true });
    expect(robots).toMatchObject({ nosnippet: true });
    expect(robots).not.toHaveProperty("maxSnippet");
  });
});

describe("the page's images in image search", () => {
  it("are kept out with noimageindex", () => {
    expect(robotsOf({ noimageindex: true })).toMatchObject({
      noimageindex: true,
    });
  });
});

describe("a date to drop from search", () => {
  it("is served before it passes, with the page still listed", () => {
    const answer = resolveOrder(
      {
        ...none,
        page: typedPageLevel({ unavailableAfter: "2026-12-31T23:59:00.000Z" }),
      },
      NOW
    );
    expect(answer.robots.value.index).toBe(true);
    expect(answer.display?.unavailableAfter).toEqual({
      value: "2026-12-31T23:59:00.000Z",
      passed: false,
    });
    expect(answerOf(answer, {}).robots).toMatchObject({
      index: true,
      unavailableAfter: "2026-12-31T23:59:00.000Z",
    });
  });

  it("hides the page once it has passed, as the page's own choice", () => {
    const answer = resolveOrder(
      {
        ...none,
        page: typedPageLevel({ unavailableAfter: "2026-11-01T00:00:00.000Z" }),
      },
      NOW
    );
    expect(answer.robots).toEqual({
      value: { index: false, follow: true },
      from: "page",
    });
    expect(answer.display?.unavailableAfter?.passed).toBe(true);
    expect(answerOf(answer, {}).robots).toEqual({
      index: false,
      follow: true,
    });
  });

  it("passes at the moment it names", () => {
    const at = new Date(NOW).toISOString();
    const answer = resolveOrder(
      { ...none, page: typedPageLevel({ unavailableAfter: at }) },
      NOW
    );
    expect(answer.robots.value.index).toBe(false);
  });
});

describe("controls for other search engines", () => {
  it("are served only as their own switches", () => {
    expect(robotsOf({ noarchive: true })).toMatchObject({ noarchive: true });
    expect(robotsOf({ nocache: true })).toMatchObject({ nocache: true });
    expect(robotsOf({ noarchive: true })).not.toHaveProperty("nocache");
    expect(robotsOf({ nocache: true })).not.toHaveProperty("noarchive");
  });

  // Every other control, alone and in every combination, with the site's
  // default on and off: none of them turns either switch on.
  const others: Record<string, unknown>[] = [
    { maxImagePreview: "none" },
    { maxImagePreview: "standard" },
    { maxSnippet: 20 },
    { nosnippet: true },
    { noimageindex: true },
    { unavailableAfter: "2026-12-31T23:59:00.000Z" },
    { unavailableAfter: "2026-01-01T00:00:00.000Z" },
    { noindex: true },
  ];
  const combinations = Array.from(
    { length: 2 ** others.length },
    (_, mask) =>
      Object.assign(
        {},
        ...others.filter((__, bit) => (mask & (1 << bit)) !== 0)
      ) as Record<string, unknown>
  );
  it.each([true, false])(
    "are never set by any other setting (site default %s)",
    large => {
      for (const seo of combinations) {
        const robots = robotsOf(seo, { largeImagePreviews: large });
        expect(robots).not.toHaveProperty("noarchive");
        expect(robots).not.toHaveProperty("nocache");
      }
    }
  );
});
