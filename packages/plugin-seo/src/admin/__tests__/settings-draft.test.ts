import { describe, expect, it } from "vitest";

import type { SeoContentType } from "../../settings/contract";
import {
  attentionItems,
  changesOf,
  isHidden,
  mappingOf,
  missingDetails,
  structuredTypeOf,
  withDetailField,
  withHidden,
  withStructuredType,
  draftOf,
  networkOf,
  rebasedDraft,
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
  plainTextCopies: true,
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
  mappableFields: [],
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
      hiddenTypes: [],
      structuredData: {},
      indexNow: false,
      llmsTxt: false,
      plainTextCopies: true,
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
      hiddenTypes: [],
      structuredData: {},
      indexNow: false,
      llmsTxt: false,
      plainTextCopies: false,
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
      { text: "No share image yet", fix: "Add a share image", tab: "images" },
    ]);
    expect(
      attentionItems({ ...withLogo, logo: null, image: "m2" }, [posts])
    ).toEqual([{ text: "No logo yet", fix: "Add a logo", tab: "brand" }]);
  });

  it("asks for no saved address where the server names one", () => {
    expect(
      attentionItems(
        { ...empty, logo: "m1", image: "m2" },
        [posts],
        ["https://acme.com"]
      )
    ).toEqual([]);
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

describe("hiding a whole content type", () => {
  const empty = { id: "s1", updatedAt: "" };

  it("shows the plugin's own hidden types until the site chooses, and saves the whole list once changed", () => {
    const draft = draftOf(empty, { hiddenTypes: ["tags"] });
    expect(isHidden(draft, "tags")).toBe(true);
    expect(changesOf(empty, draft, { hiddenTypes: ["tags"] })).toBeNull();

    const shown = withHidden(draft, "tags", false);
    const hidden = withHidden(shown, "posts", true);
    expect(changesOf(empty, hidden, { hiddenTypes: ["tags"] })).toEqual({
      hiddenTypes: ["posts"],
      _overwrite: true,
    });
  });
});

describe("a content type's structured data", () => {
  const withFields: SeoContentType = {
    ...posts,
    mappableFields: [
      { name: "byline", label: "Byline" },
      { name: "publishedAt", label: "Published at" },
      { name: "cover", label: "Cover" },
    ],
  };

  it("is automatic until a type is chosen, and saves the choice", () => {
    const draft = draftOf(stored);
    expect(structuredTypeOf(draft, "posts")).toBeUndefined();

    const chosen = withStructuredType(draft, "posts", "article");
    expect(structuredTypeOf(chosen, "posts")).toBe("article");
    expect(changesOf(stored, chosen)).toEqual({
      structuredData: { posts: { type: "article" } },
      _rev: "4",
    });
    expect(
      structuredTypeOf(withStructuredType(chosen, "posts", undefined), "posts")
    ).toBeUndefined();
  });

  it("names the details no field holds yet, counting a field named like one as holding it", () => {
    // `publishedAt` is named like the date published, so it is found; nothing
    // is named like the author. The image is the page's share image until a
    // field is chosen, so it is never missing.
    expect(missingDetails(draftOf(stored), withFields, "article")).toEqual([
      "author",
    ]);
  });

  it("finds a detail by name only among the entry's own fields, as the markup does", () => {
    const nested: SeoContentType = {
      ...posts,
      // Only the field inside the group: the group itself, named `start`,
      // would be found by its name as the markup finds it.
      mappableFields: [{ name: "start.date", label: "Start › Date" }],
    };
    // `start.date` reads like the start date, but the markup never looks
    // inside a group by itself, so the date is missing until it is chosen.
    expect(missingDetails(draftOf(stored), nested, "event")).toEqual([
      "startDate",
      "location",
    ]);
  });

  it("names a detail mapped to a field the type no longer has, keeping a path into one it has", () => {
    const stale = withDetailField(
      draftOf(stored),
      "posts",
      "article",
      "author",
      "removed"
    );
    expect(missingDetails(stale, withFields, "article")).toEqual(["author"]);
    const path = withDetailField(
      draftOf(stored),
      "posts",
      "article",
      "author",
      "byline.name"
    );
    expect(missingDetails(path, withFields, "article")).toEqual([]);
    // Inside a group whose fields are known, the path must be one of them.
    const event: SeoContentType = {
      ...posts,
      mappableFields: [
        { name: "event", label: "Event" },
        { name: "event.startsAt", label: "Event › Starts at" },
      ],
    };
    const renamed = withDetailField(
      draftOf(stored),
      "posts",
      "event",
      "startDate",
      "event.startedAt"
    );
    expect(missingDetails(renamed, event, "event")).toContain("startDate");
  });

  it("shows the plugin's own choice until the site chooses, and saves only what differs from it", () => {
    const defaults = {
      structuredData: {
        posts: {
          type: "article" as const,
          details: { article: { author: "byline" } },
        },
      },
    };
    const draft = draftOf(stored, defaults);
    expect(structuredTypeOf(draft, "posts")).toBe("article");
    expect(mappingOf(draft, "posts", "article")).toEqual({ author: "byline" });
    expect(changesOf(stored, draft, defaults)).toBeNull();

    // Another type's choice saves alone, leaving the plugin's in force.
    const other = withStructuredType(draft, "cases", "webPage");
    expect(changesOf(stored, other, defaults)).toEqual({
      structuredData: { cases: { type: "webPage" } },
      _rev: "4",
    });

    // A new type keeps the plugin's mapping, and Automatic over the
    // plugin's choice is saved, so the page's markup is automatic.
    const howTo = withStructuredType(draft, "posts", "blogPosting");
    expect(changesOf(stored, howTo, defaults)).toEqual({
      structuredData: {
        posts: {
          details: { article: { author: "byline" } },
          type: "blogPosting",
        },
      },
      _rev: "4",
    });
    const automatic = withStructuredType(
      withDetailField(draft, "posts", "article", "author", ""),
      "posts",
      undefined
    );
    expect(structuredTypeOf(automatic, "posts")).toBeUndefined();
    expect(changesOf(stored, automatic, defaults)).toEqual({
      structuredData: { posts: {} },
      _rev: "4",
    });
  });

  it("saves the field a detail is read from, and forgets it when unchosen", () => {
    const mapped = withDetailField(
      draftOf(stored),
      "posts",
      "article",
      "author",
      "byline"
    );
    expect(mappingOf(mapped, "posts", "article")).toEqual({ author: "byline" });
    expect(missingDetails(mapped, withFields, "article")).toEqual([]);
    expect(changesOf(stored, mapped)).toEqual({
      structuredData: { posts: { details: { article: { author: "byline" } } } },
      _rev: "4",
    });
    const unmapped = withDetailField(mapped, "posts", "article", "author", "");
    expect(mappingOf(unmapped, "posts", "article")).toEqual({});
  });
});

describe("a draft moved onto newer settings", () => {
  const before = draftOf({
    id: "s1",
    siteName: "Acme",
    description: "Old",
    patterns: { posts: { title: "{Title}" }, pages: { title: "{Title}" } },
    hiddenTypes: ["tags"],
  });

  it("keeps what was edited here and takes every other value as stored now", () => {
    const draft = {
      ...before,
      description: "Edited here",
      patterns: { ...before.patterns, posts: { title: "{Title} | Blog" } },
      hiddenTypes: ["tags", "authors"],
    };
    const after = draftOf({
      id: "s1",
      siteName: "Acme Ltd",
      description: "Old",
      patterns: {
        posts: { title: "{Title}" },
        pages: { title: "{Title} | Docs" },
      },
      hiddenTypes: ["tags", "cases"],
    });

    const rebased = rebasedDraft(draft, before, after);
    expect(rebased.siteName).toBe("Acme Ltd");
    expect(rebased.description).toBe("Edited here");
    // One type's pattern edited here, another's changed elsewhere: both kept.
    expect(rebased.patterns).toEqual({
      posts: { title: "{Title} | Blog" },
      pages: { title: "{Title} | Docs" },
    });
    expect(rebased.hiddenTypes).toEqual(["tags", "cases", "authors"]);
  });

  it("moves the addresses and profiles item by item, keeping one added elsewhere", () => {
    const listed = draftOf({
      id: "s1",
      productionAddresses: ["https://a.example"],
      socialProfiles: [{ network: "x", url: "https://x.com/acme" }],
    });
    // Here: the address replaced, a profile added.
    const draft = {
      ...listed,
      productionAddresses: ["https://b.example"],
      socialProfiles: [
        ...listed.socialProfiles,
        { network: "github", url: "https://github.com/acme" },
      ],
    };
    // Elsewhere meanwhile: an address and a profile added.
    const after = draftOf({
      id: "s1",
      productionAddresses: ["https://a.example", "https://c.example"],
      socialProfiles: [
        { network: "x", url: "https://x.com/acme" },
        { network: "linkedin", url: "https://linkedin.com/company/acme" },
      ],
    });

    const rebased = rebasedDraft(draft, listed, after);
    expect(rebased.productionAddresses).toEqual([
      "https://c.example",
      "https://b.example",
    ]);
    expect(rebased.socialProfiles).toEqual([
      { network: "x", url: "https://x.com/acme" },
      { network: "linkedin", url: "https://linkedin.com/company/acme" },
      { network: "github", url: "https://github.com/acme" },
    ]);
  });

  it("takes out a type's entry taken out here, and a hidden type shown again", () => {
    const { pages: _pages, ...rest } = before.patterns;
    const draft = { ...before, patterns: rest, hiddenTypes: [] };
    const rebased = rebasedDraft(draft, before, before);
    expect(rebased.patterns).toEqual({ posts: { title: "{Title}" } });
    expect(rebased.hiddenTypes).toEqual([]);
  });
});
