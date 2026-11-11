/**
 * A translated field group placed directly in one that is not translated keeps its text per
 * language: each language reads back its own, and the outer field group's shared value is the same
 * in every language. A read that took the inner one from the wrong language, or stored it once for
 * all, reads back the other language's text. A freshly started instance stores it too.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { forgetCompanionReadiness } from "../../i18n/runtime/companion-readiness";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

type Outer = { tone?: string; badge?: { heading?: string } };

for (const dialect of getConfiguredTestDialects()) {
  describe(`a translated field group placed directly in an untranslated one — ${dialect}`, () => {
    it("reads each language's own text, under a value every language shares", async () => {
      current = await createTestNextly({
        dialect,
        fieldGroups: [
          defineFieldGroup({
            slug: "langbadge",
            localized: true,
            fields: [text({ name: "heading", localized: true })],
          }),
          defineFieldGroup({
            slug: "langouter",
            fields: [
              text({ name: "tone" }),
              fieldGroup({ name: "badge", component: "langbadge" }),
            ],
          }),
        ],
        collections: [
          defineCollection({
            slug: "langpages",
            localized: true,
            fields: [
              text({ name: "title", localized: true }),
              fieldGroup({ name: "panel", component: "langouter" }),
            ],
          }),
        ],
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
      const handler = current.getService(
        "collectionsHandler"
      ) as CollectionsHandler;
      const entries = handler.getEntryService();

      const created = await entries.createEntry(
        { collectionName: "langpages", overrideAccess: true, locale: "en" },
        { title: "Hello", panel: { tone: "warm", badge: { heading: "Hello" } } }
      );
      expect(created.success, JSON.stringify(created)).toBe(true);
      const entryId = (created.data as { id: string }).id;
      const spanish = await entries.updateEntry(
        {
          collectionName: "langpages",
          entryId,
          overrideAccess: true,
          locale: "es",
        },
        {
          panel: { tone: "warm", badge: { heading: "Hola" } },
          _overwrite: true,
        }
      );
      expect(spanish.success, JSON.stringify(spanish)).toBe(true);

      const read = async (locale: string): Promise<Outer | undefined> =>
        (
          (
            await handler.getEntry({
              collectionName: "langpages",
              entryId,
              overrideAccess: true,
              locale,
            })
          ).data as { panel?: Outer }
        ).panel;

      const english = await read("en");
      const spanishRead = await read("es");
      expect(english?.badge?.heading).toBe("Hello");
      expect(spanishRead?.badge?.heading).toBe("Hola");
      expect([english?.tone, spanishRead?.tone]).toEqual(["warm", "warm"]);
    });

    // A freshly started instance knows nothing yet about whose translations it can store. The
    // write learns it for every field group it reaches before its transaction opens, nested
    // ones included: inside the transaction it can only read what was learned, and a nested field
    // group it never asked about would have its other languages refused.
    it("stores another language at the nested level on an instance that has just started", async () => {
      current = await createTestNextly({
        dialect,
        fieldGroups: [
          defineFieldGroup({
            slug: "freshbadge",
            localized: true,
            fields: [text({ name: "heading", localized: true })],
          }),
          defineFieldGroup({
            slug: "freshouter",
            fields: [
              text({ name: "tone" }),
              fieldGroup({ name: "badge", component: "freshbadge" }),
            ],
          }),
        ],
        collections: [
          defineCollection({
            slug: "freshpages",
            localized: true,
            fields: [
              text({ name: "title", localized: true }),
              fieldGroup({ name: "panel", component: "freshouter" }),
            ],
          }),
        ],
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
      const handler = current.getService(
        "collectionsHandler"
      ) as CollectionsHandler;
      const entries = handler.getEntryService();
      const created = await entries.createEntry(
        { collectionName: "freshpages", overrideAccess: true, locale: "en" },
        { title: "Hello", panel: { tone: "warm", badge: { heading: "Hello" } } }
      );
      expect(created.success, JSON.stringify(created)).toBe(true);
      const entryId = (created.data as { id: string }).id;

      // What a fresh start knows: nothing.
      forgetCompanionReadiness(current.adapter);
      const spanish = await entries.updateEntry(
        {
          collectionName: "freshpages",
          entryId,
          overrideAccess: true,
          locale: "es",
        },
        {
          panel: { tone: "warm", badge: { heading: "Hola" } },
          _overwrite: true,
        }
      );
      expect(spanish.success, JSON.stringify(spanish)).toBe(true);

      const read = await handler.getEntry({
        collectionName: "freshpages",
        entryId,
        overrideAccess: true,
        locale: "es",
      });
      expect((read.data as { panel?: Outer }).panel?.badge?.heading).toBe(
        "Hola"
      );
    });
  });
}
