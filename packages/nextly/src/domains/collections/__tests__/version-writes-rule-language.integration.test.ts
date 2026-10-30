/**
 * A write an editor makes through an entry's versions is judged by its update
 * rule in the language it writes, as an update in that language is.
 *
 * A rule may answer by language. Told every language at once, it is told no
 * one language, so a rule that refuses one language answers as if the write
 * were in none of them. A restore writes the restored version's language and
 * a take of the live values the language of the held edit, so each is asked
 * in that language.
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
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import type { AccessControlContext } from "../../../shared/types/access";
import { VersionsRepository } from "../../versions/versions-repository";

// Integration files share fixed system-table names, so this file keeps its
// own collection slug.
const SLUG = "versionlang_posts";
const AUTHOR = "versionlang-author";

let current: TestNextly | undefined;
afterEach(async () => {
  resetSessionStandingForTests();
  await current?.destroy();
  current = undefined;
});

/**
 * A localized collection whose update rule refuses German, with a published
 * entry in English and German and a held edit in German. The author may read
 * and update it.
 */
async function boot(): Promise<{ t: TestNextly; id: string }> {
  current = await createTestNextly({
    localization: { locales: ["en", "de"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: SLUG,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: {
          read: () => true,
          update: (context: AccessControlContext) => context.locale !== "de",
        },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  const t = current;
  await userWhoMay(t, AUTHOR, "read", [SLUG]);
  await grantTo(t, AUTHOR, "update", [SLUG]);
  const made = await t.nextly.create({
    collection: SLUG,
    data: { title: "english", status: "published" },
  });
  const id = String(made.item.id);
  await t.nextly.update({
    collection: SLUG,
    id,
    locale: "de",
    data: { title: "deutsch", status: "published" },
  } as never);
  await t.nextly.update({
    collection: SLUG,
    id,
    locale: "de",
    data: { title: "entwurf" },
  } as never);
  return { t, id };
}

/** The newest durable version of `id` in `locale`. */
async function newestIn(
  t: TestNextly,
  id: string,
  locale: string
): Promise<number> {
  const versionNo = (
    await new VersionsRepository(t.adapter).newestVersionNoByLocale(
      { scopeKind: "collection", scopeSlug: SLUG, entryId: id },
      [locale]
    )
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

const entry = (id: string) => ["collections", SLUG, "entries", id];

describe("a write through an entry's versions, judged in the language it writes", () => {
  it("refuses an update in German, as the rule says", async () => {
    const { id } = await boot();

    expect(await rest("PATCH", entry(id), { title: "neu" }, "?locale=de")).toBe(
      403
    );
    expect(await rest("PATCH", entry(id), { title: "new" }, "?locale=en")).toBe(
      200
    );
  });

  it("refuses a restore of a German version, and restores an English one", async () => {
    const { t, id } = await boot();
    const german = await newestIn(t, id, "de");
    const english = await newestIn(t, id, "en");

    expect(
      await rest("POST", [...entry(id), "versions", String(german), "restore"])
    ).toBe(403);
    expect(
      await rest("POST", [...entry(id), "versions", String(english), "restore"])
    ).toBe(200);
  });

  it("refuses a take of the live values into the German held edit", async () => {
    const { id } = await boot();

    expect(
      await rest(
        "POST",
        [...entry(id), "versions", "working-draft", "take-live"],
        {},
        "?locale=de"
      )
    ).toBe(403);
  });
});
