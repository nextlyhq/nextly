/**
 * A write that changes more than one language asks its rule once in each
 * language it changes, and goes ahead only where every answer allows it.
 *
 * A delete removes every language an entry holds, so its delete rule is asked
 * in each of them: a rule refusing German refuses deleting an entry with
 * German content, and still lets an entry with none be deleted. A rule
 * answering a filter in each language deletes only an entry each of those
 * filters matches. An update by query writes the default language, so its
 * update rule is asked in that language. Asked the same way through the
 * Direct API, the entry services and REST.
 *
 * @module domains/collections/__tests__/every-language-writes-ask-each-language.integration.test
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { clearRuleFilterReports } from "../../../auth/access/rule-answer";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { AccessControlContext } from "../../../shared/types/access";

// Integration files share fixed system-table names, so this file keeps its
// own slugs.
// Delete and update rules refusing German.
const NOT_GERMAN = "eachlang_not_german";
// Delete and update rules refusing English, the default language.
const NOT_ENGLISH = "eachlang_not_english";
// Rules allowing every language: the control.
const ANY_LANGUAGE = "eachlang_any_language";
// A delete rule answering "only the caller's own" in each language, over a
// translated `owner`.
const OWN = "eachlang_own";
// Refusing German, on a collection whose edits are held as working drafts.
const DRAFTED = "eachlang_drafted";
// The same, refusing French, a language the site no longer configures.
const DRAFTED_NOT_FRENCH = "eachlang_drafted_not_french";
// Refusing German, on entries only their owner may read.
const HIDDEN = "eachlang_hidden";

const AUTHOR = "eachlang-author";
const OTHER = "eachlang-other";
const LANGUAGES = { locales: ["en", "de"], defaultLocale: "en" };
const SLUGS = [
  NOT_GERMAN,
  NOT_ENGLISH,
  ANY_LANGUAGE,
  OWN,
  DRAFTED,
  DRAFTED_NOT_FRENCH,
  HIDDEN,
];

let current: TestNextly | undefined;
afterEach(async () => {
  resetSessionStandingForTests();
  await current?.destroy();
  current = undefined;
  clearRuleFilterReports();
});

const notIn =
  (refused: string) =>
  (context: AccessControlContext): boolean =>
    context.locale !== refused;

async function boot(dialect: TestDialect): Promise<TestNextly> {
  // `owner` is translated, so an entry can be the author's in one language
  // and another's in the other.
  const fields = [text({ name: "title" }), text({ name: "owner" })];
  const collection = (
    slug: string,
    rule: (context: AccessControlContext) => boolean
  ) =>
    defineCollection({
      slug,
      localized: true,
      access: { read: () => true, update: rule, delete: rule },
      fields,
    });
  current = await createTestNextly({
    dialect,
    localization: LANGUAGES,
    collections: [
      collection(NOT_GERMAN, notIn("de")),
      collection(NOT_ENGLISH, notIn("en")),
      collection(ANY_LANGUAGE, () => true),
      defineCollection({
        slug: DRAFTED,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: {
          read: () => true,
          update: () => true,
          delete: notIn("de"),
        },
        fields,
      }),
      defineCollection({
        slug: DRAFTED_NOT_FRENCH,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: {
          read: () => true,
          update: () => true,
          delete: notIn("fr"),
        },
        fields,
      }),
      defineCollection({
        slug: HIDDEN,
        localized: true,
        access: {
          read: ({ user }) => ({ owner: { equals: user?.id ?? "" } }),
          update: () => true,
          delete: notIn("de"),
        },
        fields,
      }),
      defineCollection({
        slug: OWN,
        localized: true,
        access: {
          read: () => true,
          update: ({ user }) => ({ owner: { equals: user?.id ?? "" } }),
          delete: ({ user }) => ({ owner: { equals: user?.id ?? "" } }),
        },
        fields,
      }),
    ],
  });
  await userWhoMay(current, AUTHOR, "read", SLUGS);
  await grantTo(current, AUTHOR, "update", SLUGS);
  await grantTo(current, AUTHOR, "delete", SLUGS);
  return current;
}

/**
 * An entry of `collection` with an English row and, where `german` names its
 * owner, a German one; its id.
 */
async function entryIn(
  t: TestNextly,
  collection: string,
  title: string,
  german?: { owner: string }
): Promise<string> {
  const made = await t.nextly.create({
    collection,
    data: { title, owner: AUTHOR },
  });
  const id = String(made.item.id);
  if (german) {
    await t.nextly.update({
      collection,
      id,
      locale: "de",
      data: { title: `${title} de`, owner: german.owner },
    } as never);
  }
  return id;
}

/** An entry with German content, and one with English alone. */
async function seed(t: TestNextly, collection: string) {
  return {
    withGerman: await entryIn(t, collection, "both", { owner: AUTHOR }),
    englishOnly: await entryIn(t, collection, "english"),
  };
}

const asAuthor = { overrideAccess: false, user: { id: AUTHOR } } as const;

const entriesOf = (t: TestNextly) =>
  t
    .getService("collectionsHandler")
    .getEntryService() as CollectionEntryService;

async function stillThere(
  t: TestNextly,
  collection: string,
  id: string
): Promise<boolean> {
  const found = await t.nextly.find({
    collection,
    where: { id: { equals: id } },
  });
  return found.items.length === 1;
}

/** Each of `ids` still stored, in order. */
const remaining = (t: TestNextly, collection: string, ids: string[]) =>
  Promise.all(ids.map(id => stillThere(t, collection, id)));

/** Whether a Direct API call refused, as opposed to succeeding. */
async function refused(call: () => Promise<unknown>): Promise<boolean> {
  try {
    await call();
    return false;
  } catch {
    return true;
  }
}

/** The status of a REST request the author signs. */
async function rest(
  method: "PATCH" | "POST" | "DELETE",
  path: string[],
  body?: unknown
): Promise<number> {
  const token = await signAccessToken(
    buildClaims({
      userId: AUTHOR,
      email: `${AUTHOR}@example.test`,
      name: AUTHOR,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET!
  );
  const handlers = createDynamicHandlers() as unknown as Record<
    string,
    (request: Request, context: unknown) => Promise<Response>
  >;
  const res = await handlers[method]!(
    new Request(`http://localhost/api/${path.join("/")}`, {
      method,
      headers: {
        cookie: `nextly_session=${token}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ params: path }) }
  );
  return res.status;
}

const entries = (collection: string) => ["collections", collection, "entries"];

// Each language's rule is asked, and each filter matched, in SQL on each
// database this run reaches.
describe.each(getConfiguredTestDialects())(
  "a write changing every language, asked in each (%s)",
  (dialect: TestDialect) => {
    describe("a delete by id", () => {
      it("refuses deleting an entry with German content under a rule refusing German, and deletes one with none", async () => {
        const t = await boot(dialect);
        const { withGerman, englishOnly } = await seed(t, NOT_GERMAN);

        expect(
          await refused(() =>
            t.nextly.delete({
              collection: NOT_GERMAN,
              id: withGerman,
              ...asAuthor,
            })
          )
        ).toBe(true);
        expect(
          await refused(() =>
            t.nextly.delete({
              collection: NOT_GERMAN,
              id: englishOnly,
              ...asAuthor,
            })
          )
        ).toBe(false);
        expect(
          await remaining(t, NOT_GERMAN, [withGerman, englishOnly])
        ).toEqual([true, false]);
      });

      it("deletes an entry with German content under a rule allowing every language", async () => {
        const t = await boot(dialect);
        const { withGerman } = await seed(t, ANY_LANGUAGE);

        await t.nextly.delete({
          collection: ANY_LANGUAGE,
          id: withGerman,
          ...asAuthor,
        });

        expect(await stillThere(t, ANY_LANGUAGE, withGerman)).toBe(false);
      });

      it("deletes only an entry each language's filter matches", async () => {
        const t = await boot(dialect);
        const ownInBoth = await entryIn(t, OWN, "both", { owner: AUTHOR });
        const ownInEnglishOnly = await entryIn(t, OWN, "mixed", {
          owner: OTHER,
        });

        expect(
          await refused(() =>
            t.nextly.delete({
              collection: OWN,
              id: ownInEnglishOnly,
              ...asAuthor,
            })
          )
        ).toBe(true);
        await t.nextly.delete({ collection: OWN, id: ownInBoth, ...asAuthor });

        expect(await remaining(t, OWN, [ownInBoth, ownInEnglishOnly])).toEqual([
          false,
          true,
        ]);
      });

      it("answers a REST delete as the rule does in each language", async () => {
        const t = await boot(dialect);
        const { withGerman, englishOnly } = await seed(t, NOT_GERMAN);

        expect(await rest("DELETE", [...entries(NOT_GERMAN), withGerman])).toBe(
          403
        );
        expect(
          await rest("DELETE", [...entries(NOT_GERMAN), englishOnly])
        ).toBe(200);
        expect(
          await remaining(t, NOT_GERMAN, [withGerman, englishOnly])
        ).toEqual([true, false]);
      });
    });

    describe("what a delete removes beyond its rows, and what it tells", () => {
      it("refuses deleting an entry whose German edit is held, with no German row of its own", async () => {
        const t = await boot(dialect);
        const made = await t.nextly.create({
          collection: DRAFTED,
          data: { title: "live", owner: AUTHOR, status: "published" },
        });
        const id = String(made.item.id);
        // Held as a working draft in German: the delete would remove it.
        await t.nextly.update({
          collection: DRAFTED,
          id,
          locale: "de",
          data: { title: "entwurf" },
        } as never);

        expect(
          await refused(() =>
            t.nextly.delete({ collection: DRAFTED, id, ...asAuthor })
          )
        ).toBe(true);
        expect(await stillThere(t, DRAFTED, id)).toBe(true);
      });

      it("refuses deleting an entry whose held edit is in a language the site no longer configures", async () => {
        const t = await boot(dialect);
        const made = await t.nextly.create({
          collection: DRAFTED_NOT_FRENCH,
          data: { title: "live", owner: AUTHOR, status: "published" },
        });
        const id = String(made.item.id);
        await t.nextly.update({
          collection: DRAFTED_NOT_FRENCH,
          id,
          locale: "de",
          data: { title: "entwurf" },
        } as never);
        // The German held edit relabelled to a language since removed, as
        // one left behind when a locale is taken out of the config.
        await t.adapter.update(
          "nextly_versions",
          { locale: "fr" },
          {
            and: [
              { column: "scopeSlug", op: "=", value: DRAFTED_NOT_FRENCH },
              { column: "entryId", op: "=", value: id },
              { column: "locale", op: "=", value: "de" },
            ],
          }
        );

        expect(
          await refused(() =>
            t.nextly.delete({
              collection: DRAFTED_NOT_FRENCH,
              id,
              ...asAuthor,
            })
          )
        ).toBe(true);
        expect(await stillThere(t, DRAFTED_NOT_FRENCH, id)).toBe(true);
      });

      it("answers a batch's refused entry the caller may not read as it answers a missing one", async () => {
        const t = await boot(dialect);
        const made = await t.nextly.create({
          collection: HIDDEN,
          data: { title: "theirs", owner: OTHER },
        });
        const hidden = String(made.item.id);
        await t.nextly.update({
          collection: HIDDEN,
          id: hidden,
          locale: "de",
          data: { title: "ihres", owner: OTHER },
        } as never);
        const missing = "00000000-0000-4000-8000-000000000000";

        const result = await entriesOf(t).deleteEntries(
          { collectionName: HIDDEN, user: { id: AUTHOR } } as never,
          [hidden, missing]
        );

        expect(result.failed).toBe(2);
        const [first, second] = result.errors.map(({ error }) =>
          error.replaceAll(hidden, "<id>").replaceAll(missing, "<id>")
        );
        expect(first).toBe(second);
        expect(await stillThere(t, HIDDEN, hidden)).toBe(true);
      });
    });

    describe("a delete of several entries", () => {
      it("deletes by ids only the entries no language refuses", async () => {
        const t = await boot(dialect);
        const { withGerman, englishOnly } = await seed(t, NOT_GERMAN);

        await entriesOf(t).bulkDeleteEntries({
          collectionName: NOT_GERMAN,
          ids: [withGerman, englishOnly],
          ...asAuthor,
        } as never);

        expect(
          await remaining(t, NOT_GERMAN, [withGerman, englishOnly])
        ).toEqual([true, false]);
      });

      it("deletes by ids over REST only the entries no language refuses", async () => {
        const t = await boot(dialect);
        const { withGerman, englishOnly } = await seed(t, NOT_GERMAN);

        await rest("POST", [...entries(NOT_GERMAN), "bulk-delete"], {
          ids: [withGerman, englishOnly],
        });

        expect(
          await remaining(t, NOT_GERMAN, [withGerman, englishOnly])
        ).toEqual([true, false]);
      });

      it("deletes by query only the entries no language refuses", async () => {
        const t = await boot(dialect);
        const { withGerman, englishOnly } = await seed(t, NOT_GERMAN);

        await entriesOf(t).bulkDeleteByQuery({
          collectionName: NOT_GERMAN,
          where: { title: { in: ["both", "english"] } },
          ...asAuthor,
        } as never);

        expect(
          await remaining(t, NOT_GERMAN, [withGerman, englishOnly])
        ).toEqual([true, false]);
      });

      it("deletes in a batch only the entries no language refuses", async () => {
        const t = await boot(dialect);
        const { withGerman, englishOnly } = await seed(t, NOT_GERMAN);

        await entriesOf(t).deleteEntries(
          { collectionName: NOT_GERMAN, user: { id: AUTHOR } } as never,
          [withGerman, englishOnly]
        );

        expect(
          await remaining(t, NOT_GERMAN, [withGerman, englishOnly])
        ).toEqual([true, false]);
      });

      it("deletes by query every entry under a rule allowing every language", async () => {
        const t = await boot(dialect);
        const { withGerman, englishOnly } = await seed(t, ANY_LANGUAGE);

        await entriesOf(t).bulkDeleteByQuery({
          collectionName: ANY_LANGUAGE,
          where: { title: { in: ["both", "english"] } },
          ...asAuthor,
        } as never);

        expect(
          await remaining(t, ANY_LANGUAGE, [withGerman, englishOnly])
        ).toEqual([false, false]);
      });
    });

    describe("an update by query, which writes the default language", () => {
      const where = { title: { in: ["both", "english"] } };
      const titleOf = async (t: TestNextly, collection: string, id: string) =>
        (
          (await t.nextly.findByID({ collection, id } as never)) as {
            title?: string;
          }
        ).title;

      it("is refused under a rule refusing English", async () => {
        const t = await boot(dialect);
        const { withGerman, englishOnly } = await seed(t, NOT_ENGLISH);

        expect(
          await refused(() =>
            entriesOf(t).bulkUpdateByQuery({
              collectionName: NOT_ENGLISH,
              where,
              data: { title: "renamed" },
              ...asAuthor,
            } as never)
          )
        ).toBe(true);
        expect(await titleOf(t, NOT_ENGLISH, withGerman)).toBe("both");
        expect(await titleOf(t, NOT_ENGLISH, englishOnly)).toBe("english");
      });

      it("is refused over REST under a rule refusing English", async () => {
        const t = await boot(dialect);
        const { withGerman } = await seed(t, NOT_ENGLISH);

        await rest("PATCH", entries(NOT_ENGLISH), {
          where,
          data: { title: "renamed" },
        });

        expect(await titleOf(t, NOT_ENGLISH, withGerman)).toBe("both");
      });

      it("writes every matching entry under a rule refusing only German", async () => {
        const t = await boot(dialect);
        const { withGerman, englishOnly } = await seed(t, NOT_GERMAN);

        const result = await entriesOf(t).bulkUpdateByQuery({
          collectionName: NOT_GERMAN,
          where,
          data: { title: "renamed" },
          ...asAuthor,
        } as never);

        expect(result.successCount).toBe(2);
        expect(await titleOf(t, NOT_GERMAN, withGerman)).toBe("renamed");
        expect(await titleOf(t, NOT_GERMAN, englishOnly)).toBe("renamed");
      });
    });
  }
);
