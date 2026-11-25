/**
 * A Single's first row splits a group's default by the group's shape read with the component it
 * places: a group whose only text is inside that component keeps its structure on the main row and
 * its default text as the default language's, as every save splits it.
 *
 * The plausible broken version: the default split by the group's own text alone, which a group
 * holding only a component has none of, so the whole default lands on the main row. A first save
 * in another language then splits by the component's shape, writes the structure without the
 * text, and the default language's text is gone.
 */
import { afterEach, expect, it } from "vitest";

import {
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  group,
  number,
  text,
} from "../../../config";
import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Written for per-language storage, as every installation now runs it.
perLanguageStorageSuite();

/** Booting a site takes most of the default timeout on MySQL alone. */
const BOOT_TIMEOUT = 90_000;

const CTA = defineFieldGroup({
  slug: "ctacard",
  fields: [text({ name: "label" }), number({ name: "size" })],
});

const PROMO = defineSingle({
  slug: "promo",
  fields: [
    text({ name: "heading" }),
    group({
      name: "hero",
      fields: [fieldGroup({ name: "card", component: "ctacard" })],
      // The group's own default, holding the component's text.
      defaultValue: { card: { label: "Buy now", size: 1 } },
    }),
  ],
});

describeEachDialect(
  "a Single's first row, a group placing a component",
  dialect => {
    let t: TestNextly | undefined;

    afterEach(async () => {
      await t?.destroy();
      t = undefined;
    }, BOOT_TIMEOUT);

    it(
      "keeps the component's default text as the default language's when another language saves first",
      async () => {
        t = await createTestNextly({
          dialect,
          singles: [PROMO],
          fieldGroups: [CTA],
          localization: { locales: ["en", "es"], defaultLocale: "en" },
        });
        const read = async (locale: string) =>
          (await t!.nextly.findSingle({ slug: "promo", locale })) as {
            hero?: { card?: { label?: string | null; size?: number | null } };
          };
        // The first read makes the row with its defaults.
        expect((await read("en")).hero?.card?.label).toBe("Buy now");

        await t.nextly.updateSingle({
          slug: "promo",
          locale: "es",
          data: {
            hero: { card: { label: "Comprar", size: 1 } },
            _overwrite: true,
          },
        });

        expect((await read("es")).hero?.card?.label).toBe("Comprar");
        expect((await read("en")).hero?.card?.label).toBe("Buy now");
      },
      BOOT_TIMEOUT
    );
  }
);
