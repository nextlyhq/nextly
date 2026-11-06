/**
 * Autosave is never judged by version, and never changes it.
 *
 * A recovery point keeps an editor's unsaved work; it is not a write to the
 * document. So it is never refused for an out-of-date version, even one its
 * snapshot carries, and it moves no counter, last changer or update time: a
 * save made from the version read before it is still current.
 *
 * @module domains/versions/__tests__/autosave-leaves-version.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { superAdminUser } from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, defineSingle, text } from "../../../config";
import type { ApiKeyService } from "../../auth/services/api-key-service";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { SingleEntryService } from "../../singles/services/single-entry-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const POSTS = "al_posts";
const BANNER = "al_banner";
const ADMIN_ID = "user-al-admin";

type Doc = Record<string, unknown>;

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: POSTS,
        localized: true,
        versions: { drafts: { autosave: true } },
        status: true,
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: BANNER,
        versions: { drafts: { autosave: true } },
        fields: [text({ name: "notice" })],
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
    name: "autosave",
    tokenType: "full-access",
    expiresIn: "unlimited",
  });
  return key;
}

async function put(
  path: string[],
  key: string,
  body: Doc,
  query = ""
): Promise<{ status: number; json: Doc }> {
  const res = await createDynamicHandlers().PUT(
    new Request(`http://localhost/api/${path.join("/")}${query}`, {
      method: "PUT",
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

const q = (t: TestNextly, name: string) =>
  t.adapter.dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

/** What a version covers, read raw: counters, last changers and update times, every row. */
async function versionState(
  t: TestNextly,
  table: string,
  id: string,
  languagesTable?: string
): Promise<Doc> {
  const columns = [
    "_revision",
    "_changed_by_kind",
    "_changed_by_id",
    "_changed_by_principal_kind",
  ];
  const main = await t.adapter.selectOne<Doc>(table, {
    where: { and: [{ column: "id", op: "=", value: id }] },
  });
  if (!main) throw new Error(`no ${id} in ${table}`);
  const state: Doc = {
    main: Object.fromEntries(
      [...columns, "updated_at"].map(c => [c, String(main[c])])
    ),
  };
  if (languagesTable) {
    const p = t.adapter.dialect === "postgresql" ? "$1" : "?";
    const rows = await t.adapter.executeQuery<Doc>(
      `SELECT ${[...columns, "_locale"].map(c => q(t, c)).join(", ")} FROM ${q(t, languagesTable)} WHERE ${q(t, "_parent")} = ${p}`,
      [id]
    );
    state.languages = rows
      .map(r => JSON.stringify(r))
      .sort()
      .join("|");
  }
  return state;
}

describe.each(getConfiguredTestDialects())(
  "autosave and the document's version (%s)",
  dialect => {
    it("an autosave between two reads leaves the version unchanged and is never refused", async () => {
      const t = await boot(dialect);
      const key = await adminKey(t);
      const handler = t.getService("collectionsHandler") as CollectionsHandler;
      const created = await handler.createEntry(
        { collectionName: POSTS, overrideAccess: true, locale: "en" },
        { title: "hello", status: "published" }
      );
      const id = String((created.data as Doc).id);
      await handler.updateEntry(
        {
          collectionName: POSTS,
          entryId: id,
          overrideAccess: true,
          locale: "es",
        },
        { title: "hola", status: "published", _overwrite: true }
      );
      const read = (await t.nextly.findByID({
        collection: POSTS as never,
        id,
        locale: "en",
        overrideAccess: true,
      } as never)) as Doc;
      const before = await versionState(
        t,
        `dc_${POSTS}`,
        id,
        `dc_${POSTS}_locales`
      );

      // A recovery point in each language, one carrying an out-of-date
      // version in its snapshot, as an editor's form would hold it.
      for (const [locale, snapshot] of [
        ["en", { title: "typing", _rev: read._rev }],
        ["es", { title: "escribiendo", _rev: "1.es:1" }],
      ] as const) {
        const saved = await put(
          ["collections", POSTS, "entries", id, "versions", "autosave"],
          key,
          snapshot,
          `?locale=${locale}`
        );
        expect(saved.status, JSON.stringify(saved.json)).toBeLessThan(300);
      }

      expect(
        await versionState(t, `dc_${POSTS}`, id, `dc_${POSTS}_locales`)
      ).toEqual(before);
      const again = (await t.nextly.findByID({
        collection: POSTS as never,
        id,
        locale: "en",
        overrideAccess: true,
      } as never)) as Doc;
      expect(again._rev).toBe(read._rev);

      // A save from the version read before the recovery points is current.
      const saved = await handler.updateEntry(
        {
          collectionName: POSTS,
          entryId: id,
          overrideAccess: true,
          locale: "en",
        },
        { title: "saved", _rev: read._rev }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);
    });

    it("an autosave of a Single leaves its version unchanged", async () => {
      const t = await boot(dialect);
      const key = await adminKey(t);
      const singles = t.getService(
        "singleEntryService"
      ) as unknown as SingleEntryService;
      await singles.update(
        BANNER,
        { notice: "hello", _overwrite: true },
        { overrideAccess: true }
      );
      const read = (await singles.get(BANNER, { overrideAccess: true }))
        .data as Doc;
      const before = await versionState(t, `single_${BANNER}`, String(read.id));

      const saved = await put(
        ["singles", BANNER, "versions", "autosave"],
        key,
        { notice: "typing", _rev: read._rev }
      );
      expect(saved.status, JSON.stringify(saved.json)).toBeLessThan(300);

      expect(
        await versionState(t, `single_${BANNER}`, String(read.id))
      ).toEqual(before);
      expect(
        ((await singles.get(BANNER, { overrideAccess: true })).data as Doc)._rev
      ).toBe(read._rev);
    });
  }
);
