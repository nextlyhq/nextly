/**
 * A save of a Single that names `status: "published"` alone, in a language that is live and holds a
 * pending change of its translated values only, puts that change live.
 *
 * Kept by part, that language's pending change holds no value of the Single's own row, so the
 * plausible broken implementation folds it into the save and is left with nothing to set on the
 * row: the database refuses the empty update and the publish fails with a 500.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, number, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../../singles/services/single-entry-service";

const SITE = "partversionsite";
let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

/** A translated Single with a shared `views`, keeping drafts by part. */
async function boot(dialect: TestDialect): Promise<SingleEntryService> {
  handle = await createTestNextly({
    dialect,
    perLanguageStorage: true,
    singles: [
      defineSingle({
        slug: SITE,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [text({ name: "title" }), number({ name: "views" })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  expect(handle.adapter.dialect).toBe(dialect);
  return handle.getService("singleEntryService");
}

/** What a reader of published content is served in `locale`. */
async function published(locale: string): Promise<Record<string, unknown>> {
  return (await handle!.nextly.findSingle({
    slug: SITE as never,
    locale,
    fallbackLocale: false,
  } as never)) as Record<string, unknown>;
}

describe.each(getConfiguredTestDialects())(
  "a Single's status save publishes a held translation (%s)",
  dialect => {
    it("puts a live language's pending translated change live by a save of its status alone", async () => {
      const singles = await boot(dialect);
      const save = async (locale: string, data: Record<string, unknown>) => {
        const saved = await singles.update(
          SITE,
          { ...data, _overwrite: true },
          { locale, overrideAccess: true }
        );
        expect(saved.success, JSON.stringify(saved)).toBe(true);
      };
      await save("en", { title: "en title", views: 10, status: "published" });
      await save("es", { title: "es title", status: "published" });
      // Spanish is live, so this is held as its pending change, of the title alone.
      await save("es", { title: "es 2" });
      expect((await published("es")).title).toBe("es title");

      await save("es", { status: "published" });

      expect(await published("es")).toMatchObject({
        title: "es 2",
        views: 10,
      });
      expect((await published("en")).title).toBe("en title");
    }, 90_000);
  }
);
