// A publish of every language whose translations table was dropped after
// boot is answered as not ready, with the repair to run, as a write of one
// language is: never as a server error.
//
// The plausible broken implementation remembers the table as ready from the
// boot, so the publish meets the missing table at its first statement on it
// and answers the driver's failure as an internal error, again on every
// retry.

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const ARTICLES = "gonearticles";
const BANNER = "gonebanner";

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: ARTICLES,
        localized: true,
        status: true,
        fields: [text({ name: "heading", localized: true })],
      }),
    ],
    singles: [
      defineSingle({
        slug: BANNER,
        localized: true,
        status: true,
        fields: [text({ name: "headline", localized: true })],
      }),
    ],
    localization: { locales: ["en", "fr"], defaultLocale: "en" },
  });
  return current;
}

describe.each(getConfiguredTestDialects())(
  "publishing every language once its translations table is dropped after boot (integration, %s)",
  dialect => {
    it("answers an entry's publish of every language as not ready", async () => {
      const t = await boot(dialect);
      const entries = (
        t.getService("collectionsHandler") as CollectionsHandler
      ).getEntryService() as CollectionEntryService;
      const created = await entries.createEntry(
        { collectionName: ARTICLES, overrideAccess: true, locale: "en" },
        { heading: "en", status: "draft" }
      );
      const id = (created.data as { id: string }).id;
      // Dropped once the boot has resolved the table as ready, as a tool
      // outside the app drops it while the app runs.
      await t.adapter.executeQuery(
        `DROP TABLE IF EXISTS dc_${ARTICLES}_locales`
      );
      const publishEvery = () =>
        entries.publishAllLocales({
          collectionName: ARTICLES,
          entryId: id,
          overrideAccess: true,
          data: { _overwrite: true },
        });

      const first = await publishEvery();
      expect(first.success).toBe(false);
      expect(first.statusCode).toBe(409);
      expect((await publishEvery()).statusCode).toBe(409);
    });

    it("answers a Single's publish of every language as not ready", async () => {
      const t = await boot(dialect);
      const singles = t.getService("singleEntryService");
      await singles.update(
        BANNER,
        { headline: "en", _overwrite: true },
        { locale: "en", overrideAccess: true }
      );
      await t.adapter.executeQuery(
        `DROP TABLE IF EXISTS single_${BANNER}_locales`
      );
      const publishEvery = () =>
        singles.publishAllLocales(BANNER, {
          overrideAccess: true,
          data: { _overwrite: true },
        });

      await expect(publishEvery()).rejects.toMatchObject({ statusCode: 409 });
      await expect(publishEvery()).rejects.toMatchObject({ statusCode: 409 });
    });
  }
);
