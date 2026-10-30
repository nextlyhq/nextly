/**
 * A delete removes every language an entry holds, so its rule is asked in
 * each of them on the doors beside the Direct API and the admin's signed-in
 * REST: a plugin's collection service, and a visitor's REST delete.
 *
 * Under a delete rule refusing German, a plugin service acting as a signed-in
 * user is refused deleting an entry with German content, inside a transaction
 * of its own or not, and still deletes an entry with none. A rule allowing
 * every language deletes either. A visitor's REST delete is still judged by
 * the Public role: refused as needing a signed-in caller where Public does not
 * grant the delete, and, where it does, asked in each language the entry
 * holds, as a signed-in caller's delete is.
 *
 * @module domains/collections/__tests__/every-language-deletes-other-doors.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { grantPublic } from "../../../__tests__/helpers/public-role";
import { clearRuleFilterReports } from "../../../auth/access/rule-answer";
import { defineCollection, text } from "../../../config";
import { NextlyError } from "../../../errors/nextly-error";
import { definePlugin } from "../../../plugins/plugin-context";
import type { PluginRouteContext } from "../../../plugins/routes/route-types";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import type { AccessControlContext } from "../../../shared/types/access";

// Integration files share fixed system-table names, so this file keeps its
// own slugs.
// A delete rule refusing German.
const NOT_GERMAN = "otherdoors_not_german";
// A delete rule allowing every language: the control.
const ANY_LANGUAGE = "otherdoors_any_language";

const AUTHOR = "otherdoors-author";
const LANGUAGES = { locales: ["en", "de"], defaultLocale: "en" };
const SLUGS = [NOT_GERMAN, ANY_LANGUAGE];

/** The collection service a plugin is handed, kept from its `init`. */
let services: PluginRouteContext["services"]["collections"] | undefined;

const probe = definePlugin({
  name: "otherdoors-probe",
  version: "1.0.0",
  nextly: ">=0.0.1",
  init: ctx => {
    services = ctx.services.collections;
  },
});

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  services = undefined;
  clearRuleFilterReports();
});

const notGerman = (context: AccessControlContext): boolean =>
  context.locale !== "de";

async function boot(dialect: TestDialect): Promise<TestNextly> {
  const collection = (
    slug: string,
    rule: (context: AccessControlContext) => boolean
  ) =>
    defineCollection({
      slug,
      localized: true,
      access: { read: () => true, delete: rule },
      fields: [text({ name: "title" })],
    });
  current = await createTestNextly({
    dialect,
    localization: LANGUAGES,
    // The visitor cases are judged by the Public role a real boot makes.
    seedPublic: true,
    plugins: [probe],
    collections: [
      collection(NOT_GERMAN, notGerman),
      collection(ANY_LANGUAGE, () => true),
    ],
  });
  await userWhoMay(current, AUTHOR, "read", SLUGS);
  await grantTo(current, AUTHOR, "delete", SLUGS);
  return current;
}

/**
 * An entry of `collection` with an English row and, where `german`, a German
 * one too; its id.
 */
async function entryIn(
  t: TestNextly,
  collection: string,
  title: string,
  german: boolean
): Promise<string> {
  const made = await t.nextly.create({ collection, data: { title } });
  const id = String(made.item.id);
  if (german) {
    await t.nextly.update({
      collection,
      id,
      locale: "de",
      data: { title: `${title} de` },
    } as never);
  }
  return id;
}

/** An entry with German content, and one with English alone. */
async function seed(t: TestNextly, collection: string) {
  return {
    withGerman: await entryIn(t, collection, "both", true),
    englishOnly: await entryIn(t, collection, "english", false),
  };
}

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

/** The status a plugin service call refused with, or "deleted". */
async function outcome(call: () => Promise<unknown>): Promise<number | string> {
  try {
    await call();
  } catch (error) {
    if (NextlyError.is(error)) return error.statusCode;
    throw error;
  }
  return "deleted";
}

const asAuthor = {
  as: "user",
  user: { id: AUTHOR, email: `${AUTHOR}@example.test` },
} as const;

/** The status of a visitor's REST delete of `id`: no session, no key. */
async function visitorDelete(collection: string, id: string): Promise<number> {
  const path = ["collections", collection, "entries", id];
  const res = await createDynamicHandlers().DELETE(
    new Request(`http://localhost/api/${path.join("/")}`, {
      method: "DELETE",
      headers: { origin: "http://localhost" },
    }),
    { params: Promise.resolve({ params: path }) }
  );
  return res.status;
}

// Each language's rule is asked, and each entry's languages read, in SQL on
// each database this run reaches.
describe.each(getConfiguredTestDialects())(
  "a delete changing every language, through the other doors (%s)",
  (dialect: TestDialect) => {
    describe("a plugin's collection service, as a signed-in user", () => {
      it("refuses deleting an entry with German content under a rule refusing German, and deletes one with none", async () => {
        const t = await boot(dialect);
        const { withGerman, englishOnly } = await seed(t, NOT_GERMAN);
        const c = services!;

        expect(
          await outcome(() => c.deleteEntry(NOT_GERMAN, withGerman, asAuthor))
        ).toBe(403);
        expect(
          await outcome(() => c.deleteEntry(NOT_GERMAN, englishOnly, asAuthor))
        ).toBe("deleted");
        expect(
          await remaining(t, NOT_GERMAN, [withGerman, englishOnly])
        ).toEqual([true, false]);
      });

      it("refuses it inside the plugin's own transaction too, and deletes one with none", async () => {
        const t = await boot(dialect);
        const { withGerman, englishOnly } = await seed(t, NOT_GERMAN);
        const c = services!;

        expect(
          await outcome(() =>
            c.withTransaction(tx =>
              c.deleteEntryInTransaction(tx, NOT_GERMAN, withGerman, asAuthor)
            )
          )
        ).toBe(403);
        expect(
          await outcome(() =>
            c.withTransaction(tx =>
              c.deleteEntryInTransaction(tx, NOT_GERMAN, englishOnly, asAuthor)
            )
          )
        ).toBe("deleted");
        expect(
          await remaining(t, NOT_GERMAN, [withGerman, englishOnly])
        ).toEqual([true, false]);
      });

      it("deletes an entry with German content under a rule allowing every language", async () => {
        const t = await boot(dialect);
        const { withGerman } = await seed(t, ANY_LANGUAGE);

        expect(
          await outcome(() =>
            services!.deleteEntry(ANY_LANGUAGE, withGerman, asAuthor)
          )
        ).toBe("deleted");
        expect(await stillThere(t, ANY_LANGUAGE, withGerman)).toBe(false);
      });
    });

    describe("a visitor's REST delete", () => {
      it("is refused as needing a signed-in caller where the Public role grants no delete", async () => {
        const t = await boot(dialect);
        const { withGerman, englishOnly } = await seed(t, ANY_LANGUAGE);

        expect(await visitorDelete(ANY_LANGUAGE, withGerman)).toBe(401);
        expect(await visitorDelete(ANY_LANGUAGE, englishOnly)).toBe(401);
        expect(
          await remaining(t, ANY_LANGUAGE, [withGerman, englishOnly])
        ).toEqual([true, true]);
      });

      it("is asked in each language the entry holds where the Public role grants the delete", async () => {
        const t = await boot(dialect);
        await grantPublic(t, [`delete-${NOT_GERMAN}`]);
        const { withGerman, englishOnly } = await seed(t, NOT_GERMAN);

        expect(await visitorDelete(NOT_GERMAN, withGerman)).toBe(403);
        expect(await visitorDelete(NOT_GERMAN, englishOnly)).toBe(200);
        expect(
          await remaining(t, NOT_GERMAN, [withGerman, englishOnly])
        ).toEqual([true, false]);
      });
    });
  }
);
