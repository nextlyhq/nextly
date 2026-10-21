/**
 * An access rule is told the language it is judging, on a real database.
 *
 * Each rule here closes one language, French, and leaves the others open, so
 * a gate that tells a rule no language, the wrong one, or less than every
 * language an operation involves answers differently from one that tells it
 * the truth:
 *
 * - a read, a list and a count in French are refused, in English allowed,
 *   and an unknown language is judged as the default it resolves to;
 * - a read of every translation involves French, so it is refused;
 * - a write in French is refused, in English allowed;
 * - a delete removes every language, French among them, so a rule that
 *   closes French refuses it, where a rule open to every language does not;
 * - a Single and a field rule are told the language the same way;
 * - content the same in every language is told every language, so naming
 *   French admits nothing there, unless a localized field group makes the
 *   read show French; and a related row the same in every language is judged
 *   so, whatever language the entry it was reached from is read in;
 * - a preview link names no language, so minting one asks the read rule in
 *   every language, and a rule that closes French refuses it.
 *
 * Asked as a visitor and as a signed-in user, the two callers whose rule the
 * collection gate consults directly.
 */
import { afterEach, describe, expect, it } from "vitest";

import { assertEntryPreviewable } from "../../api/preview-access";
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  relationship,
  text,
} from "../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import type { CollectionService } from "../../domains/collections/services/collection-service";
import type { CollectionsHandler } from "../../services/collections-handler";
import type { AccessRuleContext } from "../../shared/types/access";
import {
  singleDocumentEditable,
  singleStoredDocumentReadable,
} from "../../domains/singles/services/single-document-access";
import type { SingleEntryService } from "../../domains/singles/services/single-entry-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Open in every language but French. */
const frenchClosed = ({ locales }: AccessRuleContext) =>
  !locales.includes("fr");

/** Open to French alone. */
const frenchOnly = ({ locale }: AccessRuleContext) => locale === "fr";

/** Open in English, the default language, alone. */
const englishOnly = ({ locales }: AccessRuleContext) =>
  locales.length > 0 && locales.every(code => code === "en");

const NOTES = "notes";
const ENGLISH = "englishnotes";
const NOT_ENGLISH = "notenglishnotes";
const OPEN = "opennotes";
const SECRETS = "secrets";
const SETTINGS = "sitecopy";
const PREVIEW_CLOSED = "previewclosed";
const SHARED = "sharednotes";
const SHARED_GROUPED = "sharedgroupednotes";
const SHARED_ENGLISH = "sharedenglishnotes";
const SHARED_OPEN = "sharedopennotes";
const LINKING = "linkingnotes";
const PREVIEW_OPEN = "previewopen";
const PREVIEW_EDIT_CLOSED = "previeweditclosed";

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    localization: { locales: ["en", "fr", "de"], defaultLocale: "en" },
    fieldGroups: [
      defineFieldGroup({
        slug: "notemeta",
        localized: true,
        fields: [text({ name: "heading" })],
      }),
    ],
    collections: [
      defineCollection({
        slug: NOTES,
        localized: true,
        access: {
          create: () => true,
          read: frenchClosed,
          update: frenchClosed,
          delete: frenchClosed,
        },
        fields: [text({ name: "body", localized: true })],
      }),
      defineCollection({
        slug: ENGLISH,
        localized: true,
        // Open in the default language alone, and refused anything involving
        // another: a write judged in every language is refused here, where
        // one judged in the default language it writes is allowed.
        access: {
          create: englishOnly,
          read: () => true,
          update: englishOnly,
          delete: englishOnly,
        },
        fields: [text({ name: "body", localized: true })],
      }),
      defineCollection({
        slug: NOT_ENGLISH,
        localized: true,
        // Refused anything involving English, the default language.
        access: {
          create: () => true,
          read: () => true,
          update: ({ locales }) => !locales.includes("en"),
        },
        fields: [text({ name: "body", localized: true })],
      }),
      defineCollection({
        slug: OPEN,
        localized: true,
        // The control for the delete: a rule told every language, none closed.
        access: { create: () => true, read: () => true, delete: () => true },
        fields: [text({ name: "body", localized: true })],
      }),
      defineCollection({
        slug: SECRETS,
        localized: true,
        access: { create: () => true, read: () => true },
        fields: [
          text({ name: "title", localized: false }),
          text({
            name: "secret",
            localized: false,
            access: { read: ({ locale }) => locale !== "fr" },
          }),
          // Withheld from any read that involves French, a French fallback
          // included: a value a read shows from its fallback language is that
          // language's content.
          text({
            name: "noFrench",
            localized: false,
            access: { read: ({ locales }) => !locales.includes("fr") },
          }),
        ],
      }),
      defineCollection({
        slug: SHARED,
        // Not localized: every language reads the same rows.
        access: { create: () => true, read: frenchOnly },
        fields: [text({ name: "body" })],
      }),
      defineCollection({
        slug: SHARED_GROUPED,
        // Not localized itself, but its field group is, so a read in French
        // shows that group's French values.
        access: { create: () => true, read: frenchOnly },
        fields: [
          text({ name: "body" }),
          fieldGroup({ name: "meta", component: "notemeta" }),
        ],
      }),
      defineCollection({
        slug: SHARED_ENGLISH,
        // Not localized, and open to English alone: no read of it is in
        // English, so it is withheld wherever it is reached from.
        access: {
          create: () => true,
          read: ({ locale }) => locale === "en",
        },
        fields: [text({ name: "body" })],
      }),
      defineCollection({
        slug: SHARED_OPEN,
        // The control: the same, open in every language.
        access: { create: () => true, read: () => true },
        fields: [text({ name: "body" })],
      }),
      defineCollection({
        slug: LINKING,
        localized: true,
        access: { create: () => true, read: () => true },
        fields: [
          text({ name: "body", localized: true }),
          relationship({ name: "closed", relationTo: SHARED_ENGLISH }),
          relationship({ name: "open", relationTo: SHARED_OPEN }),
        ],
      }),
      defineCollection({
        slug: PREVIEW_CLOSED,
        localized: true,
        // Open to edit, so only the read rule can refuse a preview link.
        access: { create: () => true, read: frenchClosed, update: () => true },
        fields: [text({ name: "body", localized: true })],
      }),
      defineCollection({
        slug: PREVIEW_OPEN,
        localized: true,
        // The control: the same, with the read open in every language.
        access: { create: () => true, read: () => true, update: () => true },
        fields: [text({ name: "body", localized: true })],
      }),
      defineCollection({
        slug: PREVIEW_EDIT_CLOSED,
        localized: true,
        // Open to read, so only the edit rule can refuse a preview link.
        access: { create: () => true, read: () => true, update: frenchClosed },
        fields: [text({ name: "body", localized: true })],
      }),
    ],
    singles: [
      defineSingle({
        slug: SETTINGS,
        localized: true,
        access: { read: frenchClosed, update: frenchClosed },
        fields: [text({ name: "tagline", localized: true })],
      }),
    ],
  });
  return current;
}

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler");
const singlesOf = (t: TestNextly): SingleEntryService =>
  t.getService("singleEntryService");

/** The id of an entry a trusted create made. */
function idOf(created: { item: Record<string, unknown> }): string {
  const { id } = created.item;
  if (typeof id !== "string") throw new TypeError("a created entry has an id");
  return id;
}

async function seed(t: TestNextly, collection: string): Promise<string> {
  return idOf(
    await t.nextly.create({
      collection,
      data: { body: "hello" },
    })
  );
}

/** A visitor, and a signed-in user who is not a super-admin. */
const CALLERS = [
  ["a visitor", {}],
  ["a signed-in user", { user: { id: "user-1", isActive: true } }],
] as const;

describe.each(getConfiguredTestDialects())(
  "an access rule is told the language it judges (%s)",
  dialect => {
    describe.each(CALLERS)("asked as %s", (_name, caller) => {
      it("refuses a read, a list and a count in the language it closes, and allows them in another", async () => {
        const t = await boot(dialect);
        const id = await seed(t, NOTES);
        const read = (locale: string) =>
          handlerOf(t).getEntry({
            collectionName: NOTES,
            entryId: id,
            overrideAccess: false,
            locale,
            ...caller,
          });

        expect((await read("en")).success).toBe(true);
        expect((await read("fr")).success).toBe(false);
        // An unknown language is read as the default, and judged as it.
        expect((await read("xx")).success).toBe(true);
        // Every translation at once involves French.
        expect((await read("all")).success).toBe(false);

        const list = (locale: string) =>
          handlerOf(t).listEntries({
            collectionName: NOTES,
            overrideAccess: false,
            locale,
            ...caller,
          });
        expect((await list("de")).success).toBe(true);
        expect((await list("fr")).success).toBe(false);

        const count = (locale: string) =>
          handlerOf(t).countEntries({
            collectionName: NOTES,
            overrideAccess: false,
            locale,
            ...caller,
          });
        expect((await count("de")).success).toBe(true);
        expect((await count("fr")).success).toBe(false);
      });

      it("tells a read of content the same in every language every language, unless a localized field group makes it read per language", async () => {
        const t = await boot(dialect);
        const readIn = (collectionName: string, entryId: string) =>
          handlerOf(t).getEntry({
            collectionName,
            entryId,
            overrideAccess: false,
            locale: "fr",
            ...caller,
          });
        // Told French for the asking, a rule open to French alone would let
        // anyone read rows that are no language's content.
        expect((await readIn(SHARED, await seed(t, SHARED))).success).toBe(
          false
        );
        expect(
          (await readIn(SHARED_GROUPED, await seed(t, SHARED_GROUPED))).success
        ).toBe(true);
      });

      it("judges a related row the same in every language by its own content, not the language its entry is read in", async () => {
        const t = await boot(dialect);
        const linking = idOf(
          await t.nextly.create({
            collection: LINKING,
            data: {
              body: "hello",
              closed: await seed(t, SHARED_ENGLISH),
              open: await seed(t, SHARED_OPEN),
            },
          })
        );
        const read = await handlerOf(t).getEntry({
          collectionName: LINKING,
          entryId: linking,
          overrideAccess: false,
          locale: "en",
          depth: 1,
          ...caller,
        });
        expect(read.success).toBe(true);
        const data = read.data as { closed?: unknown; open?: unknown };
        // Told the English read's language, the related rule would expand it.
        expect(data.open).toMatchObject({ body: "hello" });
        expect(data.closed).not.toMatchObject({ body: "hello" });
      });

      it("refuses a write in the language it closes, and allows one in another", async () => {
        const t = await boot(dialect);
        const id = await seed(t, NOTES);
        const write = (locale: string) =>
          handlerOf(t).updateEntry(
            {
              collectionName: NOTES,
              entryId: id,
              overrideAccess: false,
              locale,
              ...caller,
            },
            { body: `in ${locale}` }
          );

        const refused = await write("fr");
        expect(refused.success).toBe(false);
        expect(refused.statusCode).toBe(403);
        expect((await write("en")).success).toBe(true);
      });

      it("refuses a delete, which removes every language, where the rule closes one", async () => {
        const t = await boot(dialect);
        const closed = await seed(t, NOTES);
        const open = await seed(t, OPEN);
        const remove = (collectionName: string, entryId: string) =>
          handlerOf(t).deleteEntry({
            collectionName,
            entryId,
            overrideAccess: false,
            ...caller,
          });

        const refused = await remove(NOTES, closed);
        expect(refused.success).toBe(false);
        expect(refused.statusCode).toBe(403);
        // The control: the same delete under a rule open to every language.
        expect((await remove(OPEN, open)).success).toBe(true);
      });

      it("tells a Single's rule the language it reads and writes", async () => {
        const t = await boot(dialect);
        const read = (locale: string) =>
          singlesOf(t).get(SETTINGS, {
            overrideAccess: false,
            locale,
            ...caller,
          });
        expect((await read("en")).success).toBe(true);
        expect((await read("fr")).success).toBe(false);

        const write = (locale: string) =>
          singlesOf(t).update(
            SETTINGS,
            { tagline: `in ${locale}` },
            { overrideAccess: false, locale, ...caller }
          );
        expect((await write("fr")).success).toBe(false);
        expect((await write("de")).success).toBe(true);
      });

      it("tells a field's rule the language it reads", async () => {
        const t = await boot(dialect);
        const id = idOf(
          await t.nextly.create({
            collection: SECRETS,
            data: { title: "t", secret: "s", noFrench: "n" },
          })
        );
        const read = async (locale: string, fallbackLocale?: string) => {
          const result = await handlerOf(t).getEntry({
            collectionName: SECRETS,
            entryId: id,
            overrideAccess: false,
            locale,
            ...(fallbackLocale === undefined ? {} : { fallbackLocale }),
            ...caller,
          });
          expect(result.success).toBe(true);
          return result.data as Record<string, unknown>;
        };

        expect((await read("en")).secret).toBe("s");
        const french = await read("fr");
        expect(french.title).toBe("t");
        expect("secret" in french).toBe(false);

        // A German read that falls back to French involves French; one that
        // falls back to nothing does not.
        expect("noFrench" in (await read("de", "fr"))).toBe(false);
        expect((await read("de", "none")).noFrench).toBe("n");
      });
    });

    describe("as a signed-in user, through the collection service", () => {
      // A signed-in user as the service's request context names one. Not a
      // super-admin, so the collection's rule decides.
      const context = {
        user: {
          id: "user-1",
          email: "user-1@example.test",
          role: "editor",
          permissions: [],
        },
      };
      const serviceOf = (t: TestNextly): CollectionService =>
        t.getService("collectionService");

      it("judges a bulk create and a bulk update in the default language they write", async () => {
        const t = await boot(dialect);
        const created = await serviceOf(t).createMany(
          ENGLISH,
          [{ body: "a" }, { body: "b" }],
          context
        );
        expect(created.failed).toBe(0);
        expect(created.successful).toBe(2);

        const updated = await serviceOf(t).updateMany(
          ENGLISH,
          created.ids.map(id => ({ id, data: { body: "changed" } })),
          context
        );
        expect(updated.failed).toBe(0);
        expect(updated.successful).toBe(2);
      });

      it("judges a write on the caller's transaction in the default language it writes", async () => {
        const t = await boot(dialect);
        const id = await seed(t, ENGLISH);
        const updated = await t.adapter.transaction(tx =>
          serviceOf(t).updateEntryInTransaction(
            tx,
            ENGLISH,
            id,
            { body: "changed" },
            context
          )
        );
        expect(updated.id).toBe(id);
      });

      it("judges a write on the caller's transaction in the default language it writes, not a locale it is handed", async () => {
        // The write ignores the locale it is handed and writes the default
        // language, so a rule refusing the default refuses it: told the
        // handed locale instead, the rule would judge a language not written.
        const t = await boot(dialect);
        const id = await seed(t, NOT_ENGLISH);
        await expect(
          t.adapter.transaction(tx =>
            serviceOf(t).updateEntryInTransaction(
              tx,
              NOT_ENGLISH,
              id,
              { body: "changed" },
              { ...context, locale: "fr" }
            )
          )
        ).rejects.toMatchObject({ statusCode: 403 });
      });

      it("judges a delete in every language, so a rule open in one refuses it", async () => {
        const t = await boot(dialect);
        const id = await seed(t, ENGLISH);
        const refused = await handlerOf(t).deleteEntry({
          collectionName: ENGLISH,
          entryId: id,
          overrideAccess: false,
          ...context,
        });
        expect(refused.success).toBe(false);
        expect(refused.statusCode).toBe(403);
      });
    });

    describe("minting a preview link, which names no language", () => {
      const sharer = { id: "user-1", email: "user-1@example.test", roles: [] };

      it("refuses it where the read rule closes a language, and allows it where none is closed", async () => {
        const t = await boot(dialect);
        // Asked in the default language alone, the read would pass, and the
        // link could then be signed for French.
        const closed = await seed(t, PREVIEW_CLOSED);
        await expect(
          assertEntryPreviewable(PREVIEW_CLOSED, closed, sharer, {
            routeAuthorized: true,
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });

        const open = await seed(t, PREVIEW_OPEN);
        await expect(
          assertEntryPreviewable(PREVIEW_OPEN, open, sharer, {
            routeAuthorized: true,
          })
        ).resolves.toBeDefined();
      });
    });

    describe("minting or opening a preview link to one language", () => {
      const sharer = { id: "user-1", email: "user-1@example.test", roles: [] };

      it("asks a Single's stored-row checks in the language they name: allowed in English, refused in French", async () => {
        const t = await boot(dialect);
        // A row to ask about; the stored checks read it, never create it.
        expect(
          (
            await singlesOf(t).update(
              SETTINGS,
              { tagline: "hello" },
              { overrideAccess: true, locale: "en" }
            )
          ).success
        ).toBe(true);
        for (const check of [
          singleStoredDocumentReadable,
          singleDocumentEditable,
        ]) {
          const ask = (locale: string) =>
            check(SETTINGS, { user: sharer, routeAuthorized: false, locale });
          expect(await ask("en")).toBe(true);
          expect(await ask("fr")).toBe(false);
        }
      });

      it("asks the read rule in the link's language: allowed in English, refused in French", async () => {
        const t = await boot(dialect);
        const closed = await seed(t, PREVIEW_CLOSED);
        // At the mint, and at an open, which no route gate has run for.
        for (const routeAuthorized of [true, false]) {
          await expect(
            assertEntryPreviewable(PREVIEW_CLOSED, closed, sharer, {
              routeAuthorized,
              locale: "en",
            })
          ).resolves.toBeDefined();
          await expect(
            assertEntryPreviewable(PREVIEW_CLOSED, closed, sharer, {
              routeAuthorized,
              locale: "fr",
            })
          ).rejects.toMatchObject({ code: "FORBIDDEN" });
        }
      });

      it("asks the edit rule in the link's language: allowed in English, refused in French", async () => {
        const t = await boot(dialect);
        // The control for the French refusal below: where every rule is open,
        // a link to French is allowed, so that refusal is the edit rule's.
        const open = await seed(t, PREVIEW_OPEN);
        await expect(
          assertEntryPreviewable(PREVIEW_OPEN, open, sharer, {
            routeAuthorized: false,
            locale: "fr",
          })
        ).resolves.toBeDefined();

        const entry = await seed(t, PREVIEW_EDIT_CLOSED);
        await expect(
          assertEntryPreviewable(PREVIEW_EDIT_CLOSED, entry, sharer, {
            routeAuthorized: false,
            locale: "en",
          })
        ).resolves.toBeDefined();
        await expect(
          assertEntryPreviewable(PREVIEW_EDIT_CLOSED, entry, sharer, {
            routeAuthorized: false,
            locale: "fr",
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        // The control: a link naming no language is asked in every language,
        // French included.
        await expect(
          assertEntryPreviewable(PREVIEW_EDIT_CLOSED, entry, sharer, {
            routeAuthorized: false,
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      });
    });
  }
);
