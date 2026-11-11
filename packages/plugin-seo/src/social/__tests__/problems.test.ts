/**
 * A share image networks crop or shrink is named, with where it is fixed,
 * and so is one whose address no network can load.
 */
import {
  NextlyError,
  type PageMetadataInput,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { socialCardRulesFromOptions } from "../card";
import { shareImageSizeProblem } from "../contract";
import { shareImageProblems } from "../problems";

vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk")>()),
  publicAddressOf: async () => ({ status: "resolved", path: "/blog/harbour" }),
  // The SEO settings as stored: a test that saves some sets them here.
  getCachedNextly: async () => ({ findSingle: async () => savedSettings }),
}));

/** The SEO settings a test has saved. */
let savedSettings: Record<string, unknown> = {};

/**
 * A plugin context whose media library holds `media`, on a site whose
 * address record names no holder.
 */
function context(media: Record<string, Record<string, unknown>>) {
  return {
    self: { collections: {} },
    config: {},
    publicAddresses: { defaultLanguage: async () => "en" },
    services: {
      ownCollections: { listEntries: async () => ({ data: [] }) },
      media: {
        findById: async (id: string) => {
          const found = media[id];
          if (found === undefined) throw NextlyError.notFound();
          return found;
        },
      },
    },
  } as unknown as PluginContext;
}

const LIBRARY = {
  small: {
    url: "/uploads/cover.jpg",
    width: 800,
    height: 600,
    altText: "Cover",
  },
  card: { url: "/uploads/card.jpg", width: 1200, height: 630 },
};

function post(
  entry: Record<string, unknown>,
  extra: Partial<PageMetadataInput> = {}
): PageMetadataInput {
  return {
    source: { kind: "entry", collection: "posts", entry },
    code: {},
    derived: {},
    ...extra,
  };
}

const AT_EXAMPLE = {
  readSocialCardRules: socialCardRulesFromOptions("https://example.com", {}),
};

describe("shareImageSizeProblem", () => {
  it("names a picture of the wrong shape as one LinkedIn crops", () => {
    expect(shareImageSizeProblem({ width: 800, height: 600 })).toBe(
      "800 × 600, LinkedIn will crop it"
    );
    expect(shareImageSizeProblem({ width: 2400, height: 1000 })).toBe(
      "2400 × 1000, LinkedIn will crop it"
    );
  });

  it("names a picture of the card's shape that is narrower than 1200 pixels", () => {
    expect(shareImageSizeProblem({ width: 600, height: 315 })).toBe(
      "600 × 315, smaller than the 1200 × 630 networks show in full"
    );
    expect(shareImageSizeProblem({ width: 1199, height: 630 })).toBe(
      "1199 × 630, smaller than the 1200 × 630 networks show in full"
    );
  });

  it("finds nothing wrong with a card-sized picture, or one twice the size", () => {
    expect(shareImageSizeProblem({ width: 1200, height: 630 })).toBeUndefined();
    expect(
      shareImageSizeProblem({ width: 2400, height: 1260 })
    ).toBeUndefined();
    // The shape's edges are inside: 1.8 and 2.0 times as wide as tall.
    expect(
      shareImageSizeProblem({ width: 1800, height: 1000 })
    ).toBeUndefined();
    expect(
      shareImageSizeProblem({ width: 2000, height: 1000 })
    ).toBeUndefined();
  });

  it("says nothing of a picture whose size is not known", () => {
    expect(shareImageSizeProblem({ width: 800 })).toBeUndefined();
    expect(shareImageSizeProblem({})).toBeUndefined();
  });
});

describe("shareImageProblems", () => {
  it("reads the site's default share image from the SEO settings when given no rules", async () => {
    savedSettings = { image: "small" };
    try {
      const problems = await shareImageProblems(
        context(LIBRARY),
        post({ title: "Harbour" })
      );
      expect(problems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ detail: "size", from: "site" }),
        ])
      );
    } finally {
      savedSettings = {};
    }
  });

  it("names a page's own undersized share image, fixed by making one", async () => {
    const problems = await shareImageProblems(
      context(LIBRARY),
      post({ title: "Harbour", seo: { ogImage: "small" } }),
      AT_EXAMPLE
    );
    expect(problems).toEqual([
      {
        detail: "size",
        message: "800 × 600, LinkedIn will crop it",
        fix: "make",
        from: "page",
      },
    ]);
  });

  it("names the field a share image taken from the page's content is read from", async () => {
    const problems = await shareImageProblems(
      context(LIBRARY),
      post({ title: "Harbour", coverImage: "small" }),
      AT_EXAMPLE
    );
    expect(problems).toEqual([
      expect.objectContaining({
        detail: "size",
        fix: "make",
        from: "content",
        field: "coverImage",
      }),
    ]);
  });

  it("sends a picture set by the route's code to the route, where it is fixed", async () => {
    const problems = await shareImageProblems(
      context(LIBRARY),
      post(
        { title: "Harbour" },
        {
          code: {
            image: {
              url: "https://cdn.example.net/a.jpg",
              width: 400,
              height: 400,
            },
          },
        }
      ),
      AT_EXAMPLE
    );
    expect(problems).toEqual([
      expect.objectContaining({ detail: "size", fix: "route", from: "code" }),
    ]);
  });

  it("finds nothing wrong with a card-sized image on a site whose address is known", async () => {
    expect(
      await shareImageProblems(
        context(LIBRARY),
        post({ title: "Harbour", seo: { ogImage: "card" } }),
        AT_EXAMPLE
      )
    ).toEqual([]);
  });

  it("names an image with a path from the root on a site whose address is not known", async () => {
    const problems = await shareImageProblems(
      context(LIBRARY),
      post({ title: "Harbour", seo: { ogImage: "card" } })
    );
    expect(problems).toEqual([
      expect.objectContaining({
        detail: "siteAddress",
        fix: "settings",
        from: "page",
      }),
    ]);
  });

  it("finds nothing wrong with a page that has no share image", async () => {
    expect(
      await shareImageProblems(
        context(LIBRARY),
        post({ title: "Harbour" }),
        AT_EXAMPLE
      )
    ).toEqual([]);
  });
});
