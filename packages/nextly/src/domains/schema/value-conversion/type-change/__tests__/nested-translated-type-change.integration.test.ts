/**
 * A translated text inside a repeater or group changing type.
 *
 * A container keeping its text per language holds each language's text in its overlay column on
 * the translations table, beside its structure on the main table. A change of a text there to
 * another type judges the structure, which holds none of that text, and would leave each
 * language's text in the old form, hidden and then lost at that language's next write. Until the
 * overlays are converted too, the change is refused, naming the field and its container, and
 * nothing changes. A field there that keeps no text, and a text outside any container, are judged
 * as before.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { perLanguageStorageSuite } from "../../../../../__tests__/storage-layout";
import { resetSessionStandingForTests } from "../../../../../auth/session/session-standing";
import { dispatchCollections } from "../../../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../../services";

// As every installation lays tables out: a container keeps its text per language.
perLanguageStorageSuite();

const SLUG = "ntt_posts";
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };

// The group keeps another text throughout, so it still keeps text per language after the change,
// and a shared text (`code`), kept on the structure, whose change is judged as before.
const fieldsWith = (contactType: string, codeType = "text") => [
  { name: "heading", type: "text" },
  {
    name: "details",
    type: "group",
    fields: [
      { name: "contact", type: contactType },
      { name: "note", type: "text" },
      { name: "code", type: codeType, localized: false },
    ],
  },
];

let instance: TestNextly | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  resetSessionStandingForTests();
  await instance?.destroy();
  instance = undefined;
});

describe.each(getConfiguredTestDialects())(
  "a translated text inside a group changing type (%s)",
  dialect => {
    async function boot(): Promise<TestNextly> {
      const t = await createTestNextly({ dialect, localization: LOCALIZATION });
      instance = t;
      // As the Builder runs: each save is applied here.
      vi.stubEnv("NODE_ENV", "development");
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: SLUG,
          label: SLUG,
          localized: true,
          fields: fieldsWith("text"),
        }
      );
      await t.nextly.create({
        collection: SLUG,
        locale: "en",
        data: {
          heading: "h",
          details: { contact: "Call us", note: "Open daily", code: "C1" },
        },
      } as never);
      return t;
    }

    const save = (fields: unknown[]) =>
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: SLUG },
        { fields, confirmed: true, schemaVersion: 1, localized: true }
      );

    it("refuses it, naming the field and its container, and changes nothing", async () => {
      const t = await boot();

      await expect(save(fieldsWith("number"))).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "fields.details.contact",
              code: "TYPE_CHANGE_BLOCKED",
              message: expect.stringMatching(
                /details\.contact[\s\S]*details[\s\S]*not available yet/
              ),
            }),
          ],
        },
      });

      const [read] = (
        await t.nextly.find({ collection: SLUG, locale: "en" } as never)
      ).items as { details: { contact?: unknown } }[];
      expect(read?.details.contact).toBe("Call us");
    });

    // The control: a shared text there, kept on the structure, changes type as before.
    it("lets a shared text inside the group change type", async () => {
      await boot();
      await expect(save(fieldsWith("text", "textarea"))).resolves.toBeDefined();
    });
  }
);
