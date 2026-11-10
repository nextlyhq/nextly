/**
 * A translated field group placed directly in one that is not translated keeps its text per
 * language: each language reads back its own, and the outer field group's shared value is the same
 * in every language. A read that took the inner one from the wrong language, or stored it once for
 * all, reads back the other language's text.
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
      const handler =
        current.getService<CollectionsHandler>("collectionsHandler");
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
  });
}
