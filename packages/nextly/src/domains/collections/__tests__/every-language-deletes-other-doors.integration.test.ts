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
 * A collection's delete cell in the capabilities answer names no entry, so it
 * cannot know which languages a delete would remove: it is a hint, yes where
 * the rule allows some language, in whichever language the request names, and
 * no only where it allows none.
 *
 * A delete inside the caller's own transaction, through the entry service, is
 * asked the same way, also when the companion's readiness is not yet known.
 * The languages a delete asks are those the entry holds and the site still
 * configures: a row left in a removed language asks nothing more, and an
 * entry holding no translation row asks once, as a single delete and a batch
 * delete alike. A collection whose fields reach a localized field group is
 * asked in every language, an English-only entry included.
 *
 * @module domains/collections/__tests__/every-language-deletes-other-doors.integration.test
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { grantPublic } from "../../../__tests__/helpers/public-role";
import { clearRuleFilterReports } from "../../../auth/access/rule-answer";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import { forgetCompanionReadiness } from "../../../domains/i18n/runtime/companion-readiness";
import { NextlyError } from "../../../errors/nextly-error";
import { definePlugin } from "../../../plugins/plugin-context";
import type { PluginRouteContext } from "../../../plugins/routes/route-types";
import type { ServiceOpts } from "../../../plugins/service-opts";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { AccessControlContext } from "../../../shared/types/access";
import type { AuthUserId } from "../../../types/auth";

// Integration files share fixed system-table names, so this file keeps its
// own slugs.
// A delete rule refusing German.
const NOT_GERMAN = "otherdoors_not_german";
// A delete rule allowing every language: the control.
const ANY_LANGUAGE = "otherdoors_any_language";
// A delete rule refusing every language.
const NO_LANGUAGE = "otherdoors_no_language";
// A delete rule allowing English alone, which answers no when it is told no
// language, so a cell asked that way would refuse what a delete allows.
const ONLY_ENGLISH = "otherdoors_only_english";
// A delete rule refusing German, over fields reaching a localized field group.
const GROUPED = "otherdoors_grouped";
const SEO = "otherdoors_seo";

const AUTHOR = "otherdoors-author";
const LANGUAGES = { locales: ["en", "de"], defaultLocale: "en" };
const SLUGS = [NOT_GERMAN, ANY_LANGUAGE, NO_LANGUAGE, ONLY_ENGLISH];

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
  resetSessionStandingForTests();
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
    fieldGroups: [
      defineFieldGroup({
        slug: SEO,
        localized: true,
        fields: [text({ name: "metaTitle" })],
      }),
    ],
    collections: [
      collection(NOT_GERMAN, notGerman),
      collection(ANY_LANGUAGE, () => true),
      collection(NO_LANGUAGE, () => false),
      collection(ONLY_ENGLISH, context => context.locale === "en"),
      defineCollection({
        slug: GROUPED,
        localized: true,
        access: { read: () => true, delete: notGerman },
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "seo", component: SEO }),
        ],
      }),
    ],
  });
  const all = [...SLUGS, GROUPED];
  await userWhoMay(current, AUTHOR, "read", all);
  await grantTo(current, AUTHOR, "delete", all);
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

const asAuthor: ServiceOpts = {
  as: "user",
  user: { id: AUTHOR as AuthUserId, email: `${AUTHOR}@example.test` },
};

const entriesOf = (t: TestNextly) =>
  t
    .getService("collectionsHandler")
    .getEntryService() as CollectionEntryService;

/** The author, as an entry service call names its caller. */
const author = { id: AUTHOR };

/**
 * The status a delete in the caller's own transaction refused with, or
 * "deleted": a returned failure and a thrown one alike.
 */
async function deletedInTransaction(
  t: TestNextly,
  collection: string,
  id: string
): Promise<number | string> {
  try {
    const result = await t.adapter.transaction(tx =>
      entriesOf(t).deleteEntryInTransaction(tx, {
        collectionName: collection,
        entryId: id,
        user: author,
        overrideAccess: false,
      })
    );
    return result.success ? "deleted" : (result.statusCode ?? "failed");
  } catch (error) {
    if (NextlyError.is(error)) return error.statusCode;
    throw error;
  }
}

/** Removes every translation row `id` holds in `collection`. */
async function dropTranslations(
  t: TestNextly,
  collection: string,
  id: string
): Promise<void> {
  const translations = `dc_${collection}_locales`;
  const ofThisEntry = {
    and: [{ column: "_parent", op: "=" as const, value: id }],
  };
  await t.adapter.delete(translations, ofThisEntry);
  expect(
    await t.adapter.select(translations, { where: ofThisEntry })
  ).toHaveLength(0);
}

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

/** The author's delete cell for each collection, as `?locale=` names it. */
async function deleteCells(locale: string): Promise<Record<string, unknown>> {
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
  const path = ["me", "capabilities"];
  const res = await createDynamicHandlers().GET(
    new Request(`http://localhost/api/${path.join("/")}?locale=${locale}`, {
      headers: {
        origin: "http://localhost",
        cookie: `nextly_session=${token}`,
      },
    }),
    { params: Promise.resolve({ params: path }) }
  );
  expect(res.status).toBe(200);
  const { entities } = (await res.json()) as {
    entities: Record<string, { delete?: unknown }>;
  };
  return Object.fromEntries(SLUGS.map(slug => [slug, entities[slug]?.delete]));
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

      // SQLite only: under `as: "user"` the plugin service resolves the
      // caller's roles on the pool while its own transaction is open, so on
      // PostgreSQL and MySQL those lookups run outside it, which the harness
      // refuses. The caller-transaction cases below run on every database.
      it.skipIf(dialect !== "sqlite")(
        "refuses it inside the plugin's own transaction too, and deletes one with none",
        async () => {
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
                c.deleteEntryInTransaction(
                  tx,
                  NOT_GERMAN,
                  englishOnly,
                  asAuthor
                )
              )
            )
          ).toBe("deleted");
          expect(
            await remaining(t, NOT_GERMAN, [withGerman, englishOnly])
          ).toEqual([true, false]);
        }
      );

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

    describe("a collection's delete cell", () => {
      it("says yes where the rule allows some language, in either language the request names, and no where it allows none", async () => {
        await boot(dialect);
        const expected = {
          [NOT_GERMAN]: true,
          [ANY_LANGUAGE]: true,
          [NO_LANGUAGE]: false,
          [ONLY_ENGLISH]: true,
        };

        // An English-only entry is one the author may delete under the rules
        // refusing German and allowing English alone, so the cell offers the
        // delete whichever language the admin is shown in.
        expect(await deleteCells("de")).toEqual(expected);
        expect(await deleteCells("en")).toEqual(expected);
      });
    });

    describe("a delete in the caller's own transaction, through the entry service", () => {
      it("refuses deleting an entry with German content under a rule refusing German, and deletes one with none", async () => {
        const t = await boot(dialect);
        const { withGerman, englishOnly } = await seed(t, NOT_GERMAN);

        expect(await deletedInTransaction(t, NOT_GERMAN, withGerman)).toBe(403);
        expect(await deletedInTransaction(t, NOT_GERMAN, englishOnly)).toBe(
          "deleted"
        );
        expect(
          await remaining(t, NOT_GERMAN, [withGerman, englishOnly])
        ).toEqual([true, false]);
      });

      it("deletes in a batch only the entries no language refuses", async () => {
        const t = await boot(dialect);
        const { withGerman, englishOnly } = await seed(t, NOT_GERMAN);

        const result = await t.adapter.transaction(tx =>
          entriesOf(t).deleteEntriesInTransaction(
            tx,
            { collectionName: NOT_GERMAN, user: author },
            [withGerman, englishOnly]
          )
        );

        expect({ ok: result.successful, failed: result.failed }).toEqual({
          ok: 1,
          failed: 1,
        });
        expect(
          await remaining(t, NOT_GERMAN, [withGerman, englishOnly])
        ).toEqual([true, false]);
      });

      it("refuses deleting an entry with German content while the companion's readiness is not yet known", async () => {
        const t = await boot(dialect);
        const { withGerman } = await seed(t, NOT_GERMAN);
        // As after a restart, or once a companion is replaced: nothing is
        // remembered about the translation table, so the delete must read
        // the entry's languages rather than take none.
        forgetCompanionReadiness(t.adapter);

        expect(await deletedInTransaction(t, NOT_GERMAN, withGerman)).toBe(403);
        expect(await stillThere(t, NOT_GERMAN, withGerman)).toBe(true);
      });
    });

    describe("the languages a delete asks", () => {
      it("deletes in a batch an entry holding a row in a language the site no longer configures", async () => {
        const t = await boot(dialect);
        const { withGerman } = await seed(t, ANY_LANGUAGE);
        // The German row relabelled to a language the app no longer
        // configures, as one left behind when a locale is removed.
        await t.adapter.update(
          `dc_${ANY_LANGUAGE}_locales`,
          { _locale: "fr" },
          {
            and: [
              { column: "_parent", op: "=", value: withGerman },
              { column: "_locale", op: "=", value: "de" },
            ],
          }
        );

        const result = await entriesOf(t).deleteEntries(
          { collectionName: ANY_LANGUAGE, user: author },
          [withGerman]
        );

        expect({ ok: result.successful, errors: result.errors }).toEqual({
          ok: 1,
          errors: [],
        });
        expect(await stillThere(t, ANY_LANGUAGE, withGerman)).toBe(false);
      });

      it("allows a single delete and a batch delete alike of an entry holding no translation row", async () => {
        const t = await boot(dialect);
        const single = await entryIn(t, NOT_GERMAN, "untranslated", false);
        const batched = await entryIn(t, NOT_GERMAN, "untranslated too", false);
        // As an entry stored before its collection was localized: no
        // translation row at all, the main row holding its content.
        await dropTranslations(t, NOT_GERMAN, single);
        await dropTranslations(t, NOT_GERMAN, batched);

        expect(
          await outcome(() =>
            t.nextly.delete({
              collection: NOT_GERMAN,
              id: single,
              overrideAccess: false,
              user: author,
            })
          )
        ).toBe("deleted");
        const result = await entriesOf(t).deleteEntries(
          { collectionName: NOT_GERMAN, user: author },
          [batched]
        );
        expect({ ok: result.successful, errors: result.errors }).toEqual({
          ok: 1,
          errors: [],
        });
        expect(await remaining(t, NOT_GERMAN, [single, batched])).toEqual([
          false,
          false,
        ]);
      });

      it("asks every language where the fields reach a localized field group, an English-only entry included", async () => {
        const t = await boot(dialect);
        const englishOnly = await entryIn(t, GROUPED, "english", false);

        // Pinned as it stands: which languages a field group's rows hold is
        // not read, so the delete asks every language and the rule refusing
        // German refuses it. A change to read them changes this on purpose.
        expect(
          await outcome(() =>
            t.nextly.delete({
              collection: GROUPED,
              id: englishOnly,
              overrideAccess: false,
              user: author,
            })
          )
        ).toBe(403);
        expect(await stillThere(t, GROUPED, englishOnly)).toBe(true);
      });
    });
  }
);
