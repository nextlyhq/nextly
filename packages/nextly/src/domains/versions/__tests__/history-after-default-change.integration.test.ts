/**
 * The history of a document that is not translated, after the site's default language moves.
 *
 * Such a document's saves that carry field-group content are recorded under the default language
 * of the moment, so a site that makes French the default still holds English versions. While
 * English is one of the site's languages they stay in the document's history, each one still put
 * to the document's read rules in its language, and restoring one is a save of the document like
 * any other: judged by its update rule, and written as the document's one set of values.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import {
  getVersionForDocument,
  listVersionsForDocument,
} from "../../../dispatcher/handlers/versions-methods";
import type { LanguageSettingsService } from "../../i18n/services/language-settings-service";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { NextlyError } from "../../../errors/nextly-error";
import type { AccessRuleContext } from "../../../shared/types/access";
import { restoreVersion } from "../restore-version";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const READER = { id: "reader", email: "reader@x.test" };

type Rule = (ctx: AccessRuleContext) => boolean;

/**
 * A site whose languages are stored, English and French, holding one post saved twice in
 * English, its field-group content included; then French is made the default.
 */
async function postSavedInEnglishThenFrenchDefault(
  dialect: TestDialect,
  rules: {
    read?: Rule;
    update?: Rule;
    titleUpdate?: () => boolean;
    /** The banner's text translated, so each language's read carries its own. */
    translatedBanner?: boolean;
    afterRead?: (args: { data?: unknown; user?: unknown }) => unknown;
  } = {}
) {
  current = await createTestNextly({
    dialect,
    fieldGroups: [
      defineFieldGroup({
        slug: "banner",
        ...(rules.translatedBanner ? { localized: true } : {}),
        fields: [text({ name: "heading" })],
      }),
    ],
    collections: [
      defineCollection({
        slug: "posts",
        versions: true,
        ...(rules.afterRead ? { hooks: { afterRead: [rules.afterRead] } } : {}),
        access: {
          read: rules.read ?? (() => true),
          update: rules.update ?? (() => true),
          create: () => true,
        },
        fields: [
          text({
            name: "title",
            ...(rules.titleUpdate
              ? { access: { update: rules.titleUpdate } }
              : {}),
          }),
          fieldGroup({ name: "banner", component: "banner" }),
        ],
      }),
    ],
  });
  const settings = current.getService(
    "languageSettingsService"
  ) as unknown as LanguageSettingsService;
  await settings.change({ kind: "add", code: "fr", label: "French" });

  const handler = current.getService("collectionsHandler");
  const created = await handler.createEntry(
    { collectionName: "posts", overrideAccess: true },
    { title: "T1", banner: { heading: "H1" } }
  );
  const entryId = (created.data as { id: string }).id;
  await handler.updateEntry(
    { collectionName: "posts", entryId, overrideAccess: true },
    { title: "T2", banner: { heading: "H2" } }
  );
  const at = { scopeKind: "collection" as const, slug: "posts", entryId };
  // Every version recorded, read from the store rather than through a reader's history.
  const before = {
    items: await current
      .getService("versionsService")
      .list({ scopeKind: "collection", scopeSlug: "posts", entryId })
      // Durable versions only: a working draft has no number.
      .then(rows =>
        rows.flatMap(v =>
          v.versionNo === null ? [] : [{ ...v, versionNo: v.versionNo }]
        )
      ),
  };

  await settings.change({ kind: "setDefault", code: "fr" });
  return { at, before, handler };
}

describe.each(getConfiguredTestDialects())(
  "the history of an untranslated document after the default language moves (integration, %s)",
  dialect => {
    it("still lists and reads its English versions once French is the default", async () => {
      const { at, before } = await postSavedInEnglishThenFrenchDefault(dialect);
      const english = before.items.filter(v => v.locale === "en");
      // The premise: saves carrying field-group content were recorded in English.
      expect(english.length).toBeGreaterThan(0);

      const after = await listVersionsForDocument({ ...at, user: READER });

      expect(after.items.map(v => v.versionNo)).toEqual(
        expect.arrayContaining(english.map(v => v.versionNo))
      );
      const read = await getVersionForDocument({
        ...at,
        user: READER,
        versionNo: english[0].versionNo,
      });
      expect(JSON.stringify(read.snapshot)).toMatch(/T1|T2/);
    });

    // A language is refused the way a read hook refuses one: it is handed that language's values,
    // and this one refuses the read carrying the English banner text.
    it("hides the English versions from a reader the read refuses in English", async () => {
      const { at, before } = await postSavedInEnglishThenFrenchDefault(
        dialect,
        {
          translatedBanner: true,
          afterRead: ({ data, user }) => {
            const heading = (data as { banner?: { heading?: string } })?.banner
              ?.heading;
            if (user !== undefined && heading === "H2") {
              throw NextlyError.forbidden({
                logContext: { reason: "english-closed" },
              });
            }
            return data;
          },
        }
      );
      const english = before.items.filter(v => v.locale === "en");
      expect(english.length).toBeGreaterThan(0);

      const after = await listVersionsForDocument({ ...at, user: READER });

      expect(after.items.filter(v => v.locale === "en")).toEqual([]);
      await expect(
        getVersionForDocument({
          ...at,
          user: READER,
          versionNo: english[0].versionNo,
        })
      ).rejects.toThrow();
    });

    it("restores an English version as a save the update rule judges, into the one set of values", async () => {
      const { at, before, handler } =
        await postSavedInEnglishThenFrenchDefault(dialect);
      const first = before.items.find(
        v =>
          v.locale === "en" &&
          v.versionNo === Math.min(...before.items.map(i => i.versionNo))
      );
      expect(first).toBeDefined();

      await restoreVersion({
        ...at,
        user: READER,
        versionNo: first!.versionNo,
      });

      // One set of values, whichever language a read names.
      for (const locale of ["en", "fr"]) {
        const read = await handler.getEntry({
          collectionName: "posts",
          entryId: at.entryId,
          overrideAccess: true,
          locale,
        });
        expect((read.data as { title?: string }).title).toBe("T1");
      }
    });

    // The collection's update rule is the route's question, asked before the restore runs; what
    // the restore itself owes is the field rules a save of the document is judged by.
    it("judges that restore by the field rules a save of the document is judged by", async () => {
      const { at, before, handler } = await postSavedInEnglishThenFrenchDefault(
        dialect,
        { titleUpdate: () => false }
      );
      const oldest = Math.min(...before.items.map(v => v.versionNo));

      // A save by this reader keeps the title: its rule refuses them.
      await handler.updateEntry(
        {
          collectionName: "posts",
          entryId: at.entryId,
          overrideAccess: false,
          user: READER,
        },
        { title: "T3", banner: { heading: "H3" } }
      );
      const restored = await restoreVersion({
        ...at,
        user: READER,
        versionNo: oldest,
      });

      expect(restored.droppedFields).toContain("title");
      const read = await handler.getEntry({
        collectionName: "posts",
        entryId: at.entryId,
        overrideAccess: true,
      });
      expect((read.data as { title?: string }).title).toBe("T2");
    });
  }
);
