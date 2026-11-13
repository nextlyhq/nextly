/**
 * The verification codes on a running site: what is saved in the SEO
 * settings reaches the home page's head as one meta tag per service, a page
 * at any other address carries none, a save reaches the head without a
 * redeploy, and a code holding markup is refused where it is saved.
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
import { defineCollection, text } from "nextly";
import { afterEach, describe, expect, it } from "vitest";

import { seoMetadata } from "../../code-pages/metadata";
import { seoPlugin } from "../../plugin";
import { SEO_SETTINGS_SLUG } from "../../settings/contract";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run.
const POSTS = "seovc_posts";
const SITE = "https://acme.example";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe.each(getConfiguredTestDialects())(
  "verification codes (%s)",
  (dialect: TestDialect) => {
    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [seoPlugin({ collections: [POSTS], baseUrl: SITE })],
        collections: [
          defineCollection({
            slug: POSTS,
            fields: [text({ name: "title" })],
          }),
        ],
      });
      return current;
    }

    it("places nothing before a code is saved", async () => {
      await boot();
      expect((await seoMetadata("/")).verification).toBeUndefined();
    });

    it("places each saved code on the home page, and on no other", async () => {
      const t = await boot();
      // Read once first, so the save below must expire a cached head.
      expect((await seoMetadata("/")).verification).toBeUndefined();
      await t.nextly.updateSingle({
        slug: SEO_SETTINGS_SLUG,
        data: {
          _overwrite: true,
          verificationCodes: {
            bing: "8A2F61C4D0E9B7A35F0C19D2E6B4A7C9",
            pinterest: "a91c7e04b2d35f68",
            others: [
              { name: "facebook-domain-verification", code: "q3x9k2m8a7" },
            ],
          },
        },
      });

      expect((await seoMetadata("/")).verification).toEqual({
        other: {
          "msvalidate.01": "8A2F61C4D0E9B7A35F0C19D2E6B4A7C9",
          "p:domain_verify": "a91c7e04b2d35f68",
          "facebook-domain-verification": "q3x9k2m8a7",
        },
      });
      expect((await seoMetadata("/pricing")).verification).toBeUndefined();
    });

    it("refuses a code holding markup where it is saved", async () => {
      const t = await boot();
      await expect(
        t.nextly.updateSingle({
          slug: SEO_SETTINGS_SLUG,
          data: {
            _overwrite: true,
            verificationCodes: { google: '"><script>alert(1)</script>' },
          },
        })
      ).rejects.toThrow();
      expect((await seoMetadata("/")).verification).toBeUndefined();
    });

    it("refuses a name Nextly writes itself where it is saved", async () => {
      const t = await boot();
      await expect(
        t.nextly.updateSingle({
          slug: SEO_SETTINGS_SLUG,
          data: {
            _overwrite: true,
            verificationCodes: {
              others: [{ name: "robots", code: "noindex" }],
            },
          },
        })
      ).rejects.toThrow();
    });
  }
);
