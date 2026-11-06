/**
 * A recovery point keeps the version its edits began from, and its read says
 * who changed the document since and when.
 *
 * The editor stores the version its copy started from (`_rev`) in the point's
 * snapshot. Reading the point back compares that version with the document's
 * current one, in the parts the point's language covers, and describes a
 * change exactly as a refused save would: the current version always, who and
 * when only to a caller who may read the document. A point stored without a
 * version (saved before versions existed) says its starting version is
 * unknown.
 *
 * @module domains/versions/__tests__/autosave-starting-version.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  superAdminUser,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { runWithAccessMemo } from "../../../auth/access/request-memo";
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
import { changesSinceRecoveryPoint } from "../recovery-point-changes";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const POSTS = "sv_posts";
const BANNER = "sv_banner";
/** Notes a read rule lets a reader see only where they are public. */
const NOTES = "sv_notes";
const READER = "user-sv-reader";

/** A read rule answering `value`, unchecked by the filter type, as untyped code may. */
const answering = (value: unknown) => () => value as boolean;
const ADMIN_ID = "user-sv-admin";
/** A colleague whose save is named to the point's author. */
const ANA = { id: "user-sv-ana", name: "Ana Ruiz", email: "ana-sv@x.test" };

type Doc = Record<string, unknown>;

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: POSTS,
        localized: true,
        versions: { drafts: { autosave: true } },
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "note" }),
        ],
      }),
      defineCollection({
        slug: NOTES,
        versions: { drafts: { autosave: true } },
        access: { read: answering({ team: { equals: "public" } }) },
        fields: [text({ name: "team" }), text({ name: "note" })],
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
  const now = new Date();
  await current.adapter.insert("users", {
    id: ANA.id,
    email: ANA.email,
    name: ANA.name,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return current;
}

/** The point's author, through a key of their own, as the editor's session is. */
async function authorKey(t: TestNextly): Promise<string> {
  const admin = await superAdminUser(t, ADMIN_ID);
  const keys = t.getService("apiKeyService") as unknown as ApiKeyService;
  const { key } = await keys.createApiKey(admin, {
    name: "starting-version",
    tokenType: "full-access",
    expiresIn: "unlimited",
  });
  return key;
}

async function call(
  method: "PUT" | "GET",
  path: string[],
  key: string,
  query: string,
  body?: Doc
): Promise<{ status: number; json: Doc | null }> {
  const res = await createDynamicHandlers()[method](
    new Request(`http://localhost/api/${path.join("/")}${query}`, {
      method,
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve({ params: path }) }
  );
  return { status: res.status, json: (await res.json()) as Doc | null };
}

const handlerOf = (t: TestNextly) =>
  t.getService("collectionsHandler") as CollectionsHandler;

/** A post with a translation in each language, and its version read in `locale`. */
async function post(t: TestNextly): Promise<string> {
  const created = await handlerOf(t).createEntry(
    { collectionName: POSTS, overrideAccess: true, locale: "en" },
    { title: "hello", note: "shared" }
  );
  const id = String((created.data as Doc).id);
  await handlerOf(t).updateEntry(
    { collectionName: POSTS, entryId: id, overrideAccess: true, locale: "es" },
    { title: "hola", _overwrite: true }
  );
  return id;
}

async function readRev(t: TestNextly, id: string, locale: string) {
  const read = (await t.nextly.findByID({
    collection: POSTS as never,
    id,
    locale,
    overrideAccess: true,
  } as never)) as Doc;
  return String(read._rev);
}

const AUTOSAVE = (id: string) => [
  "collections",
  POSTS,
  "entries",
  id,
  "versions",
  "autosave",
];

/** Store the author's recovery point, then read it back as the editor does. */
async function pointAfter(
  key: string,
  id: string,
  locale: string,
  snapshot: Doc,
  between: () => Promise<unknown> = async () => {}
): Promise<Doc> {
  const saved = await call(
    "PUT",
    AUTOSAVE(id),
    key,
    `?locale=${locale}`,
    snapshot
  );
  expect(saved.status, JSON.stringify(saved.json)).toBeLessThan(300);
  await between();
  const read = await call("GET", AUTOSAVE(id), key, "");
  expect(read.status, JSON.stringify(read.json)).toBe(200);
  if (!read.json) throw new Error("no recovery point read back");
  return read.json;
}

describe.each(getConfiguredTestDialects())(
  "a recovery point's starting version (%s)",
  dialect => {
    it("a recovery point keeps the version its edits began from", async () => {
      const t = await boot(dialect);
      const key = await authorKey(t);
      const id = await post(t);
      const startedFrom = await readRev(t, id, "en");

      const point = await pointAfter(key, id, "en", {
        title: "typing",
        _rev: startedFrom,
      });
      expect((point.snapshot as Doc)._rev).toBe(startedFrom);
      // Nothing changed since: no change to report, and nothing unknown.
      expect(point).not.toHaveProperty("changedSince");
      expect(point).not.toHaveProperty("startingVersionUnknown");
    });

    it("names who changed the document since the point began, and when", async () => {
      const t = await boot(dialect);
      const key = await authorKey(t);
      const id = await post(t);
      const startedFrom = await readRev(t, id, "en");
      const before = Date.now();

      const point = await pointAfter(
        key,
        id,
        "en",
        { title: "typing", _rev: startedFrom },
        () =>
          handlerOf(t).updateEntry(
            {
              collectionName: POSTS,
              entryId: id,
              overrideAccess: true,
              locale: "en",
              user: ANA as never,
            },
            { note: "Ana's change", _overwrite: true }
          )
      );

      expect(point.changedSince).toMatchObject({
        currentVersion: await readRev(t, id, "en"),
        changedBy: { kind: "person", name: ANA.name },
      });
      const at = Date.parse(String((point.changedSince as Doc).changedAt));
      expect(at).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
      // Described as a refusal describes it: never a value, an email or an id.
      expect(JSON.stringify(point.changedSince)).not.toContain("Ana's change");
      expect(JSON.stringify(point.changedSince)).not.toContain(ANA.email);
      expect(JSON.stringify(point.changedSince)).not.toContain(ANA.id);
    });

    it("does not count a change to another language as a change since the point", async () => {
      const t = await boot(dialect);
      const key = await authorKey(t);
      const id = await post(t);
      const startedFrom = await readRev(t, id, "en");

      const point = await pointAfter(
        key,
        id,
        "en",
        { title: "typing", _rev: startedFrom },
        () =>
          handlerOf(t).updateEntry(
            {
              collectionName: POSTS,
              entryId: id,
              overrideAccess: true,
              locale: "es",
              user: ANA as never,
            },
            { title: "otra", _overwrite: true }
          )
      );
      expect(point).not.toHaveProperty("changedSince");
    });

    it("says the starting version is unknown for a point saved without one", async () => {
      const t = await boot(dialect);
      const key = await authorKey(t);
      const id = await post(t);

      const point = await pointAfter(key, id, "en", { title: "typing" });
      expect(point.startingVersionUnknown).toBe(true);
      expect(point).not.toHaveProperty("changedSince");
    });

    it("keeps a Single's starting version and names who changed it since", async () => {
      const t = await boot(dialect);
      const key = await authorKey(t);
      const singles = t.getService("singleEntryService") as SingleEntryService;
      const first = (await singles.update(
        BANNER,
        { notice: "first", _overwrite: true },
        { overrideAccess: true }
      )) as { data?: Doc };
      const startedFrom = String(first.data?._rev);
      const path = ["singles", BANNER, "versions", "autosave"];

      const saved = await call("PUT", path, key, "", {
        notice: "typing",
        _rev: startedFrom,
      });
      expect(saved.status, JSON.stringify(saved.json)).toBeLessThan(300);
      await singles.update(
        BANNER,
        { notice: "Ana's notice", _overwrite: true },
        { overrideAccess: true, user: ANA as never }
      );
      const read = await call("GET", path, key, "");
      expect(read.json?.snapshot).toMatchObject({ _rev: startedFrom });
      expect(read.json?.changedSince).toMatchObject({
        changedBy: { kind: "person", name: ANA.name },
      });
    });

    it("tells a caller who may not read the document no who or when", async () => {
      const t = await boot(dialect);
      await superAdminUser(t, ADMIN_ID);
      const id = await post(t);
      const startedFrom = await readRev(t, id, "en");
      await handlerOf(t).updateEntry(
        {
          collectionName: POSTS,
          entryId: id,
          overrideAccess: true,
          locale: "en",
          user: ANA as never,
        },
        { note: "Ana's change", _overwrite: true }
      );
      const point = (user: { id: string; roles: string[] } | undefined) =>
        changesSinceRecoveryPoint(t.adapter, {
          scopeKind: "collection",
          slug: POSTS,
          entryId: id,
          snapshot: { title: "typing", _rev: startedFrom },
          locale: "en",
          reader: { user: user as never, trusted: false },
        });

      // The read gate a refused save asks: a reader is told who; a caller
      // with no account, only the version.
      expect(
        await point({ id: ADMIN_ID, roles: ["super-admin"] })
      ).toMatchObject({
        changedSince: { changedBy: { kind: "person", name: ANA.name } },
      });
      expect(await point(undefined)).toEqual({
        changedSince: { currentVersion: await readRev(t, id, "en") },
      });
    });

    it("tells a caller a read rule keeps from the document no who or when", async () => {
      const t = await boot(dialect);
      // The rule narrows the read permission, so the reader holds it.
      await userWhoMay(t, READER, "read", [NOTES]);
      const changedByAna = async (team: string) => {
        const created = await handlerOf(t).createEntry(
          { collectionName: NOTES, overrideAccess: true },
          { team, note: "first" }
        );
        const id = String((created.data as Doc).id);
        const read = (await t.nextly.findByID({
          collection: NOTES as never,
          id,
          overrideAccess: true,
        } as never)) as Doc;
        await handlerOf(t).updateEntry(
          {
            collectionName: NOTES,
            entryId: id,
            overrideAccess: true,
            user: ANA as never,
          },
          { note: "Ana's change", _overwrite: true }
        );
        return { id, startedFrom: String(read._rev) };
      };
      const inside = await changedByAna("public");
      const outside = await changedByAna("staff");
      // Inside a request, as the editor's read of its point is: the rule's
      // filter is kept for the read that decides.
      const point = ({
        id,
        startedFrom,
      }: {
        id: string;
        startedFrom: string;
      }) =>
        runWithAccessMemo(() =>
          changesSinceRecoveryPoint(t.adapter, {
            scopeKind: "collection",
            slug: NOTES,
            entryId: id,
            snapshot: { note: "typing", _rev: startedFrom },
            locale: null,
            reader: { user: { id: READER } as never, trusted: false },
          })
        );

      // A note the rule shows the reader names who changed it; one it keeps
      // from them, only the version.
      expect(await point(inside)).toMatchObject({
        changedSince: { changedBy: { kind: "person", name: ANA.name } },
      });
      const keptFrom = await point(outside);
      expect(keptFrom).toEqual({
        changedSince: { currentVersion: expect.any(String) },
      });
    });
  }
);
