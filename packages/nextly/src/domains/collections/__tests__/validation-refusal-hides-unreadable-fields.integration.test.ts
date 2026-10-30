/**
 * A validation refusal says nothing about a field its caller may not read.
 *
 * A publish validates the whole stored document, fields the caller cannot
 * read included. Named in the refusal, such a field's issue tells the caller
 * about its hidden value: "must be at most 10" says it is over 10, "is
 * required" that it is empty, and a validator's own message can carry the
 * value itself. Each way in that publishes is asked here, by a publisher who
 * may not read three such fields and may read one that is also invalid: the
 * hidden ones are reported only as one generic issue, the readable one as it
 * is. A caller who may read every field, and trusted code, are told every
 * issue.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  number,
  text,
} from "../../../config";
import type { SingleEntryService } from "../../singles/services/single-entry-service";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";

// Integration files share fixed system-table names, so this file keeps its
// own slugs.
const ENTRIES = "hiddenfieldreports";
const BANNER = "hiddenfieldbanner";
const PUBLISHER = { id: "hidden-publisher", isActive: true };
const READER = { id: "hidden-reader", isActive: true };
/** May create, update and publish both, but read neither. */
const WRITER = { id: "hidden-writer", isActive: true };
/** A field group whose one field READER alone may read. */
const META = "hiddenfieldmeta";
// A collection and a Single with a field no German read shows, and a Single
// no German read shows at all.
const LANG_ENTRIES = "hiddenfieldlangreports";
const LANG_BANNER = "hiddenfieldlangbanner";
const LANG_HIDDEN = "hiddenfieldlanghidden";
const LANG_SLUGS = [LANG_ENTRIES, LANG_BANNER, LANG_HIDDEN];
/** Readable in every language but German. */
const notGerman = ({ locale }: { locale?: string }) => locale !== "de";
const ALLOW = () => true;

// The stored values the schema now refuses, as left by a schema that has
// since tightened: a score over the cap, an empty required note, and a code
// whose validator names it.
const SECRET = "TOPSECRET-4411";

/**
 * Readable by READER alone, and only while their grants include the Single's
 * unpublish: a key READER made without it may not read these fields.
 */
const readerOnly = {
  read: ({
    user,
    permissions,
  }: {
    user?: { id?: unknown } | null;
    permissions: readonly string[];
  }) => user?.id === READER.id && permissions.includes(`unpublish-${BANNER}`),
};

/** A validator that names the value it refuses. */
const namesTheValue = (value: unknown) =>
  typeof value === "string" && value.length > 5
    ? `Code ${value} is not allowed`
    : true;

const fields = () => [
  text({ name: "headline" }),
  fieldGroup({ name: "meta", component: META }),
  number({ name: "visibleCount", max: 5 }),
  number({ name: "internalScore", max: 10, access: readerOnly }),
  text({ name: "internalNote", required: true, access: readerOnly }),
  text({
    name: "secretCode",
    access: readerOnly,
    validate: namesTheValue,
  }),
];

/** A field only a German read hides, whose validator names its value. */
const languageFields = () => [
  text({ name: "headline" }),
  text({
    name: "germanOnly",
    access: { read: notGerman },
    validate: namesTheValue,
  }),
  number({ name: "shownCount", max: 5 }),
];

const GENERIC = {
  path: "",
  code: "UNREADABLE_FIELD",
  message: "A field you can't see doesn't pass validation.",
};
const VISIBLE = {
  path: "visibleCount",
  code: "TOO_HIGH",
  message: "visibleCount must be at most 5.",
};

interface Issue {
  path: string;
  code: string;
  message: string;
}

/** The issues a refusal reports, however the path returns it. */
async function issuesOf(run: () => Promise<unknown>): Promise<Issue[]> {
  try {
    const result = await run();
    if (result instanceof Map) return [...result.values()].flat() as Issue[];
    const record = result as {
      success?: boolean;
      issues?: Issue[];
      publicData?: { errors?: Issue[] };
    };
    if (record.issues) return record.issues;
    expect(record.success).toBe(false);
    return record.publicData?.errors ?? [];
  } catch (error) {
    const thrown = error as {
      statusCode?: number;
      publicData?: { errors?: Issue[] };
    };
    expect(thrown.statusCode).toBe(400);
    return thrown.publicData?.errors ?? [];
  }
}

/** Every issue, told as it is. */
function expectEveryIssue(issues: Issue[]) {
  expect(issues).toEqual(
    expect.arrayContaining([
      VISIBLE,
      expect.objectContaining({ path: "internalScore", code: "TOO_HIGH" }),
      expect.objectContaining({ path: "internalNote", code: "REQUIRED" }),
      expect.objectContaining({
        path: "secretCode",
        message: `Code ${SECRET} is not allowed.`,
      }),
    ])
  );
}

/** The readable issue, and the hidden ones as one generic issue. */
function expectHiddenCollapsed(issues: Issue[]) {
  expect(issues).toHaveLength(2);
  expect(issues).toEqual(expect.arrayContaining([VISIBLE, GENERIC]));
  const told = JSON.stringify(issues);
  for (const hidden of ["internal", "secret", SECRET, "at most 10"]) {
    expect(told.toLowerCase()).not.toContain(hidden.toLowerCase());
  }
}

describe.each(getConfiguredTestDialects())(
  "a validation refusal names no field the caller can't read (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let entryId = "";
    let langEntryId = "";

    beforeAll(async () => {
      t = await createTestNextly({
        dialect,
        localization: { locales: ["en", "de"], defaultLocale: "en" },
        fieldGroups: [
          defineFieldGroup({
            slug: META,
            fields: [
              text({
                name: "metaCode",
                access: readerOnly,
                validate: namesTheValue,
              }),
            ],
          }),
        ],
        collections: [
          defineCollection({
            slug: ENTRIES,
            localized: true,
            status: true,
            access: {
              create: ALLOW,
              read: ALLOW,
              update: ALLOW,
              publish: ALLOW,
              unpublish: ALLOW,
            },
            fields: fields(),
          }),
          defineCollection({
            slug: LANG_ENTRIES,
            localized: true,
            status: true,
            access: {
              create: ALLOW,
              read: ALLOW,
              update: ALLOW,
              publish: ALLOW,
            },
            fields: languageFields(),
          }),
        ],
        singles: [
          defineSingle({
            slug: BANNER,
            localized: true,
            status: true,
            access: { read: ALLOW, update: ALLOW, publish: ALLOW },
            fields: fields(),
          }),
          defineSingle({
            slug: LANG_BANNER,
            localized: true,
            status: true,
            access: { read: ALLOW, update: ALLOW, publish: ALLOW },
            fields: languageFields(),
          }),
          defineSingle({
            slug: LANG_HIDDEN,
            localized: true,
            status: true,
            access: { read: notGerman, update: ALLOW, publish: ALLOW },
            fields: languageFields(),
          }),
        ],
      });
      const granted = [ENTRIES, BANNER, ...LANG_SLUGS];
      for (const caller of [PUBLISHER, READER]) {
        await userWhoMay(t, caller.id, "read", granted);
        for (const action of ["create", "update", "publish", "unpublish"]) {
          await grantTo(t, caller.id, action, granted);
        }
      }
      await userWhoMay(t, WRITER.id, "update", [ENTRIES, BANNER]);
      for (const action of ["create", "publish", "unpublish"]) {
        await grantTo(t, WRITER.id, action, [ENTRIES, BANNER]);
      }

      // A valid draft of each, written by trusted code...
      const valid = {
        headline: "h",
        visibleCount: 1,
        internalScore: 1,
        internalNote: "ok",
        secretCode: "ok",
      };
      const made = await t.nextly.create({
        collection: ENTRIES,
        data: { ...valid, status: "draft" },
      });
      entryId = String(made.item.id);
      await singles(t).update(BANNER, valid, { overrideAccess: true });
      const banner = await t.nextly.findSingle({ slug: BANNER });
      const bannerId = String((banner as unknown as { id: unknown }).id);

      // ...then stored values the schema now refuses, as a tightened schema
      // leaves them: shared values on the main row, translated ones on the
      // default language's row.
      for (const [table, id] of [
        [`dc_${ENTRIES}`, entryId],
        [`single_${BANNER}`, bannerId],
      ] as const) {
        await t.adapter.update(
          table,
          { visible_count: 9, internal_score: 57 },
          { and: [{ column: "id", op: "=", value: id }] }
        );
        await t.adapter.update(
          `${table}_locales`,
          { internal_note: "", secret_code: SECRET },
          { and: [{ column: "_parent", op: "=", value: id }] }
        );
      }

      // Each language-judged entity, with an English and a German draft, then
      // a German value the schema now refuses, or a shared count over its cap.
      const langMade = await t.nextly.create({
        collection: LANG_ENTRIES,
        data: { headline: "h", status: "draft" },
      });
      langEntryId = String(langMade.item.id);
      await t.nextly.update({
        collection: LANG_ENTRIES,
        id: langEntryId,
        locale: "de",
        data: { headline: "h de", germanOnly: "ok" },
      } as never);
      for (const slug of [LANG_BANNER, LANG_HIDDEN]) {
        await singles(t).update(
          slug,
          { headline: "h" },
          { overrideAccess: true }
        );
        await singles(t).update(
          slug,
          { headline: "h de", germanOnly: "ok" },
          { overrideAccess: true, locale: "de" }
        );
      }
      const languageRows: Array<[string, string]> = [
        [`dc_${LANG_ENTRIES}`, langEntryId],
        [`single_${LANG_BANNER}`, await singleIdOf(t, LANG_BANNER)],
      ];
      for (const [table, id] of languageRows) {
        await t.adapter.update(
          `${table}_locales`,
          { german_only: SECRET },
          {
            and: [
              { column: "_parent", op: "=", value: id },
              { column: "_locale", op: "=", value: "de" },
            ],
          }
        );
      }
      await t.adapter.update(
        `single_${LANG_HIDDEN}`,
        { shown_count: 9 },
        {
          and: [
            { column: "id", op: "=", value: await singleIdOf(t, LANG_HIDDEN) },
          ],
        }
      );
    }, 120_000);

    afterAll(async () => {
      await t?.destroy();
    });

    const as = (caller: { id: string; isActive: boolean }) => ({
      user: caller,
      overrideAccess: false,
    });

    /** Each way in that publishes, asked as `caller`. */
    const publishes = (
      caller: { id: string; isActive: boolean } | "trusted"
    ): Array<[string, () => Promise<unknown>]> => {
      const who = caller === "trusted" ? { overrideAccess: true } : as(caller);
      const readinessUser = caller === "trusted" ? READER : caller;
      return [
        [
          "a collection update that publishes",
          () =>
            handler(t).updateEntry(
              { collectionName: ENTRIES, entryId, ...who },
              { headline: "changed", status: "published" }
            ),
        ],
        [
          "a collection publish of its status alone",
          () =>
            handler(t).updateEntry(
              { collectionName: ENTRIES, entryId, ...who },
              { status: "published" }
            ),
        ],
        [
          "a collection publish of every language",
          () =>
            handler(t).publishAllLocales({
              collectionName: ENTRIES,
              entryId,
              ...who,
            }),
        ],
        [
          "a Direct API publish of one language",
          () =>
            t.nextly.update({
              collection: ENTRIES,
              id: entryId,
              data: { status: "published" },
              ...who,
            } as never),
        ],
        [
          "a Direct API publish of every language",
          () =>
            t.nextly.update({
              collection: ENTRIES,
              id: entryId,
              locale: "*",
              data: { status: "published" },
              ...who,
            } as never),
        ],
        [
          "a release's readiness check of the entry",
          () =>
            handler(t).releasePublishIssues({
              collectionName: ENTRIES,
              entryIds: [entryId],
              user: readinessUser,
              action: "publish",
            }),
        ],
        [
          "a Single save that publishes",
          () =>
            singles(t).update(
              BANNER,
              { headline: "changed", status: "published" },
              who
            ),
        ],
        [
          "a Single publish of every language",
          () => singles(t).publishAllLocales(BANNER, who),
        ],
        [
          "a Direct API Single publish",
          () =>
            t.nextly.updateSingle({
              slug: BANNER,
              data: { status: "published" },
              ...who,
            } as never),
        ],
        [
          "a release's readiness check of the Single",
          () =>
            singles(t).releasePublishIssues({
              slug: BANNER,
              user: readinessUser,
            }),
        ],
      ];
    };

    describe("to a publisher who may not read the hidden fields", () => {
      it.each(publishes(PUBLISHER))(
        "%s reports them as one generic issue",
        async (_way, run) => {
          expectHiddenCollapsed(await issuesOf(run));
        }
      );
    });

    describe("to a publisher who may read every field", () => {
      it.each(publishes(READER))(
        "%s reports every issue",
        async (_way, run) => {
          expectEveryIssue(await issuesOf(run));
        }
      );
    });

    describe("to a writer who may not read the entry at all", () => {
      // A read shows them no field of it, readable or not.
      it("a collection update that publishes reports every field issue as one generic issue", async () => {
        expect(
          await issuesOf(() =>
            handler(t).updateEntry(
              { collectionName: ENTRIES, entryId, ...as(WRITER) },
              { headline: "changed", status: "published" }
            )
          )
        ).toEqual([GENERIC]);
      });

      it("a Single save that publishes reports every field issue as one generic issue", async () => {
        expect(
          await issuesOf(() =>
            singles(t).update(
              BANNER,
              { headline: "changed", status: "published" },
              as(WRITER)
            )
          )
        ).toEqual([GENERIC]);
      });
    });

    describe("a field group's field the publisher may not read", () => {
      // A field group placed directly on the entry is judged by its own
      // write, which refuses on the issues it finds there.
      it("is reported as one generic issue on a collection update", async () => {
        expect(
          await issuesOf(() =>
            handler(t).updateEntry(
              { collectionName: ENTRIES, entryId, ...as(PUBLISHER) },
              { meta: { metaCode: SECRET } }
            )
          )
        ).toEqual([GENERIC]);
      });

      it("is reported as one generic issue on a Single save", async () => {
        expect(
          await issuesOf(() =>
            singles(t).update(
              BANNER,
              { meta: { metaCode: SECRET } },
              as(PUBLISHER)
            )
          )
        ).toEqual([GENERIC]);
      });
    });

    describe("a publish of every language, judged as a read of each", () => {
      // Every language at once, a read rule that hides one language is not
      // asked as that language; each language goes live as itself.
      it("withholds a collection field only a German read hides", async () => {
        expect(
          await issuesOf(() =>
            handler(t).publishAllLocales({
              collectionName: LANG_ENTRIES,
              entryId: langEntryId,
              ...as(PUBLISHER),
            })
          )
        ).toEqual([GENERIC]);
      });

      it("withholds a Single field only a German read hides", async () => {
        expect(
          await issuesOf(() =>
            singles(t).publishAllLocales(LANG_BANNER, as(PUBLISHER))
          )
        ).toEqual([GENERIC]);
      });

      it("withholds every field of a Single a German read does not show", async () => {
        expect(
          await issuesOf(() =>
            singles(t).publishAllLocales(LANG_HIDDEN, as(PUBLISHER))
          )
        ).toEqual([GENERIC]);
      });
    });

    describe("to an API key READER made, whose own scope may not read the hidden fields", () => {
      // The key's scope leaves out the Single's unpublish, which the hidden
      // fields' read rule asks for, though READER, its maker, holds it.
      const key = {
        user: READER,
        overrideAccess: false,
        authenticatedScope: {
          actorType: "apiKey" as const,
          permissions: [
            `read-${BANNER}`,
            `update-${BANNER}`,
            `publish-${BANNER}`,
          ],
        },
      };

      it("a Single save sending a hidden field reports it as one generic issue", async () => {
        // Judged by the save's own validation, on the values it sends.
        expect(
          await issuesOf(() =>
            singles(t).update(BANNER, { internalScore: 99 }, key)
          )
        ).toEqual([GENERIC]);
      });
    });

    describe("to trusted code", () => {
      // Readiness always judges a release author, so it is asked above.
      it.each(
        publishes("trusted").filter(([way]) => !way.includes("readiness"))
      )("%s reports every issue", async (_way, run) => {
        expectEveryIssue(await issuesOf(run));
      });
    });
  }
);

/** A Single's stored document id. */
async function singleIdOf(t: TestNextly, slug: string): Promise<string> {
  const found = await t.nextly.findSingle({ slug });
  return String((found as unknown as { id: unknown }).id);
}

const handler = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler");
const singles = (t: TestNextly): SingleEntryService =>
  t.getService("singleEntryService");
