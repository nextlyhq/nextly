/**
 * Taking the live values into a pending change, and discarding one, are
 * judged by the version their caller read.
 *
 * Both rewrite a language's pending change: taking the live values saves it
 * with the shared values someone published since it began, and discarding
 * throws it away. Made from an out-of-date view, either would lose a
 * colleague's newer edit to that change, so a stale one is refused with
 * `STALE_VERSION` and the change is left as the colleague saved it.
 *
 * @module domains/collections/services/__tests__/stale-version-pending-change.integration.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { superAdminUser } from "../../../../__tests__/fixtures/permission-holders";
import { defineCollection, number, text } from "../../../../config";
import type { ApiKeyService } from "../../../auth/services/api-key-service";
import { definePlugin } from "../../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../../routeHandler";
import type { CollectionEntryService } from "../../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import { VersionsRepository } from "../../../versions/versions-repository";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  versions = undefined;
});

/** The plugin service's history writes, as a plugin is handed them. */
type PluginVersions = {
  deleteWorkingDraft(
    ref: { scopeKind: "collection"; scopeSlug: string; entryId: string },
    locale: string | null,
    opts?: unknown,
    version?: Record<string, unknown>
  ): Promise<number>;
};
let versions: PluginVersions | undefined;
const probe = definePlugin({
  name: "pending-change-version-probe",
  version: "1.0.0",
  nextly: ">=0.0.1",
  init: ctx => {
    versions = ctx.services.versions as unknown as PluginVersions;
  },
});

const ARTICLES = "pc_articles";
const ANA = { id: "user-pc-ana", name: "Ana", email: "ana@pc.test" };
const ADMIN_ID = "user-pc-admin";

type Doc = Record<string, unknown>;

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    plugins: [probe],
    collections: [
      defineCollection({
        slug: ARTICLES,
        localized: true,
        status: true,
        versions: { drafts: true },
        // The title is translated; the count is shared by every language.
        fields: [text({ name: "title" }), number({ name: "articleCount" })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  // A PostgreSQL or MySQL leg that silently booted SQLite would prove nothing
  // about those databases.
  expect(current.adapter.dialect).toBe(dialect);
  const now = new Date();
  await current.adapter.insert("users", {
    ...ANA,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return current;
}

const entriesOf = (t: TestNextly): CollectionEntryService =>
  (
    t.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as CollectionEntryService;

function save(
  t: TestNextly,
  id: string,
  locale: string,
  body: Doc,
  user?: typeof ANA
) {
  return entriesOf(t).updateEntry(
    {
      collectionName: ARTICLES,
      entryId: id,
      overrideAccess: true,
      locale,
      ...(user ? { user } : {}),
    },
    body
  );
}

/** The version a read of a language's pending change gives. */
async function revIn(
  t: TestNextly,
  id: string,
  locale: string
): Promise<string> {
  const doc = (await t.nextly.findByID({
    collection: ARTICLES as never,
    id,
    locale,
    draft: true,
    overrideAccess: true,
  } as never)) as Doc;
  return String(doc._rev);
}

/** The version a read of the English pending change gives. */
const englishRev = (t: TestNextly, id: string) => revIn(t, id, "en");

/** The English pending change's title, as stored. */
async function pendingTitle(t: TestNextly, id: string): Promise<unknown> {
  const doc = (await t.nextly.findByID({
    collection: ARTICLES as never,
    id,
    locale: "en",
    draft: true,
    overrideAccess: true,
  } as never)) as Doc;
  return doc.title;
}

/**
 * Live in both languages; English begins a pending change while the count is
 * 10; Spanish then publishes 13, so English's pending change is out of date on
 * the shared count and can take the live value.
 */
async function englishBehindSpanish(t: TestNextly): Promise<string> {
  const created = await entriesOf(t).createEntry(
    { collectionName: ARTICLES, overrideAccess: true, locale: "en" },
    { title: "en title", articleCount: 10, status: "published" }
  );
  const id = String((created.data as Doc).id);
  // Each save sends the version just read in its language. The overwrite
  // choice would record an `overwritten` event, which the tests count.
  const step = async (locale: string, body: Doc) =>
    expect(
      (await save(t, id, locale, { ...body, _rev: await revIn(t, id, locale) }))
        .success
    ).toBe(true);
  await step("es", { title: "es title", status: "published" });
  await step("en", { title: "en edited" });
  await step("es", { articleCount: 13 });
  await step("es", { status: "published" });
  return id;
}

type Result = {
  success?: boolean;
  code?: string;
  statusCode?: number;
  publicData?: Record<string, unknown>;
};

const takeLive = (t: TestNextly, id: string, version?: Doc) =>
  entriesOf(t).takeLiveSharedValues({
    collectionName: ARTICLES,
    entryId: id,
    overrideAccess: true,
    locale: "en",
    ...(version ? { version } : {}),
  }) as Promise<Result>;

/** A discard through REST, as an admin's key; `query` names `_rev` and `_overwrite`. */
async function restDiscard(
  t: TestNextly,
  id: string,
  query: Record<string, string>
): Promise<{ status: number; json: Doc }> {
  const admin = await superAdminUser(t, ADMIN_ID);
  const keys = t.getService("apiKeyService") as unknown as ApiKeyService;
  const { key } = await keys.createApiKey(admin, {
    name: "discard",
    tokenType: "full-access",
    expiresIn: "unlimited",
  });
  const path = [
    "collections",
    ARTICLES,
    "entries",
    id,
    "versions",
    "working-draft",
  ];
  const search = new URLSearchParams({ locale: "en", ...query }).toString();
  const res = await createDynamicHandlers().DELETE(
    new Request(`http://localhost/api/${path.join("/")}?${search}`, {
      method: "DELETE",
      headers: { origin: "http://localhost", authorization: `Bearer ${key}` },
    }),
    { params: Promise.resolve({ params: path }) }
  );
  return { status: res.status, json: (await res.json()) as Doc };
}

const overwritesOf = async (t: TestNextly, id: string) =>
  (
    await t.nextly.contentEvents.list({
      subject: { kind: "collection", slug: ARTICLES, id },
      limit: 100,
    })
  ).items.filter(e => e.kind === "overwritten");

describe.each(getConfiguredTestDialects())(
  "a pending change's rewrites, judged by version (%s)",
  dialect => {
    describe("taking the live values", () => {
      it("refuses taking the live values from an out-of-date version", async () => {
        const t = await boot(dialect);
        const id = await englishBehindSpanish(t);
        const read = await englishRev(t, id);
        // Ana saves the English pending change after it was read.
        expect(
          (await save(t, id, "en", { title: "Ana's draft", _rev: read }, ANA))
            .success
        ).toBe(true);
        const asAnaLeftIt = await pendingTitle(t, id);

        const refused = await takeLive(t, id, { _rev: read });
        expect(refused.code, JSON.stringify(refused)).toBe("STALE_VERSION");
        expect(refused.publicData).toMatchObject({
          currentVersion: await englishRev(t, id),
          changedBy: { kind: "person", name: ANA.name },
        });
        // The pending change is as Ana left it, and the count was not taken.
        expect(await pendingTitle(t, id)).toBe(asAnaLeftIt);
        const pending = (await t.nextly.findByID({
          collection: ARTICLES as never,
          id,
          locale: "en",
          draft: true,
          overrideAccess: true,
        } as never)) as Doc;
        expect(pending.articleCount).toBe(10);
      });

      it("answers taking the live values with no pending change as before, whatever version it names", async () => {
        const t = await boot(dialect);
        const created = await entriesOf(t).createEntry(
          { collectionName: ARTICLES, overrideAccess: true, locale: "en" },
          { title: "en title", status: "published" }
        );
        const id = String((created.data as Doc).id);
        const read = await englishRev(t, id);
        // Published straight away: the version read is out of date, and
        // English holds no pending change.
        expect(
          (
            await save(t, id, "en", {
              title: "en again",
              status: "published",
              _rev: read,
            })
          ).success
        ).toBe(true);

        // The overwrite choice is the answer whatever is stored.
        const overwrite = await takeLive(t, id, { _overwrite: true });
        expect(overwrite.success, JSON.stringify(overwrite)).toBe(false);
        const old = await takeLive(t, id, { _rev: read });
        expect(old.code, JSON.stringify(old)).toBe(overwrite.code);
        expect(old.code).not.toBe("STALE_VERSION");
      });

      it("takes the live values from the current version", async () => {
        const t = await boot(dialect);
        const id = await englishBehindSpanish(t);
        const taken = await takeLive(t, id, { _rev: await englishRev(t, id) });
        expect(taken.success, JSON.stringify(taken)).toBe(true);
      });

      it("refuses taking the live values with no version, taking nothing", async () => {
        const t = await boot(dialect);
        const id = await englishBehindSpanish(t);
        const before = await englishRev(t, id);
        const refused = await takeLive(t, id);
        expect(refused.code, JSON.stringify(refused)).toBe("VERSION_REQUIRED");
        expect(refused.statusCode).toBe(428);
        // Nothing was taken: the pending change still holds the old count.
        const pending = (await t.nextly.findByID({
          collection: ARTICLES as never,
          id,
          locale: "en",
          draft: true,
          overrideAccess: true,
        } as never)) as Doc;
        expect(pending.articleCount).toBe(10);
        expect(await englishRev(t, id)).toBe(before);
      });

      it("takes the live values over a change with the overwrite choice, and records it", async () => {
        const t = await boot(dialect);
        const id = await englishBehindSpanish(t);
        const read = await englishRev(t, id);
        await save(t, id, "en", { title: "Ana's draft", _rev: read }, ANA);
        const taken = await takeLive(t, id, { _rev: read, _overwrite: true });
        expect(taken.success, JSON.stringify(taken)).toBe(true);
        expect((await overwritesOf(t, id)).map(e => e.payload)).toEqual([
          expect.objectContaining({
            given: "stale",
            replaced: expect.objectContaining({ kind: "person", id: ANA.id }),
          }),
        ]);
      });

      it("refuses a version that is not one, taking nothing", async () => {
        const t = await boot(dialect);
        const id = await englishBehindSpanish(t);
        const refused = await takeLive(t, id, { _rev: "seven" });
        expect(refused.code, JSON.stringify(refused)).toBe("VALIDATION_ERROR");
        // Nothing was taken: the pending change still holds the old count.
        const pending = (await t.nextly.findByID({
          collection: ARTICLES as never,
          id,
          locale: "en",
          draft: true,
          overrideAccess: true,
        } as never)) as Doc;
        expect(pending.articleCount).toBe(10);
      });
    });

    describe("discarding a pending change", () => {
      it("refuses discarding a pending change from an out-of-date version", async () => {
        const t = await boot(dialect);
        const id = await englishBehindSpanish(t);
        const read = await englishRev(t, id);
        await save(t, id, "en", { title: "Ana's draft", _rev: read }, ANA);
        const asAnaLeftIt = await pendingTitle(t, id);

        const refused = await restDiscard(t, id, { _rev: read });
        expect(refused.status, JSON.stringify(refused.json)).toBe(409);
        expect((refused.json.error as Doc).code).toBe("STALE_VERSION");
        expect((refused.json.error as Doc).data).toMatchObject({
          currentVersion: await englishRev(t, id),
        });
        // The pending change is still there, as Ana left it.
        expect(await pendingTitle(t, id)).toBe(asAnaLeftIt);
        expect(asAnaLeftIt).not.toBe("en title");
      });

      it("judges a discard before removing anything", async () => {
        const t = await boot(dialect);
        const id = await englishBehindSpanish(t);
        const read = await englishRev(t, id);
        await save(t, id, "en", { title: "Ana's draft", _rev: read }, ANA);
        // A removal that fails: a discard that removed before judging would
        // answer with this failure rather than with the refusal.
        const removal = vi
          .spyOn(VersionsRepository.prototype, "deleteWorkingDraft")
          .mockRejectedValue(new Error("removal failed"));
        try {
          const refused = await restDiscard(t, id, { _rev: read });
          expect(refused.status, JSON.stringify(refused.json)).toBe(409);
          expect((refused.json.error as Doc).code).toBe("STALE_VERSION");
          expect(removal).not.toHaveBeenCalled();
        } finally {
          removal.mockRestore();
        }
      });

      it("discards from the current version", async () => {
        const t = await boot(dialect);
        const id = await englishBehindSpanish(t);
        const discarded = await restDiscard(t, id, {
          _rev: await englishRev(t, id),
        });
        expect(discarded.status, JSON.stringify(discarded.json)).toBe(200);
        expect(await pendingTitle(t, id)).toBe("en title");
      });

      it("discards over a change with the overwrite choice, and records it", async () => {
        const t = await boot(dialect);
        const id = await englishBehindSpanish(t);
        const read = await englishRev(t, id);
        await save(t, id, "en", { title: "Ana's draft", _rev: read }, ANA);
        const discarded = await restDiscard(t, id, {
          _rev: read,
          _overwrite: "true",
        });
        expect(discarded.status, JSON.stringify(discarded.json)).toBe(200);
        expect(await pendingTitle(t, id)).toBe("en title");
        expect((await overwritesOf(t, id)).map(e => e.payload)).toEqual([
          expect.objectContaining({
            given: "stale",
            replaced: expect.objectContaining({ kind: "person", id: ANA.id }),
          }),
        ]);
      });

      it("answers a discard with nothing to discard as before, whatever version it names", async () => {
        const t = await boot(dialect);
        const id = await englishBehindSpanish(t);
        const read = await englishRev(t, id);
        // Ana publishes English, so there is no pending change left.
        await save(t, id, "en", { status: "published", _rev: read }, ANA);
        const answered = await restDiscard(t, id, { _rev: read });
        expect(answered.status, JSON.stringify(answered.json)).toBe(200);
      });

      it("refuses a discard with no version, discarding nothing", async () => {
        const t = await boot(dialect);
        const id = await englishBehindSpanish(t);
        const refused = await restDiscard(t, id, {});
        expect(refused.status, JSON.stringify(refused.json)).toBe(428);
        expect((refused.json.error as Doc).code).toBe("VERSION_REQUIRED");
        expect(await pendingTitle(t, id)).toBe("en edited");
      });

      it("refuses a plugin's discard from an out-of-date version", async () => {
        const t = await boot(dialect);
        const id = await englishBehindSpanish(t);
        const read = await englishRev(t, id);
        await save(t, id, "en", { title: "Ana's draft", _rev: read }, ANA);
        const asAnaLeftIt = await pendingTitle(t, id);
        const ref = {
          scopeKind: "collection" as const,
          scopeSlug: ARTICLES,
          entryId: id,
        };

        let code: unknown;
        try {
          await versions!.deleteWorkingDraft(ref, "en", undefined, {
            _rev: read,
          });
        } catch (error) {
          code = (error as { code?: unknown }).code;
        }
        expect(code).toBe("STALE_VERSION");
        expect(await pendingTitle(t, id)).toBe(asAnaLeftIt);

        // From the current version, the plugin's discard goes ahead.
        expect(
          await versions!.deleteWorkingDraft(ref, "en", undefined, {
            _rev: await englishRev(t, id),
          })
        ).toBe(1);
      });

      it("refuses a version that is not one, discarding nothing", async () => {
        const t = await boot(dialect);
        const id = await englishBehindSpanish(t);
        const refused = await restDiscard(t, id, { _rev: "seven" });
        expect(refused.status, JSON.stringify(refused.json)).toBe(400);
        expect(await pendingTitle(t, id)).toBe("en edited");
      });
    });
  }
);
