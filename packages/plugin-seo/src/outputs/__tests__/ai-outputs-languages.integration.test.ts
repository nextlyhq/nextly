/**
 * Plain-text copies on a site whose languages are served on domains of their
 * own, on every configured dialect: a copy asked for on a language's domain
 * is that language's page, listed on that domain, while the site's own
 * address stays the configured one for every other host.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text, type SanitizedNextlyConfig } from "nextly";
import { createNextlyProxy } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { lastCatchUp } from "../../address-record/catch-up";
import { seoPlugin } from "../../plugin";
import { SEO_SETTINGS_SLUG } from "../../settings/contract";

const SITE = "https://acme.example";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    seedPublic: true,
    localization: { locales: ["en", "de"], defaultLocale: "en" },
    languageAddresses: {
      by: "domain",
      domains: { en: SITE, de: "https://acme.de" },
    },
    plugins: [seoPlugin({ collections: ["pages"], baseUrl: SITE })],
    collections: [
      defineCollection({
        slug: "pages",
        localized: true,
        status: true,
        access: { read: () => true },
        fields: [
          text({ name: "slug", localized: true }),
          text({ name: "title", localized: true }),
        ],
        publicAddress: "/{slug}",
      }),
    ],
  });
  const t = current;
  const about = await t.nextly.create({
    collection: "pages",
    locale: "en",
    data: { slug: "about", title: "About us", status: "published" },
  });
  await t.nextly.update({
    collection: "pages",
    id: String(about.item.id),
    locale: "de",
    data: {
      slug: "ueber",
      title: "Über uns",
      status: "published",
      _overwrite: true,
    },
  });
  await t.nextly.updateSingle({
    slug: SEO_SETTINGS_SLUG,
    data: { _overwrite: true, plainTextCopies: true },
  });
  await lastCatchUp();
  return t;
}

/** The site's Proxy, as an app wires it. */
const proxy = createNextlyProxy({} as SanitizedNextlyConfig, {
  start: async () => undefined,
  next: () => () => new Response("the page", { status: 200 }),
});

async function ask(address: string) {
  const response = await proxy(new Request(address));
  return {
    link: response?.headers.get("link") ?? null,
    body: (await response?.text()) ?? "",
  };
}

describe.each(getConfiguredTestDialects())(
  "plain-text copies on languages' own domains (%s)",
  dialect => {
    it("serves a language's copy on its own domain, naming the page there", async () => {
      await boot(dialect);

      const german = await ask("https://acme.de/ueber.md");
      expect(german.body).toBe("# Über uns\n");
      expect(german.link).toBe('<https://acme.de/ueber>; rel="canonical"');

      const english = await ask(`${SITE}/about.md`);
      expect(english.body).toBe("# About us\n");
      expect(english.link).toBe(`<${SITE}/about>; rel="canonical"`);
    });
  }
);
