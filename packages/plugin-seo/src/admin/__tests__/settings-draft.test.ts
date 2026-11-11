import { describe, expect, it } from "vitest";

import type { SeoContentType } from "../../settings/contract";
import {
  attentionItems,
  changesOf,
  draftOf,
  networkOf,
  patternOf,
  patternProblem,
  previewOf,
  withSeparator,
  type SettingsDraft,
} from "../settings-draft";

const stored = {
  id: "s1",
  updatedAt: "2026-11-11T00:00:00.000Z",
  _rev: "4",
  siteName: "Rext AI",
  productionAddresses: ["https://rext.ai"],
  separator: "|",
  description: "Research and write SEO articles.",
  image: { id: "m1", url: "/share.jpg" },
  siteKind: "company",
  aiCrawlers: "search",
  brandName: "Rext AI",
  brandOtherNames: "Rext, Revnix",
  logo: "m2",
  socialProfiles: [
    { network: "LinkedIn", url: "https://www.linkedin.com/company/rext-ai" },
  ],
  patterns: { posts: { title: "{Title} | {Site name}" } },
  setupStep: 1,
  setupDismissed: false,
};

const posts: SeoContentType = {
  key: "posts",
  label: "Blog posts",
  fields: [{ name: "category", token: "Category" }],
  example: {
    title: "Surfer SEO vs Rext AI",
    values: { category: "Comparisons" },
  },
  public: true,
};

describe("the form's values, from the stored settings", () => {
  it("reads every value, a media value by its id", () => {
    expect(draftOf(stored)).toEqual({
      siteName: "Rext AI",
      productionAddresses: ["https://rext.ai"],
      separator: "|",
      description: "Research and write SEO articles.",
      image: "m1",
      siteKind: "company",
      aiCrawlers: "search",
      brandName: "Rext AI",
      brandOtherNames: "Rext, Revnix",
      logo: "m2",
      socialProfiles: [
        {
          network: "LinkedIn",
          url: "https://www.linkedin.com/company/rext-ai",
        },
      ],
      patterns: { posts: { title: "{Title} | {Site name}" } },
      setupStep: 1,
      setupDismissed: false,
    });
  });

  it("starts empty on a site that has saved nothing", () => {
    expect(draftOf({ id: "s1", updatedAt: "" })).toEqual({
      siteName: "",
      productionAddresses: [],
      separator: "|",
      description: "",
      image: null,
      siteKind: null,
      aiCrawlers: "all",
      brandName: "",
      brandOtherNames: "",
      logo: null,
      socialProfiles: [],
      patterns: {},
      setupStep: 0,
      setupDismissed: false,
    });
  });
});

describe("the AI tools choice before the site has made one", () => {
  const empty = { id: "s1", updatedAt: "" };

  it("shows the plugin's own choice, and saves nothing while it stands", () => {
    const draft = draftOf(empty, { aiCrawlers: "block" });
    expect(draft.aiCrawlers).toBe("block");
    expect(changesOf(empty, draft, { aiCrawlers: "block" })).toBeNull();
  });

  it("saves allowing all once a person picks it over the plugin's choice", () => {
    const draft = {
      ...draftOf(empty, { aiCrawlers: "block" }),
      aiCrawlers: "all" as const,
    };
    expect(changesOf(empty, draft, { aiCrawlers: "block" })).toEqual({
      aiCrawlers: "all",
      _overwrite: true,
    });
  });
});

describe("what a save sends", () => {
  it("sends only what changed, with the version it was read at", () => {
    const draft: SettingsDraft = { ...draftOf(stored), siteName: "Rext" };
    expect(changesOf(stored, draft)).toEqual({ siteName: "Rext", _rev: "4" });
  });

  it("sends nothing when nothing changed", () => {
    expect(changesOf(stored, draftOf(stored))).toBeNull();
  });

  it("drops blank addresses and profiles rather than storing them", () => {
    const draft: SettingsDraft = {
      ...draftOf(stored),
      productionAddresses: ["https://rext.ai", "  "],
      socialProfiles: [
        ...draftOf(stored).socialProfiles,
        { network: "", url: "" },
      ],
    };
    expect(changesOf(stored, draft)).toBeNull();
  });

  it("replaces a document never saved, which has no version to send", () => {
    const empty = { id: "s1", updatedAt: "" };
    expect(changesOf(empty, { ...draftOf(empty), siteName: "Acme" })).toEqual({
      siteName: "Acme",
      _overwrite: true,
    });
  });
});

describe("a content type's title pattern", () => {
  it("is its own, else the site's default with the site's separator", () => {
    const draft = draftOf(stored);
    expect(patternOf(draft, "posts")).toEqual({
      pattern: "{Title} | {Site name}",
      own: true,
    });
    expect(patternOf({ ...draft, separator: "—" }, "pages")).toEqual({
      pattern: "{Title} — {Site name}",
      own: false,
    });
  });

  it("previews with the type's newest page, as the head will show it", () => {
    expect(
      previewOf("{Title} · {Category} | {Site name}", posts, "Rext AI")
    ).toEqual({
      title: "Surfer SEO vs Rext AI · Comparisons | Rext AI",
      gaveWay: false,
    });
    // The brand is not added twice, by the same function the head uses.
    expect(
      previewOf(
        "{Title} | {Site name}",
        { ...posts, example: { title: "Pricing | Rext AI", values: {} } },
        "Rext AI"
      )
    ).toEqual({ title: "Pricing | Rext AI", gaveWay: false });
  });

  it("shows the page's own title where the page leaves a variable empty, as the head does", () => {
    expect(
      previewOf(
        "{Title} | {Category}",
        { ...posts, example: { title: "Hello", values: {} } },
        "Rext AI"
      )
    ).toEqual({ title: "Hello", gaveWay: true });
    // With no site name saved yet, `{Site name}` gives way the same.
    expect(previewOf("{Title} | {Site name}", posts, "")).toEqual({
      title: "Surfer SEO vs Rext AI",
      gaveWay: true,
    });
  });

  it("previews a type with no page yet with its variables' own names", () => {
    expect(
      previewOf(
        "{Title} · {Category} | {Site name}",
        { ...posts, example: undefined },
        "Rext AI"
      )
    ).toEqual({ title: "Page title · Category | Rext AI", gaveWay: false });
  });

  it("names a variable the type has no field for", () => {
    expect(patternProblem("{Title} by {Author}", posts)).toBe(
      "Blog posts have no field called Author. Click a variable below to add one."
    );
    expect(patternProblem("{Title} | {Site name}", posts)).toBeNull();
    expect(patternProblem("   ", posts)).toBe(
      "Write a pattern, or reset it to the default."
    );
  });
});

describe("changing the separator", () => {
  it("changes every pattern that uses the old one", () => {
    const draft: SettingsDraft = {
      ...draftOf(stored),
      patterns: {
        posts: { title: "{Title} | Blog | {Site name}" },
        pages: { title: "{Site name}: {Title}" },
      },
    };
    expect(withSeparator(draft, "·").patterns).toEqual({
      posts: { title: "{Title} · Blog · {Site name}" },
      pages: { title: "{Site name}: {Title}" },
    });
    expect(withSeparator(draft, "·").separator).toBe("·");
  });
});

describe("a social profile's network", () => {
  it.each([
    ["https://www.linkedin.com/company/rext-ai", "LinkedIn"],
    ["https://x.com/rextai", "X"],
    ["https://twitter.com/rextai", "X"],
    ["https://www.youtube.com/@rextai", "YouTube"],
    ["https://github.com/nextlyhq", "GitHub"],
    ["https://bsky.app/profile/nextly", "Bluesky"],
    ["https://example.social/@me", "example.social"],
    ["not an address", ""],
  ])("is read from %s", (url, network) => {
    expect(networkOf(url)).toBe(network);
  });
});

describe("what setup ends on", () => {
  const empty = draftOf({ id: "s1", updatedAt: "" });

  it("names a missing address, each type with no address, and missing images", () => {
    expect(
      attentionItems(empty, [
        posts,
        { ...posts, key: "cases", label: "Case studies", public: false },
      ])
    ).toEqual([
      {
        text: "No production address is saved",
        fix: "Set the address",
        tab: "general",
      },
      {
        text: "Case studies have no public address",
        fix: "See content types",
        tab: "types",
      },
      { text: "No logo or share image yet", fix: "Add a logo", tab: "brand" },
    ]);
  });

  it("names only the image still missing", () => {
    const withLogo = {
      ...empty,
      productionAddresses: ["https://acme.com"],
      logo: "m1",
    };
    expect(attentionItems(withLogo, [posts])).toEqual([
      { text: "No share image yet", fix: "Add a share image", tab: "general" },
    ]);
    expect(
      attentionItems({ ...withLogo, logo: null, image: "m2" }, [posts])
    ).toEqual([{ text: "No logo yet", fix: "Add a logo", tab: "brand" }]);
  });

  it("is empty for a site with everything set", () => {
    expect(
      attentionItems(
        {
          ...empty,
          productionAddresses: ["https://acme.com"],
          logo: "m1",
          image: "m2",
        },
        [posts]
      )
    ).toEqual([]);
  });
});
