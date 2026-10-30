/**
 * A write an editor makes through a document's versions is judged by its
 * update rule in the language it writes, as an update in that language is.
 *
 * A rule may answer by language. Told every language at once, it is told no
 * one language, so a rule that refuses one language answers as if the write
 * were in none of them. A restore writes the restored version's language and
 * a take of the live values the language of the held edit, so each is asked
 * in that language: refused where the rule refuses it there, and let through
 * where the rule lets it through there, its filter matched in that language.
 *
 * @module domains/collections/__tests__/version-writes-rule-language.integration.test
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import type { AccessControlContext } from "../../../shared/types/access";
import type { VersionScopeKind } from "../../../schemas/versions/types";
import { VersionsRepository } from "../../versions/versions-repository";

// Integration files share fixed system-table names, so this file keeps its
// own slugs.
// An update rule answering by the language alone.
const BY_LANGUAGE = "versionlang_by_language";
const BY_LANGUAGE_SINGLE = "versionlang_by_language_single";
// Filters answered by language: the author's own entries in German and none
// in English, or the reverse.
const OWN_IN_GERMAN = "versionlang_own_in_german";
const NONE_IN_GERMAN = "versionlang_none_in_german";

const AUTHOR = "versionlang-author";
const LANGUAGES = { locales: ["en", "de"], defaultLocale: "en" };

let current: TestNextly | undefined;
afterEach(async () => {
  resetSessionStandingForTests();
  await current?.destroy();
  current = undefined;
});

/** "Only the caller's own" where `allowed`, else "nothing": filters over `owner`. */
const ownWhere =
  (allowed: (locale: string | undefined) => boolean) =>
  (context: AccessControlContext) =>
    ({
      owner: {
        equals: allowed(context.locale) ? (context.user?.id ?? "") : "nobody",
      },
    }) as unknown as boolean;

/**
 * Publishes `id` of `collection` in English and German as the author's, then
 * holds an edit of it in each.
 */
async function publishedWithHeldEdits(
  t: TestNextly,
  collection: string
): Promise<string> {
  const made = await t.nextly.create({
    collection,
    data: { title: "english", owner: AUTHOR, status: "published" },
  });
  const id = String(made.item.id);
  await t.nextly.update({
    collection,
    id,
    locale: "de",
    data: { title: "deutsch", owner: AUTHOR, status: "published" },
  } as never);
  for (const locale of ["en", "de"]) {
    await t.nextly.update({
      collection,
      id,
      locale,
      data: { title: `held ${locale}` },
    } as never);
  }
  return id;
}

/** The newest durable version of a document in `locale`. */
async function newestIn(
  t: TestNextly,
  ref: { scopeKind: VersionScopeKind; scopeSlug: string; entryId: string },
  locale: string
): Promise<number> {
  const versionNo = (
    await new VersionsRepository(t.adapter).newestVersionNoByLocale(ref, [
      locale,
    ])
  ).get(locale);
  expect(versionNo).toBeDefined();
  return versionNo!;
}

/** The status of a REST request the author signs. */
async function rest(
  method: "PATCH" | "POST",
  path: string[],
  body?: unknown,
  query = ""
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
    new Request(`http://localhost/api/${path.join("/")}${query}`, {
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

const entry = (collection: string, id: string) => [
  "collections",
  collection,
  "entries",
  id,
];

/** Restores `id`'s newest version in `locale`. */
async function restoreIn(
  t: TestNextly,
  collection: string,
  id: string,
  locale: string
): Promise<number> {
  const versionNo = await newestIn(
    t,
    { scopeKind: "collection", scopeSlug: collection, entryId: id },
    locale
  );
  return rest("POST", [
    ...entry(collection, id),
    "versions",
    String(versionNo),
    "restore",
  ]);
}

/** Takes the live values into `id`'s held edit in `locale`. */
const takeLiveIn = (collection: string, id: string, locale: string) =>
  rest(
    "POST",
    [...entry(collection, id), "versions", "working-draft", "take-live"],
    {},
    `?locale=${locale}`
  );

// Each rule is answered in the language a write changes: one refusing German
// refuses only German writes, and one allowing only German allows only those.
// On each database this run reaches.
describe.each(getConfiguredTestDialects())(
  "a write through a document's versions, on %s",
  (dialect: TestDialect) => {
    describe.each([
      {
        rule: "refuses German",
        update: (context: AccessControlContext) => context.locale !== "de",
        german: 403,
        english: 200,
      },
      {
        rule: "allows only German",
        update: (context: AccessControlContext) => context.locale === "de",
        german: 200,
        english: 403,
      },
    ])(
      "a write through a document's versions under a rule that $rule",
      ({ update, german, english }) => {
        async function boot(): Promise<TestNextly> {
          current = await createTestNextly({
            dialect,
            localization: LANGUAGES,
            collections: [
              defineCollection({
                slug: BY_LANGUAGE,
                localized: true,
                status: true,
                versions: { drafts: true },
                access: { read: () => true, update },
                fields: [text({ name: "title" }), text({ name: "owner" })],
              }),
            ],
            singles: [
              defineSingle({
                slug: BY_LANGUAGE_SINGLE,
                localized: true,
                status: true,
                versions: { drafts: true },
                access: { read: () => true, update },
                fields: [text({ name: "headline", localized: true })],
              }),
            ],
          });
          const resources = [BY_LANGUAGE, BY_LANGUAGE_SINGLE];
          await userWhoMay(current, AUTHOR, "read", resources);
          await grantTo(current, AUTHOR, "update", resources);
          return current;
        }

        /** The Single published in English and German, with a held edit in each; its id. */
        async function singleWithHeldEdits(t: TestNextly): Promise<string> {
          const singles = t.getService("singleEntryService");
          let id = "";
          for (const locale of ["en", "de"]) {
            const written = await singles.update(
              BY_LANGUAGE_SINGLE,
              { headline: `live ${locale}`, status: "published" },
              { overrideAccess: true, locale }
            );
            expect(written.success).toBe(true);
            id = String((written.data as { id: unknown }).id);
          }
          for (const locale of ["en", "de"]) {
            expect(
              (
                await singles.update(
                  BY_LANGUAGE_SINGLE,
                  { headline: `held ${locale}` },
                  { overrideAccess: true, locale }
                )
              ).success
            ).toBe(true);
          }
          return id;
        }

        it("answers an update in each language as the rule does there", async () => {
          const t = await boot();
          const id = await publishedWithHeldEdits(t, BY_LANGUAGE);
          const patch = (locale: string) =>
            rest(
              "PATCH",
              entry(BY_LANGUAGE, id),
              { title: locale },
              `?locale=${locale}`
            );

          expect(await patch("de")).toBe(german);
          expect(await patch("en")).toBe(english);
        });

        it("answers a restore of each language's version as the rule does there", async () => {
          const t = await boot();
          const id = await publishedWithHeldEdits(t, BY_LANGUAGE);

          expect(await restoreIn(t, BY_LANGUAGE, id, "de")).toBe(german);
          expect(await restoreIn(t, BY_LANGUAGE, id, "en")).toBe(english);
        });

        it("answers a take of the live values into each language's held edit as the rule does there", async () => {
          const t = await boot();
          const id = await publishedWithHeldEdits(t, BY_LANGUAGE);

          expect(await takeLiveIn(BY_LANGUAGE, id, "de")).toBe(german);
          expect(await takeLiveIn(BY_LANGUAGE, id, "en")).toBe(english);
        });

        it("answers a restore of each language's version of a Single as the rule does there", async () => {
          const t = await boot();
          const id = await singleWithHeldEdits(t);
          const ref = {
            scopeKind: "single" as const,
            scopeSlug: BY_LANGUAGE_SINGLE,
            entryId: id,
          };
          const restore = async (locale: string) =>
            rest("POST", [
              "singles",
              BY_LANGUAGE_SINGLE,
              "versions",
              String(await newestIn(t, ref, locale)),
              "restore",
            ]);

          expect(await restore("de")).toBe(german);
          expect(await restore("en")).toBe(english);
        });

        it("answers a take of the live values into each language's held edit of a Single as the rule does there", async () => {
          const t = await boot();
          await singleWithHeldEdits(t);
          const takeLive = (locale: string) =>
            rest(
              "POST",
              [
                "singles",
                BY_LANGUAGE_SINGLE,
                "versions",
                "working-draft",
                "take-live",
              ],
              {},
              `?locale=${locale}`
            );

          expect(await takeLive("de")).toBe(german);
          expect(await takeLive("en")).toBe(english);
        });
      }
    );
  }
);

// The filter each language's rule answers is matched in SQL, on each
// database this run reaches.
describe.each(getConfiguredTestDialects())(
  "a write through an entry's versions under a filter answered by language (%s)",
  (dialect: TestDialect) => {
    async function boot(): Promise<TestNextly> {
      const fields = [text({ name: "title" }), text({ name: "owner" })];
      current = await createTestNextly({
        dialect,
        localization: LANGUAGES,
        collections: [
          defineCollection({
            slug: OWN_IN_GERMAN,
            localized: true,
            status: true,
            versions: { drafts: true },
            access: {
              read: () => true,
              update: ownWhere(locale => locale === "de"),
            },
            fields,
          }),
          defineCollection({
            slug: NONE_IN_GERMAN,
            localized: true,
            status: true,
            versions: { drafts: true },
            access: {
              read: () => true,
              update: ownWhere(locale => locale !== "de"),
            },
            fields,
          }),
        ],
      });
      await userWhoMay(current, AUTHOR, "read", [
        OWN_IN_GERMAN,
        NONE_IN_GERMAN,
      ]);
      await grantTo(current, AUTHOR, "update", [OWN_IN_GERMAN, NONE_IN_GERMAN]);
      return current;
    }

    it("restores a German version the German filter matches, and refuses one it does not", async () => {
      const t = await boot();
      const matched = await publishedWithHeldEdits(t, OWN_IN_GERMAN);
      const unmatched = await publishedWithHeldEdits(t, NONE_IN_GERMAN);

      expect(await restoreIn(t, OWN_IN_GERMAN, matched, "de")).toBe(200);
      expect(await restoreIn(t, NONE_IN_GERMAN, unmatched, "de")).toBe(403);
    });

    it("takes the live values into a German held edit the German filter matches, and refuses one it does not", async () => {
      const t = await boot();
      const matched = await publishedWithHeldEdits(t, OWN_IN_GERMAN);
      const unmatched = await publishedWithHeldEdits(t, NONE_IN_GERMAN);

      expect(await takeLiveIn(OWN_IN_GERMAN, matched, "de")).toBe(200);
      expect(await takeLiveIn(NONE_IN_GERMAN, unmatched, "de")).toBe(403);
    });
  }
);
