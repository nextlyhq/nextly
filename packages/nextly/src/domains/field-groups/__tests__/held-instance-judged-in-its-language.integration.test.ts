/**
 * A held save's field-group instance is judged in the language the save
 * names, in a collection with no languages of its own.
 *
 * The localized field group `lbadge` holds a translated container, `box`,
 * whose `kept` no update may change. Judging an update of a stored instance
 * puts a denied child back at what the container stores in the write's
 * language, and judges that. `kept` records each value it is judged on, so a
 * held save in Spanish shows the Spanish value, and one in the default
 * language, the control, shows the English.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantPublic } from "../../../__tests__/helpers/public-role";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  group,
  text,
} from "../../../config";
import { Nextly } from "../../../direct-api/nextly";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

type Doc = Record<string, unknown>;

describe.each(getConfiguredTestDialects())(
  "a held field-group instance, judged in its save's language (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let trusted: Nextly;
    /** A caller whose field rules are judged; the collection lets anyone write. */
    let checked: Nextly;
    /** Each value `kept` is judged on. */
    const judged: unknown[] = [];

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        // The boot's seeding, which makes the Public role `checked`, a caller
        // with no user, is judged by.
        seedPublic: true,
        localization: {
          locales: ["en", "es"],
          defaultLocale: "en",
          fallback: false,
        },
        fieldGroups: [
          defineFieldGroup({
            slug: "lbadge",
            localized: true,
            fields: [
              text({ name: "heading" }),
              // A translated container, held on the companion row and
              // written whole.
              group({
                name: "box",
                localized: true,
                fields: [
                  text({
                    name: "kept",
                    access: { update: false },
                    validate: (value: unknown) => {
                      judged.push(value);
                      return true;
                    },
                  }),
                ],
              }),
            ],
          }),
        ],
        collections: [
          defineCollection({
            // No languages of its own, and drafts, so an edit to a live entry
            // is held until published.
            slug: "lheld",
            status: true,
            versions: { drafts: true },
            access: {
              create: () => true,
              read: () => true,
              update: () => true,
            },
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "badge", component: "lbadge" }),
            ],
          }),
        ],
      } as never);
      trusted = new Nextly();
      checked = new Nextly({ overrideAccess: false });
      // The collection's rule only narrows the update permission, so Public
      // holds it: the field rules alone decide what `checked` may change.
      await grantPublic(t, ["update-lheld"]);
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
    });

    /**
     * A live entry whose instance's `kept` is "EN" in English and "ES" in
     * Spanish, and the instance's id.
     */
    async function liveInBothLanguages(): Promise<{
      id: string;
      badge: string;
    }> {
      const { item } = await trusted.create({
        collection: "lheld",
        data: {
          title: "Badge",
          status: "published",
          badge: { heading: "Hello", box: { kept: "EN" } },
        },
      } as never);
      const id = String(item.id);
      const read = (await trusted.findByID({
        collection: "lheld",
        id,
        depth: 1,
      } as never)) as Doc;
      const badge = String((read.badge as Doc).id);
      await trusted.update({
        collection: "lheld",
        id,
        locale: "es",
        data: {
          status: "published",
          badge: { id: badge, heading: "Hola", box: { kept: "ES" } },
          _overwrite: true,
        },
      } as never);
      return { id, badge };
    }

    /** What `kept` is judged on for a held save, by `checked`, in `locale`. */
    async function judgedOnHeldSave(locale?: string): Promise<unknown[]> {
      const { id, badge } = await liveInBothLanguages();
      judged.length = 0;
      await checked.update({
        collection: "lheld",
        id,
        ...(locale === undefined ? {} : { locale }),
        data: {
          badge: { id: badge, heading: "Held", box: { kept: "changed" } },
          _overwrite: true,
        },
      } as never);
      return [...new Set(judged)];
    }

    it("judges a denied child at the stored value in the save's language", async () => {
      const seen = await judgedOnHeldSave("es");
      expect(seen).toContain("ES");
      expect(seen).not.toContain("EN");
    });

    it("judges it at the default language's value when the save names none", async () => {
      // CONTROL: the same save, in the default language.
      const seen = await judgedOnHeldSave();
      expect(seen).toContain("EN");
      expect(seen).not.toContain("ES");
    });
  }
);
