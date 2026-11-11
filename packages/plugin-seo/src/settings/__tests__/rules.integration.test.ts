/**
 * The SEO settings reach their readers on every configured dialect: what a
 * person saves in the SEO settings Single is what `readSeoRules` and
 * `readBrandFacts` answer, in every language of a translated site, with the
 * images it names read from the media library, and with nothing guessed
 * before anything is saved.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { definePlugin, type PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { seoPlugin } from "../../plugin";
import {
  readBrandFacts,
  readSeoRules,
  readStructuredDataSettings,
} from "../rules";
import { SEO_SETTINGS_SLUG } from "../contract";

/** A 1x1 PNG, the smallest file the media library accepts as an image. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/**
 * Where an upload lands, and the ignore file local storage writes beside it:
 * both under the package this suite runs in, taken down after the suite when
 * the suite made them.
 */
const UPLOADS = path.resolve("public");
const IGNORE = path.resolve(".gitignore");
const madeHere = { uploads: !existsSync(UPLOADS), ignore: !existsSync(IGNORE) };

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

afterAll(() => {
  if (madeHere.uploads) rmSync(UPLOADS, { recursive: true, force: true });
  if (madeHere.ignore) rmSync(IGNORE, { force: true });
});

describe.each(getConfiguredTestDialects())(
  "the SEO settings and their readers (%s)",
  (dialect: TestDialect) => {
    /**
     * An instance with the plugin on `seot_posts`, and the context a plugin
     * is handed, taken from a second plugin's `init` so the readers are
     * called exactly as the resolver calls them.
     */
    async function boot(languages?: string[]) {
      let context: PluginContext | undefined;
      current = await createTestNextly({
        dialect,
        ...(languages === undefined
          ? {}
          : {
              localization: { locales: languages, defaultLocale: languages[0] },
            }),
        collections: [
          defineCollection({
            slug: "seot_posts",
            fields: [text({ name: "title" })],
          }),
        ],
        plugins: [
          seoPlugin({ collections: ["seot_posts"] }),
          definePlugin({
            name: "@test/seo-settings-probe",
            version: "1.0.0",
            nextly: ">=0.0.0",
            init(ctx) {
              context = ctx;
            },
          }),
        ],
      });
      if (context === undefined) throw new Error("the probe was not started");
      return { t: current, ctx: context };
    }

    it("answers no rules before anything is saved, never a guessed value", async () => {
      const { ctx } = await boot();

      expect(await readSeoRules(ctx)).toEqual({
        productionAddresses: [],
        defaultPatterns: { title: "{Title} | {Site name}" },
        patterns: {},
        aiCrawlers: "all",
      });
      expect(await readBrandFacts(ctx)).toEqual({
        otherNames: [],
        profiles: [],
      });
    });

    it("answers what was saved, with the share image and logo read from the media library", async () => {
      const { t, ctx } = await boot();
      const image = await t.nextly.media.upload({
        file: {
          data: PNG,
          name: "seot-share.png",
          mimetype: "image/png",
          size: PNG.length,
        },
      });

      await t.nextly.updateSingle({
        slug: SEO_SETTINGS_SLUG,
        data: {
          _overwrite: true,
          siteName: "Rext AI",
          description: "Research and write SEO articles.",
          productionAddresses: ["https://rext.ai"],
          separator: "—",
          image: String(image.id),
          patterns: {
            seot_posts: { title: "{Title} — Blog — {Site name}" },
            "single:home": { description: "{Site name} home" },
          },
          brandName: "Rext AI",
          brandOtherNames: "Rext, Revnix",
          logo: String(image.id),
          socialProfiles: [
            {
              network: "LinkedIn",
              url: "https://www.linkedin.com/company/rext-ai",
            },
          ],
          siteKind: "company",
          aiCrawlers: "search",
        },
      });

      const rules = await readSeoRules(ctx);
      expect(rules).toEqual({
        siteName: "Rext AI",
        description: "Research and write SEO articles.",
        image: expect.objectContaining({
          url: expect.stringContaining("seot-share"),
          width: 1,
          height: 1,
        }),
        productionAddresses: ["https://rext.ai"],
        defaultPatterns: { title: "{Title} — {Site name}" },
        patterns: {
          seot_posts: { title: "{Title} — Blog — {Site name}" },
          "single:home": { description: "{Site name} home" },
        },
        aiCrawlers: "search",
      });

      expect(await readBrandFacts(ctx)).toEqual({
        name: "Rext AI",
        otherNames: ["Rext", "Revnix"],
        logo: expect.objectContaining({ url: rules.image?.url }),
        profiles: [
          {
            network: "LinkedIn",
            url: "https://www.linkedin.com/company/rext-ai",
          },
        ],
        siteKind: "company",
      });
    });

    it("refuses a production address that is not a bare origin, and keeps the one saved", async () => {
      const { t, ctx } = await boot();
      await t.nextly.updateSingle({
        slug: SEO_SETTINGS_SLUG,
        data: {
          _overwrite: true,
          productionAddresses: ["https://example.com"],
        },
      });

      await expect(
        t.nextly.updateSingle({
          slug: SEO_SETTINGS_SLUG,
          data: {
            _overwrite: true,
            productionAddresses: ["https://example.com/blog"],
          },
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

      expect((await readSeoRules(ctx)).productionAddresses).toEqual([
        "https://example.com",
      ]);
    });

    it("gives structured data the address, brand and each type's choice, and refuses a type not offered", async () => {
      const { t, ctx } = await boot();
      await t.nextly.updateSingle({
        slug: SEO_SETTINGS_SLUG,
        data: {
          _overwrite: true,
          siteName: "Rext AI",
          productionAddresses: ["https://rext.ai", "https://fr.rext.ai"],
          socialProfiles: [{ network: "X", url: "https://x.com/rextai" }],
          structuredData: { seot_posts: { type: "blogPosting" } },
        },
      });

      expect(await readStructuredDataSettings(ctx)).toEqual({
        origin: "https://rext.ai",
        siteName: "Rext AI",
        brand: {
          otherNames: [],
          profiles: [{ network: "X", url: "https://x.com/rextai" }],
        },
        types: { seot_posts: { type: "blogPosting" } },
      });
      await expect(
        t.nextly.updateSingle({
          slug: SEO_SETTINGS_SLUG,
          data: {
            _overwrite: true,
            structuredData: { seot_posts: { type: "recipe" } },
          },
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("boots on a translated site and answers the same settings in every language", async () => {
      const { t, ctx } = await boot(["en", "fr"]);
      await t.nextly.updateSingle({
        slug: SEO_SETTINGS_SLUG,
        data: {
          _overwrite: true,
          siteName: "Acme",
          productionAddresses: ["https://acme.com", "https://acme.fr"],
          patterns: { seot_posts: { title: "{Title} | {Site name}" } },
        },
      });

      const shared = {
        siteName: "Acme",
        productionAddresses: ["https://acme.com", "https://acme.fr"],
        patterns: { seot_posts: { title: "{Title} | {Site name}" } },
      };
      expect(await readSeoRules(ctx, "en")).toMatchObject(shared);
      expect(await readSeoRules(ctx, "fr")).toMatchObject(shared);
    });
  }
);
