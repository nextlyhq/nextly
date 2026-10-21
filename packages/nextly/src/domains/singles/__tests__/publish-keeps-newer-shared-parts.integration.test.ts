/**
 * A Single's components are compared with the base too: a component every
 * language shares is a shared value, and a component whose values are kept
 * per language belongs to its language and is never judged against another.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  text,
} from "../../../config";
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

const SLUG = "home";

async function boot(dialect: TestDialect): Promise<SingleEntryService> {
  current = await createTestNextly({
    dialect,
    fieldGroups: [
      defineFieldGroup({ slug: "hero", fields: [text({ name: "heading" })] }),
      defineFieldGroup({
        slug: "banner",
        localized: true,
        // Its words are per language; its code is shared by every language.
        fields: [
          text({ name: "words" }),
          text({ name: "code", localized: false }),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: SLUG,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [
          text({ name: "siteName" }),
          // Shared by every language.
          fieldGroup({ name: "hero", component: "hero" }),
          // Kept per language.
          fieldGroup({ name: "banner", component: "banner" }),
        ],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  return current.getService("singleEntryService");
}

function save(
  singles: SingleEntryService,
  locale: string,
  data: Record<string, unknown>
) {
  return singles.update(SLUG, data, { locale, overrideAccess: true });
}

async function heading(singles: SingleEntryService): Promise<unknown> {
  const res = await singles.get(SLUG, { locale: "en", overrideAccess: true });
  return (res.data as { hero?: { heading?: unknown } | null } | null)?.hero
    ?.heading;
}

/** Live in both languages, each with its own banner. */
async function live(singles: SingleEntryService): Promise<void> {
  expect(
    (
      await save(singles, "en", {
        siteName: "EN",
        hero: { heading: "first hero" },
        banner: { words: "EN banner" },
        status: "published",
      })
    ).success
  ).toBe(true);
  expect(
    (
      await save(singles, "es", {
        siteName: "ES",
        banner: { words: "ES banner" },
        status: "published",
      })
    ).success
  ).toBe(true);
}

describe.each(getConfiguredTestDialects())(
  "a Single's components on %s",
  dialect => {
    it("refuses English's older change after Spanish publishes a new shared hero, and keeps it", async () => {
      const singles = await boot(dialect);
      await live(singles);
      expect(
        (await save(singles, "en", { siteName: "EN edited" })).success
      ).toBe(true);
      expect(
        (await save(singles, "es", { hero: { heading: "new hero" } })).success
      ).toBe(true);
      expect((await save(singles, "es", { status: "published" })).success).toBe(
        true
      );

      const refused = await save(singles, "en", { status: "published" });

      expect(refused.statusCode).toBe(409);
      expect(refused.publicData).toEqual({ outOfDate: ["hero"] });
      expect(await heading(singles)).toBe("new hero");
    });

    it("publishes every language with a Spanish change, its banner judged as Spanish's own", async () => {
      // Spanish's change began from the Spanish document, banner included;
      // publishing every language reads the document in the default language.
      // A banner kept per language must not be compared across the two.
      const singles = await boot(dialect);
      await live(singles);
      expect(
        (await save(singles, "es", { siteName: "ES edited" })).success
      ).toBe(true);

      const published = await singles.publishAllLocales(SLUG, {
        overrideAccess: true,
      });

      expect(published.success).toBe(true);
      const es = await singles.get(SLUG, {
        locale: "es",
        overrideAccess: true,
      });
      expect((es.data as { siteName?: unknown }).siteName).toBe("ES edited");
    });

    it("refuses English's change after Spanish publishes a banner's shared code, and leaves it to copy by hand", async () => {
      const singles = await boot(dialect);
      await live(singles);
      expect(
        (await save(singles, "en", { siteName: "EN edited" })).success
      ).toBe(true);
      expect(
        (
          await save(singles, "es", {
            banner: { words: "ES banner", code: "new code" },
          })
        ).success
      ).toBe(true);
      expect((await save(singles, "es", { status: "published" })).success).toBe(
        true
      );

      const refused = await save(singles, "en", { status: "published" });
      expect(refused.statusCode).toBe(409);
      expect(refused.publicData).toEqual({ outOfDate: ["banner"] });

      // A take cannot match the banner's instances to English's safely, so it
      // says so rather than copying the Spanish banner over English's words.
      const taken = await singles.takeLiveSharedValues({
        slug: SLUG,
        locale: "en",
        overrideAccess: true,
      });
      expect(taken.data).toEqual({
        taken: [],
        outOfDate: ["banner"],
        copyByHand: {
          fields: ["banner"],
          reason:
            "This field is inside a translated component; copy its shared values by hand, then publish.",
        },
      });
    });
  }
);
