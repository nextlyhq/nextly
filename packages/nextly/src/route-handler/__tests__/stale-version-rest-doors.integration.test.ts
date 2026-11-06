/**
 * The REST routes that carry no document values of their own read the version
 * a request was made from out of its body: publishing every language of an
 * entry or a Single, taking the live values into a pending change, and an
 * update by ids with a version for each id. A stale request is refused with
 * `STALE_VERSION` through the route itself, not only through the service the
 * route calls; a body that is not an object is refused as the client's
 * mistake.
 *
 * @module route-handler/__tests__/stale-version-rest-doors.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { superAdminUser } from "../../__tests__/fixtures/permission-holders";
import { defineCollection, defineSingle, number, text } from "../../config";
import type { ApiKeyService } from "../../domains/auth/services/api-key-service";
import type { SingleEntryService } from "../../domains/singles/services/single-entry-service";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import type { CollectionsHandler } from "../../services/collections-handler";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const PAGES = "rd_pages";
const ARTICLES = "rd_articles";
const NOTES = "rd_notes";
const BANNER = "rd_banner";
const ADMIN_ID = "user-rd-admin";

type Doc = Record<string, unknown>;

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: PAGES,
        localized: true,
        status: true,
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: ARTICLES,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "title" }), number({ name: "articleCount" })],
      }),
      defineCollection({ slug: NOTES, fields: [text({ name: "title" })] }),
    ],
    singles: [
      defineSingle({
        slug: BANNER,
        localized: true,
        status: true,
        fields: [text({ name: "headline" })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  // A PostgreSQL or MySQL leg that silently booted SQLite would prove nothing
  // about those databases.
  expect(current.adapter.dialect).toBe(dialect);
  return current;
}

async function adminKey(t: TestNextly): Promise<string> {
  const admin = await superAdminUser(t, ADMIN_ID);
  const keys = t.getService("apiKeyService") as unknown as ApiKeyService;
  const { key } = await keys.createApiKey(admin, {
    name: "doors",
    tokenType: "full-access",
    expiresIn: "unlimited",
  });
  return key;
}

async function post(
  path: string[],
  key: string,
  body: unknown,
  query = ""
): Promise<{ status: number; json: Doc }> {
  const res = await createDynamicHandlers().POST(
    new Request(`http://localhost/api/${path.join("/")}${query}`, {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ params: path }) }
  );
  return { status: res.status, json: (await res.json()) as Doc };
}

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler") as CollectionsHandler;
const singlesOf = (t: TestNextly): SingleEntryService =>
  t.getService("singleEntryService") as unknown as SingleEntryService;

function update(
  t: TestNextly,
  slug: string,
  id: string,
  data: Doc,
  locale?: string
) {
  return handlerOf(t).updateEntry(
    {
      collectionName: slug,
      entryId: id,
      overrideAccess: true,
      ...(locale ? { locale } : {}),
    },
    { ...data, _overwrite: true }
  );
}

async function readRev(
  t: TestNextly,
  slug: string,
  id: string,
  locale: string
): Promise<string> {
  const doc = (await t.nextly.findByID({
    collection: slug as never,
    id,
    locale,
    overrideAccess: true,
    status: "all",
  } as never)) as Doc;
  return String(doc._rev);
}

const errorCode = (json: Doc) => (json.error as Doc | undefined)?.code;

describe.each(getConfiguredTestDialects())(
  "the REST routes that read a version from their body (%s)",
  dialect => {
    it("refuses an entry's publish of every language from an out-of-date version, and a body that is not an object", async () => {
      const t = await boot(dialect);
      const key = await adminKey(t);
      const created = await handlerOf(t).createEntry(
        { collectionName: PAGES, overrideAccess: true, locale: "en" },
        { title: "hello" }
      );
      const id = String((created.data as Doc).id);
      await update(t, PAGES, id, { title: "hola" }, "es");
      const read = await readRev(t, PAGES, id, "*");
      await update(t, PAGES, id, { title: "hola otra vez" }, "es");

      for (const route of ["publish-all", "unpublish-all"]) {
        const refused = await post(
          ["collections", PAGES, "entries", id, route],
          key,
          { _rev: read }
        );
        expect(refused.status, JSON.stringify(refused.json)).toBe(409);
        expect(errorCode(refused.json)).toBe("STALE_VERSION");
      }
      const notAnObject = await post(
        ["collections", PAGES, "entries", id, "publish-all"],
        key,
        []
      );
      expect(notAnObject.status, JSON.stringify(notAnObject.json)).toBe(400);

      const published = await post(
        ["collections", PAGES, "entries", id, "publish-all"],
        key,
        { _rev: await readRev(t, PAGES, id, "*") }
      );
      expect(published.status, JSON.stringify(published.json)).toBe(200);
    });

    it("refuses a Single's publish of every language from an out-of-date version", async () => {
      const t = await boot(dialect);
      const key = await adminKey(t);
      const singles = singlesOf(t);
      await singles.update(
        BANNER,
        { headline: "hello", _overwrite: true },
        {
          locale: "en",
          overrideAccess: true,
        }
      );
      await singles.update(
        BANNER,
        { headline: "hola", _overwrite: true },
        {
          locale: "es",
          overrideAccess: true,
        }
      );
      const revOf = async () =>
        String(
          (
            (await singles.get(BANNER, {
              locale: "*",
              status: "all",
              overrideAccess: true,
            } as never)) as { data: Doc }
          ).data._rev
        );
      const read = await revOf();
      await singles.update(
        BANNER,
        { headline: "hola otra vez", _overwrite: true },
        {
          locale: "es",
          overrideAccess: true,
        }
      );

      const refused = await post(["singles", BANNER, "publish-all"], key, {
        _rev: read,
      });
      expect(refused.status, JSON.stringify(refused.json)).toBe(409);
      expect(errorCode(refused.json)).toBe("STALE_VERSION");

      const published = await post(["singles", BANNER, "publish-all"], key, {
        _rev: await revOf(),
      });
      expect(published.status, JSON.stringify(published.json)).toBe(200);
    });

    it("refuses taking the live values from an out-of-date version", async () => {
      const t = await boot(dialect);
      const key = await adminKey(t);
      const created = await handlerOf(t).createEntry(
        { collectionName: ARTICLES, overrideAccess: true, locale: "en" },
        { title: "en", articleCount: 10, status: "published" }
      );
      const id = String((created.data as Doc).id);
      await update(t, ARTICLES, id, { title: "es", status: "published" }, "es");
      await update(t, ARTICLES, id, { title: "en edited" }, "en");
      await update(t, ARTICLES, id, { articleCount: 13 }, "es");
      await update(t, ARTICLES, id, { status: "published" }, "es");
      const read = await readRev(t, ARTICLES, id, "en");
      await update(t, ARTICLES, id, { title: "en again" }, "en");

      const path = [
        "collections",
        ARTICLES,
        "entries",
        id,
        "versions",
        "working-draft",
        "take-live",
      ];
      const refused = await post(path, key, { _rev: read }, "?locale=en");
      expect(refused.status, JSON.stringify(refused.json)).toBe(409);
      expect(errorCode(refused.json)).toBe("STALE_VERSION");

      const taken = await post(
        path,
        key,
        { _rev: await readRev(t, ARTICLES, id, "en") },
        "?locale=en"
      );
      expect(taken.status, JSON.stringify(taken.json)).toBe(200);
    });

    it("judges each document of an update by ids on the version given for it", async () => {
      const t = await boot(dialect);
      const key = await adminKey(t);
      const ids: string[] = [];
      const revs: Record<string, string> = {};
      for (const title of ["a", "b"]) {
        const created = await handlerOf(t).createEntry(
          { collectionName: NOTES, overrideAccess: true },
          { title }
        );
        const id = String((created.data as Doc).id);
        ids.push(id);
        revs[id] = String((created.data as Doc)._rev);
      }
      await update(t, NOTES, ids[1]!, { title: "saved since" });

      const bulk = await post(
        ["collections", NOTES, "entries", "bulk-update"],
        key,
        { ids, data: { title: "bulk" }, revs }
      );
      expect(bulk.status, JSON.stringify(bulk.json)).toBe(200);
      expect(bulk.json.errors).toEqual([
        expect.objectContaining({ id: ids[1], code: "STALE_VERSION" }),
      ]);
      expect((bulk.json.items as Doc[]).map(item => item.id)).toEqual([ids[0]]);
    });
  }
);
