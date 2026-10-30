// A publish of every language of a Single can be previewed, language by
// language, and the preview says what the publish then does.
//
// The preview and the publish read one verdict. The plausible broken
// implementations compute the preview alongside the publish, so the two drift
// (a pending change the preview says goes live and the publish leaves, a
// language it says shows its own content that reads the fallback), or name a
// field the caller may not read where the publish's refusal only counts it.

import { afterEach, describe, expect, it } from "vitest";

import { userWhoMay } from "../../../__tests__/fixtures/permission-holders";
import { defineSingle, number, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../services/single-entry-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "preferences";

async function boot(dialect: TestDialect): Promise<SingleEntryService> {
  current = await createTestNextly({
    dialect,
    singles: [
      defineSingle({
        slug: SLUG,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "siteName", localized: true }),
          // Shared by every language.
          text({ name: "tagline", localized: false }),
          // Shared, and no caller may read it.
          number({
            name: "internalScore",
            localized: false,
            access: { read: () => false, update: () => false },
          }),
        ],
      }),
    ],
    localization: { locales: ["en", "de", "fr", "es"], defaultLocale: "en" },
  });
  return current.getService("singleEntryService");
}

async function save(
  singles: SingleEntryService,
  locale: string,
  data: Record<string, unknown>
): Promise<void> {
  const saved = await singles.update(SLUG, data, {
    locale,
    overrideAccess: true,
  });
  expect(saved.success, JSON.stringify(saved)).toBe(true);
}

async function siteNameIn(
  singles: SingleEntryService,
  locale: string
): Promise<unknown> {
  const read = await singles.get(SLUG, { locale, overrideAccess: true });
  const doc = ((read as { data?: unknown }).data ?? read) as Record<
    string,
    unknown
  >;
  return doc.siteName;
}

describe.each(getConfiguredTestDialects())(
  "previewing a publish of every language of a Single (integration, %s)",
  dialect => {
    it("says what the publish does to each language, and the publish does it", async () => {
      const singles = await boot(dialect);
      await save(singles, "en", { siteName: "Hello", status: "published" });
      await save(singles, "de", { siteName: "Hallo", status: "published" });
      // English holds a pending change; French is saved and never published;
      // Spanish has nothing of its own.
      await save(singles, "en", { siteName: "Hello again" });
      await save(singles, "fr", { siteName: "Bonjour" });

      const preview = await singles.previewPublishAllLocales(SLUG, {
        overrideAccess: true,
      });
      expect(preview.success, JSON.stringify(preview)).toBe(true);
      expect(preview.data?.languages).toEqual([
        { locale: "en", outcome: "goes-live-with-pending-change" },
        { locale: "de", outcome: "stays-published" },
        { locale: "fr", outcome: "goes-live" },
        { locale: "es", outcome: "shows-fallback", fallback: "en" },
      ]);
      expect(preview.data?.blockers).toEqual([]);

      const published = await singles.publishAllLocales(SLUG, {
        overrideAccess: true,
      });
      expect(published.success, JSON.stringify(published)).toBe(true);
      expect(published.data?.languages).toEqual(preview.data?.languages);
      // And readers see what the preview said they would.
      expect(await siteNameIn(singles, "en")).toBe("Hello again");
      expect(await siteNameIn(singles, "de")).toBe("Hallo");
      expect(await siteNameIn(singles, "fr")).toBe("Bonjour");
      expect(await siteNameIn(singles, "es")).toBe("Hello again");
    });

    it("names the out-of-date fields the publish refuses over, and counts the ones the caller can't read", async () => {
      const singles = await boot(dialect);
      await save(singles, "en", {
        siteName: "Hello",
        tagline: "Old",
        internalScore: 1,
        status: "published",
      });
      await save(singles, "de", { siteName: "Hallo", status: "published" });
      // German's pending change begins from the live shared values...
      await save(singles, "de", { siteName: "Hallo wieder" });
      // ...and English then publishes new ones.
      await save(singles, "en", {
        tagline: "New",
        internalScore: 2,
        status: "published",
      });

      // A routed request: trusted, but answering to the caller's field read
      // rules, which no caller passes for the score.
      const options = { overrideAccess: true, routeAuthorized: true };
      const preview = await singles.previewPublishAllLocales(SLUG, options);
      expect(preview.success, JSON.stringify(preview)).toBe(true);
      const german = preview.data?.languages.find(
        language => language.locale === "de"
      );
      expect(german).toEqual({
        locale: "de",
        outcome: "out-of-date",
        fields: ["tagline"],
        hiddenCount: 1,
      });

      await expect(
        singles.publishAllLocales(SLUG, options)
      ).rejects.toMatchObject({
        statusCode: 409,
        publicData: {
          reason: "shared-fields-out-of-date",
          fields: ["tagline"],
          hiddenCount: 1,
        },
      });
    });

    it("tells only a caller who may publish what a publish would do", async () => {
      const singles = await boot(dialect);
      await save(singles, "en", { siteName: "Hello", status: "published" });
      await save(singles, "en", { siteName: "Hello again" });
      const reader = { id: "reader-1", email: "reader@x.test" };
      const publisher = { id: "publisher-1", email: "publisher@x.test" };
      await userWhoMay(current!, reader.id, "read", [SLUG]);
      await userWhoMay(current!, publisher.id, "publish", [SLUG]);

      const refused = await singles.previewPublishAllLocales(SLUG, {
        user: reader,
        overrideAccess: false,
      });
      expect(refused.statusCode).toBe(403);
      expect(refused.data).toBeUndefined();

      const told = await singles.previewPublishAllLocales(SLUG, {
        user: publisher,
        overrideAccess: false,
      });
      expect(told.success, JSON.stringify(told)).toBe(true);
      expect(told.data?.languages[0]).toEqual({
        locale: "en",
        outcome: "goes-live-with-pending-change",
      });
    });
  }
);
