/**
 * A REST list or count on a site with several languages, under a read rule
 * that answers a filter, applies the filter in the language the request
 * reads, as the route judged it.
 *
 * The route asks the rule in the request's languages and keeps its verdict
 * under them; the entry service then runs the read it dispatches in the same
 * languages (`readLanguagesFor` on the same locale and fallback), so the read
 * finds that verdict. The property that separates a correct answer from a
 * plausible broken one: a read run in languages the route never judged it in,
 * every configured language say, finds no verdict it may use and is refused
 * (403), so the reader gets nothing rather than the matching entries.
 *
 * @module domains/collections/__tests__/read-rule-filter-rest-list-languages.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { userWhoMay } from "../../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";

// Integration files share fixed system-table names, so this file keeps its
// own collection slug.
const NOTES = "rulefilter_restlang_notes";
const READER = "rulefilter-restlang-reader";
const ORIGIN = "http://localhost";

/** A read rule answering `value`, which the rule type does not allow yet. */
const answering = (value: unknown) => () => value as boolean;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(): Promise<TestNextly> {
  const t = await createTestNextly({
    localization: { locales: ["en", "fr", "de"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: NOTES,
        localized: true,
        fields: [text({ name: "title" }), text({ name: "team" })],
        access: { read: answering({ team: { equals: "public" } }) },
      }),
    ],
  });
  current = t;
  // The rule narrows the read permission, so the reader holds it.
  await userWhoMay(t, READER, "read", [NOTES]);
  // Each entry in English, the default, and in French, so a list in either
  // language has rows for the filter to match.
  for (const [title, team] of [
    ["public-1", "public"],
    ["public-2", "public"],
    ["staff-1", "staff"],
  ]) {
    const made = await t.nextly.create({
      collection: NOTES,
      data: { title, team },
    });
    await t.nextly.update({
      collection: NOTES,
      id: String((made.item as { id: string | number }).id),
      locale: "fr",
      data: { title, team },
    });
  }
  return t;
}

/** The reader's REST read of `segments`, with `query`: status and body. */
async function readOver(
  segments: string[],
  query: string
): Promise<{ status: number; body: unknown }> {
  const token = await signAccessToken(
    buildClaims({
      userId: READER,
      email: `${READER}@example.test`,
      name: READER,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  const res = await createDynamicHandlers().GET(
    new Request(`${ORIGIN}/api/${segments.join("/")}${query}`, {
      headers: { origin: ORIGIN, cookie: `nextly_session=${token}` },
    }),
    { params: Promise.resolve({ params: segments }) }
  );
  return { status: res.status, body: await res.json() };
}

const titlesOf = (body: unknown) =>
  ((body as { items?: { title?: unknown }[] }).items ?? [])
    .map(item => item.title)
    .sort();

describe("a REST list on a site with several languages, under a read rule's filter", () => {
  it.each([
    ["the default language", "?locale=en"],
    ["a named language", "?locale=fr"],
    ["no language named", ""],
  ])("lists the matching entries in %s", async (_, query) => {
    await boot();
    const { status, body } = await readOver(
      ["collections", NOTES, "entries"],
      query
    );
    expect(status).toBe(200);
    expect(titlesOf(body)).toEqual(["public-1", "public-2"]);
  });

  it("counts the matching entries in a named language", async () => {
    await boot();
    const { status, body } = await readOver(
      ["collections", NOTES, "entries", "count"],
      "?locale=fr"
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ total: 2 });
  });
});
