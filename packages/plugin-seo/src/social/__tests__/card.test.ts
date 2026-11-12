/**
 * A page's social card states everything a network reads from it: the site's
 * name, the page's language, and the image at an absolute address with its
 * size and alt text, including an image stored with a path from the root.
 */
import type {
  PageMetadataAnswer,
  PageMetadataResolver,
  PluginContext,
} from "@nextlyhq/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cardLocale,
  completeSocialCard,
  socialCardRulesFromOptions,
  withSocialCard,
} from "../card";

/** A plugin context on a site whose default language is `language`. */
const siteIn = (language: string) =>
  ({
    publicAddresses: { defaultLanguage: async () => language },
  }) as unknown as PluginContext;

const STORED = {
  url: "/uploads/2026/11/cover.jpg",
  width: 1200,
  height: 630,
  alt: "A harbour at dawn",
};

describe("a page's social card", () => {
  it("states an image stored with a path from the root on the site's origin, with its size and alt text", () => {
    const answer = completeSocialCard(
      { title: "Harbour", social: { image: STORED } },
      { locale: "en-US" },
      { origin: "https://example.com", siteName: "Acme" }
    );
    expect(answer.social).toEqual({
      image: {
        url: "https://example.com/uploads/2026/11/cover.jpg",
        width: 1200,
        height: 630,
        alt: "A harbour at dawn",
      },
      siteName: "Acme",
      locale: "en_US",
    });
  });

  it("keeps an image already at an absolute address where it is", () => {
    const answer = completeSocialCard(
      { social: { image: { url: "https://cdn.example.net/cover.jpg" } } },
      {},
      { origin: "https://example.com" }
    );
    expect(answer.social?.image?.url).toBe("https://cdn.example.net/cover.jpg");
  });

  it("states the image on the canonical's origin where the site's is not known", () => {
    const answer = completeSocialCard(
      {
        canonical: "https://fr.example.com/a-propos",
        social: { image: STORED },
      },
      {},
      {}
    );
    expect(answer.social?.image?.url).toBe(
      "https://fr.example.com/uploads/2026/11/cover.jpg"
    );
  });

  it("leaves a path from the root as it is where no origin is known", () => {
    const answer = completeSocialCard(
      { canonical: "/about", social: { image: STORED } },
      {},
      {}
    );
    expect(answer.social?.image?.url).toBe("/uploads/2026/11/cover.jpg");
  });

  it("states the language the page was read in, or else the site's", () => {
    expect(
      completeSocialCard({}, { locale: "pt-br" }, { language: "en-US" }).social
        ?.locale
    ).toBe("pt_BR");
    expect(
      completeSocialCard({}, {}, { language: "en-US" }).social?.locale
    ).toBe("en_US");
    expect(completeSocialCard({}, { locale: "fr" }, {}).social?.locale).toBe(
      "fr_FR"
    );
  });

  it("keeps the site's name the answer gives over the one the rules give", () => {
    const answer = completeSocialCard(
      { social: { siteName: "From settings" } },
      {},
      { siteName: "From options" }
    );
    expect(answer.social?.siteName).toBe("From settings");
  });

  it("adds no card to an answer that has nothing to put on one", () => {
    const answer: PageMetadataAnswer = { title: "T" };
    expect(completeSocialCard(answer, {}, {})).toBe(answer);
  });
});

describe("cardLocale", () => {
  it("reads a language tag as Open Graph writes it", () => {
    expect(cardLocale("en-US")).toBe("en_US");
    expect(cardLocale("en-GB")).toBe("en_GB");
    expect(cardLocale("zh-Hant-TW")).toBe("zh_TW");
  });

  it("gives a bare language the territory it is most often written for", () => {
    // Open Graph's og:locale is always language_TERRITORY; a site that names
    // only its language would otherwise state a locale crawlers do not read.
    expect(cardLocale("en")).toBe("en_US");
    expect(cardLocale("de")).toBe("de_DE");
    expect(cardLocale("pt")).toBe("pt_BR");
    expect(cardLocale("ja")).toBe("ja_JP");
  });

  it("reads text that is no language tag as no language", () => {
    expect(cardLocale("not a language")).toBeUndefined();
    expect(cardLocale("")).toBeUndefined();
    expect(cardLocale(undefined)).toBeUndefined();
  });
});

describe("socialCardRulesFromOptions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the site's origin from its production addresses where baseUrl is not set", async () => {
    vi.stubEnv(
      "NEXTLY_PRODUCTION_ADDRESSES",
      "https://www.example.com, https://fr.example.com"
    );
    const read = socialCardRulesFromOptions(undefined, {});
    expect((await read(siteIn("en"), undefined)).origin).toBe(
      "https://www.example.com"
    );
    // baseUrl, where it is set, is the site's own word for its origin.
    const set = socialCardRulesFromOptions("https://example.com", {});
    expect((await set(siteIn("en"), undefined)).origin).toBe(
      "https://example.com"
    );
  });

  it("states the site's default language where the options name none", async () => {
    const read = socialCardRulesFromOptions(undefined, {});
    expect((await read(siteIn("de-AT"), undefined)).language).toBe("de-AT");
    // The option names the language of a site that declares no languages,
    // whose default is otherwise English.
    const named = socialCardRulesFromOptions(undefined, { language: "fr-CA" });
    expect((await named(siteIn("en"), undefined)).language).toBe("fr-CA");
  });

  it("refuses a language that is no language tag when the plugin is created", () => {
    expect(() =>
      socialCardRulesFromOptions(undefined, { language: "english please" })
    ).toThrow(/not a language tag/);
  });

  it("reads the site's origin from baseUrl", async () => {
    const read = socialCardRulesFromOptions("https://example.com", {
      siteName: "Acme",
      language: "en-GB",
    });
    expect(await read(siteIn("en"), undefined)).toEqual({
      origin: "https://example.com",
      siteName: "Acme",
      language: "en-GB",
    });
  });
});

describe("withSocialCard", () => {
  it("completes every answer the resolver gives, and keeps its cache tags", async () => {
    const resolver: PageMetadataResolver = {
      tags: () => ["media"],
      resolve: () => ({ social: { image: STORED } }),
    };
    const card = withSocialCard(
      siteIn("en"),
      resolver,
      socialCardRulesFromOptions("https://example.com", { siteName: "Acme" })
    );
    const input = {
      source: { kind: "entry", collection: "posts", entry: {} },
      code: {},
      derived: {},
    } as const;
    expect(card.tags?.(input)).toEqual(["media"]);
    expect((await card.resolve(input)).social).toEqual({
      image: {
        ...STORED,
        url: "https://example.com/uploads/2026/11/cover.jpg",
      },
      siteName: "Acme",
      locale: "en_US",
    });
  });
});
