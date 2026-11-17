/**
 * The languages of a document's history a caller may read are the languages
 * the collection's or Single's own read rule admits for that caller: history
 * in a language the rule refuses is not readable, as the document in that
 * language is not. The same holds for the history route itself, and for a
 * discard, which hands back the document in the language it discards.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { readableHistoryLocales } from "../../../api/versions-access";
import { defineCollection, defineSingle, text } from "../../../config";
import {
  asCaller,
  sessionCaller,
} from "../../../dispatcher/__tests__/request-caller";
import {
  discardWorkingDraftForDocument,
  listVersionsForDocument,
} from "../../../dispatcher/handlers/versions-methods";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

const POSTS = "hlr_posts";
const SITE = "hlr_site";

/** Readable in any language but Spanish. */
const notSpanish = ({ locale }: { locale?: string }) => locale !== "es";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: POSTS,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: { read: notSpanish },
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: SITE,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: { read: notSpanish },
        fields: [text({ name: "title" })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  return current;
}

/** A post written in English and in Spanish, as a trusted server writes it. */
async function bilingualPost(t: TestNextly): Promise<string> {
  const created = await t.nextly.create({
    collection: POSTS,
    locale: "en",
    data: { title: "Harbour", status: "published" },
  });
  const id = String(created.item.id);
  await t.nextly.update({
    collection: POSTS,
    id,
    locale: "es",
    data: { title: "Puerto", status: "published", _overwrite: true },
  });
  return id;
}

/** Whether `read` settles, keeping the refusal's code where it is refused. */
const outcome = (read: Promise<unknown>) =>
  read.then(
    () => "readable",
    (error: unknown) =>
      `refused ${String((error as { code?: unknown }).code ?? error)}`
  );

describe.each(getConfiguredTestDialects())(
  "history in a language the read rule refuses (integration, %s)",
  dialect => {
    it("leaves out an entry's history in a language its read rule refuses", async () => {
      const t = await boot(dialect);
      const created = await t.nextly.create({
        collection: POSTS,
        locale: "en",
        data: { title: "Harbour", status: "published" },
      });
      const id = String(created.item.id);
      await t.nextly.update({
        collection: POSTS,
        id,
        locale: "es",
        data: { title: "Puerto", status: "published", _overwrite: true },
      });
      const reader = await userWhoMay(t, "hlr-reader", "read", [POSTS]);

      const readable = await readableHistoryLocales(
        "collection",
        POSTS,
        id,
        { id: reader } as never,
        undefined,
        {},
        ["en", "es"]
      );
      // The reader may read the entry in English: the fixture reaches the rule.
      expect(readable.has("en")).toBe(true);
      expect(readable.has("es")).toBe(false);
    }, 90_000);

    it("leaves out a Single's history in a language its read rule refuses", async () => {
      const t = await boot(dialect);
      const singles = t.getService("singleEntryService") as unknown as {
        update(
          slug: string,
          data: Record<string, unknown>,
          options: Record<string, unknown>
        ): Promise<{ success: boolean; data?: { id?: unknown } | null }>;
      };
      let id = "";
      for (const [locale, title] of [
        ["en", "Site"],
        ["es", "Sitio"],
      ] as const) {
        const saved = await singles.update(
          SITE,
          { title, status: "published", _overwrite: true },
          { locale, overrideAccess: true }
        );
        expect(saved.success, JSON.stringify(saved)).toBe(true);
        id = String(saved.data?.id ?? id);
      }
      const reader = await userWhoMay(t, "hlr-site-reader", "read", [SITE]);

      const readable = await readableHistoryLocales(
        "single",
        SITE,
        id,
        { id: reader } as never,
        undefined,
        {},
        ["en", "es"]
      );
      expect(readable.has("en")).toBe(true);
      expect(readable.has("es")).toBe(false);
    }, 90_000);

    it("lists an entry's history only in the languages its read rule admits", async () => {
      const t = await boot(dialect);
      const id = await bilingualPost(t);
      const reader = await userWhoMay(t, "hlr-list-reader", "read", [POSTS]);
      const list = (locale?: string) =>
        listVersionsForDocument({
          scopeKind: "collection",
          slug: POSTS,
          entryId: id,
          user: { id: reader },
          ...(locale === undefined ? {} : { locale }),
        });

      // The history holds both languages, read by a trusted server.
      const versions = t.getService("versionsService") as unknown as {
        list(ref: Record<string, string>): Promise<{ locale: string | null }[]>;
      };
      const all = await versions.list({
        scopeKind: "collection",
        scopeSlug: POSTS,
        entryId: id,
      });
      expect(new Set(all.map(v => v.locale))).toEqual(new Set(["en", "es"]));
      // The reader may list English, and never Spanish.
      expect(await outcome(list("en"))).toBe("readable");
      expect(await outcome(list("es"))).toMatch(/^refused NOT_FOUND/);
      const unnamed = await list();
      expect(unnamed.items.map(v => v.locale)).toContain("en");
      expect(unnamed.items.map(v => v.locale)).not.toContain("es");
    }, 90_000);

    it("hands a discard back only in a language the read rule admits", async () => {
      const t = await boot(dialect);
      const id = await bilingualPost(t);
      const editor = await userWhoMay(t, "hlr-editor", "read", [POSTS]);
      await grantTo(t, editor, "update", [POSTS]);
      const discard = (locale: string) =>
        asCaller(sessionCaller({ userId: editor }), () =>
          discardWorkingDraftForDocument({
            scopeKind: "collection",
            slug: POSTS,
            entryId: id,
            user: { id: editor },
            locale,
            version: { _overwrite: true },
            params: { collectionName: POSTS, entryId: id },
          })
        );

      // The editor may discard in English and is handed the English document.
      expect(((await discard("en")) as { title?: string }).title).toBe(
        "Harbour"
      );
      // Spanish is refused rather than handed back.
      expect(await outcome(discard("es"))).toMatch(/^refused /);
    }, 90_000);
  }
);
