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
// The update rule refuses German and allows every other language.
const NOT_GERMAN = "versionlang_not_german";
const NOT_GERMAN_SINGLE = "versionlang_not_german_single";
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

const notGerman = (context: AccessControlContext) => context.locale !== "de";

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

// The rule answers by the language alone, so these are the route's and the
// gate's logic, on the database every run has.
describe("a write through a document's versions under a rule that refuses German", () => {
  async function boot(): Promise<TestNextly> {
    current = await createTestNextly({
      localization: LANGUAGES,
      collections: [
        defineCollection({
          slug: NOT_GERMAN,
          localized: true,
          status: true,
          versions: { drafts: true },
          access: { read: () => true, update: notGerman },
          fields: [text({ name: "title" }), text({ name: "owner" })],
        }),
      ],
      singles: [
        defineSingle({
          slug: NOT_GERMAN_SINGLE,
          localized: true,
          status: true,
          versions: true,
          access: { read: () => true, update: notGerman },
          fields: [text({ name: "headline", localized: true })],
        }),
      ],
    });
    await userWhoMay(current, AUTHOR, "read", [NOT_GERMAN, NOT_GERMAN_SINGLE]);
    await grantTo(current, AUTHOR, "update", [NOT_GERMAN, NOT_GERMAN_SINGLE]);
    return current;
  }

  it("refuses an update in German and makes one in English", async () => {
    const t = await boot();
    const id = await publishedWithHeldEdits(t, NOT_GERMAN);

    expect(
      await rest("PATCH", entry(NOT_GERMAN, id), { title: "neu" }, "?locale=de")
    ).toBe(403);
    expect(
      await rest("PATCH", entry(NOT_GERMAN, id), { title: "new" }, "?locale=en")
    ).toBe(200);
  });

  it("refuses a restore of a German version, and restores an English one", async () => {
    const t = await boot();
    const id = await publishedWithHeldEdits(t, NOT_GERMAN);

    expect(await restoreIn(t, NOT_GERMAN, id, "de")).toBe(403);
    expect(await restoreIn(t, NOT_GERMAN, id, "en")).toBe(200);
  });

  it("refuses a take of the live values into the German held edit, and takes them into the English one", async () => {
    const t = await boot();
    const id = await publishedWithHeldEdits(t, NOT_GERMAN);

    expect(await takeLiveIn(NOT_GERMAN, id, "de")).toBe(403);
    expect(await takeLiveIn(NOT_GERMAN, id, "en")).toBe(200);
  });

  it("refuses a restore of a Single's German version, and restores its English one", async () => {
    const t = await boot();
    const singles = t.getService("singleEntryService");
    const written = await singles.update(
      NOT_GERMAN_SINGLE,
      { headline: "hello" },
      { overrideAccess: true, locale: "en" }
    );
    expect(written.success).toBe(true);
    const id = String((written.data as { id: unknown }).id);
    expect(
      (
        await singles.update(
          NOT_GERMAN_SINGLE,
          { headline: "hallo" },
          { overrideAccess: true, locale: "de" }
        )
      ).success
    ).toBe(true);
    const ref = {
      scopeKind: "single" as const,
      scopeSlug: NOT_GERMAN_SINGLE,
      entryId: id,
    };
    const restore = async (locale: string) =>
      rest("POST", [
        "singles",
        NOT_GERMAN_SINGLE,
        "versions",
        String(await newestIn(t, ref, locale)),
        "restore",
      ]);

    expect(await restore("de")).toBe(403);
    expect(await restore("en")).toBe(200);
  });
});

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
