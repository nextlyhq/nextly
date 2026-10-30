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

import { defineCollection, defineSingle, number, text } from "../../../config";
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

const fields = () => [
  text({ name: "headline" }),
  number({ name: "visibleCount", max: 5 }),
  number({ name: "internalScore", max: 10, access: readerOnly }),
  text({ name: "internalNote", required: true, access: readerOnly }),
  text({
    name: "secretCode",
    access: readerOnly,
    validate: (value: unknown) =>
      typeof value === "string" && value.length > 5
        ? `Code ${value} is not allowed`
        : true,
  }),
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

    beforeAll(async () => {
      t = await createTestNextly({
        dialect,
        localization: { locales: ["en", "de"], defaultLocale: "en" },
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
        ],
        singles: [
          defineSingle({
            slug: BANNER,
            localized: true,
            status: true,
            access: { read: ALLOW, update: ALLOW, publish: ALLOW },
            fields: fields(),
          }),
        ],
      });
      for (const caller of [PUBLISHER, READER]) {
        await userWhoMay(t, caller.id, "read", [ENTRIES, BANNER]);
        for (const action of ["create", "update", "publish", "unpublish"]) {
          await grantTo(t, caller.id, action, [ENTRIES, BANNER]);
        }
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

const handler = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler");
const singles = (t: TestNextly): SingleEntryService =>
  t.getService("singleEntryService");
