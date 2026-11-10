/**
 * A restore of an earlier version is judged by the version the caller read,
 * as the update it makes is.
 *
 * A restore puts an old version's content over the document as it is now. Made
 * from an out-of-date view, it would silently undo a save the restorer never
 * saw, so a stale one is refused with `STALE_VERSION` and writes nothing. It
 * answers with the document's new version, so the caller can save again
 * without reading first.
 *
 * Through REST, for a collection entry and a Single, and through
 * `restoreVersion` itself, the one function every way of restoring calls.
 *
 * @module domains/versions/__tests__/restore-judged-by-version.integration.test
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
import { restoreVersion } from "../restore-version";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const POSTS = "rj_posts";
const BANNER = "rj_banner";
const ADMIN = { id: "user-rj-admin", roles: ["super-admin"] };
const ANA = { id: "user-rj-ana", name: "Ana", email: "ana@rj.test" };

type Doc = Record<string, unknown>;

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: POSTS,
        versions: true,
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: BANNER,
        versions: true,
        fields: [text({ name: "notice" })],
      }),
    ],
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

async function adminKey(t: TestNextly): Promise<string> {
  const admin = await superAdminUser(t, ADMIN.id);
  const keys = t.getService("apiKeyService") as unknown as ApiKeyService;
  const { key } = await keys.createApiKey(admin, {
    name: "restore",
    tokenType: "full-access",
    expiresIn: "unlimited",
  });
  return key;
}

async function rest(
  method: "GET" | "POST",
  path: string[],
  key: string,
  body?: Doc
): Promise<{ status: number; json: Doc }> {
  const handlers = createDynamicHandlers();
  const res = await handlers[method](
    new Request(`http://localhost/api/${path.join("/")}`, {
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
  return { status: res.status, json: (await res.json()) as Doc };
}

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler") as CollectionsHandler;
const singlesOf = (t: TestNextly): SingleEntryService =>
  t.getService("singleEntryService") as unknown as SingleEntryService;

/** A post saved twice, so version 1 holds "first" and the post now says "second". */
async function postWithHistory(t: TestNextly) {
  const created = await handlerOf(t).createEntry(
    { collectionName: POSTS, overrideAccess: true },
    { title: "first" }
  );
  const id = String((created.data as Doc).id);
  await handlerOf(t).updateEntry(
    { collectionName: POSTS, entryId: id, overrideAccess: true },
    { title: "second", _rev: String((created.data as Doc)._rev) }
  );
  return id;
}

async function postRev(t: TestNextly, id: string): Promise<string> {
  const doc = (await t.nextly.findByID({
    collection: POSTS as never,
    id,
    overrideAccess: true,
  } as never)) as Doc;
  return String(doc._rev);
}

async function postTitle(t: TestNextly, id: string): Promise<unknown> {
  const row = await t.adapter.selectOne<Doc>(`dc_${POSTS}`, {
    where: { and: [{ column: "id", op: "=", value: id }] },
  });
  return row?.title;
}

/** The banner saved twice, with the version number its first save recorded. */
async function bannerWithHistory(t: TestNextly) {
  await singlesOf(t).update(
    BANNER,
    { notice: "first", _overwrite: true },
    { overrideAccess: true }
  );
  await singlesOf(t).update(
    BANNER,
    { notice: "second", _overwrite: true },
    { overrideAccess: true }
  );
  const recorded = await t.adapter.select<{
    versionNo?: number;
    scopeSlug?: string;
  }>("nextly_versions", {});
  const first = recorded
    .filter(v => v.scopeSlug === BANNER && typeof v.versionNo === "number")
    .map(v => v.versionNo as number)
    .sort((a, b) => a - b)[0];
  if (first === undefined) throw new Error("the banner recorded no version");
  return first;
}

async function banner(t: TestNextly): Promise<Doc> {
  const read = await singlesOf(t).get(BANNER, { overrideAccess: true });
  return (read as { data: Doc }).data;
}

/** The code `restoreVersion` refused with, or "applied". */
async function directRestore(
  t: TestNextly,
  id: string,
  version: Doc
): Promise<string> {
  try {
    await restoreVersion({
      scopeKind: "collection",
      slug: POSTS,
      entryId: id,
      versionNo: 1,
      user: ADMIN as never,
      version,
    });
    return "applied";
  } catch (error) {
    return String((error as { code?: unknown }).code);
  }
}

describe.each(getConfiguredTestDialects())(
  "restoring an earlier version, judged by version (%s)",
  dialect => {
    it("refuses a restore from an out-of-date version on each surface", async () => {
      const t = await boot(dialect);
      const key = await adminKey(t);

      // A collection entry, over REST.
      const id = await postWithHistory(t);
      const read = await postRev(t, id);
      await handlerOf(t).updateEntry(
        { collectionName: POSTS, entryId: id, overrideAccess: true, user: ANA },
        { title: "Ana's", _overwrite: true }
      );
      const viaRest = await rest(
        "POST",
        ["collections", POSTS, "entries", id, "versions", "1", "restore"],
        key,
        { _rev: read }
      );
      expect(viaRest.status, JSON.stringify(viaRest.json)).toBe(409);
      // Its own code, never the generic conflict a restore's other 409s give.
      expect((viaRest.json.error as Doc).code).toBe("STALE_VERSION");
      expect((viaRest.json.error as Doc).data).toMatchObject({
        currentVersion: await postRev(t, id),
      });
      expect(await postTitle(t, id)).toBe("Ana's");

      // The function every way of restoring calls.
      expect(await directRestore(t, id, { _rev: read })).toBe("STALE_VERSION");
      expect(await postTitle(t, id)).toBe("Ana's");

      // A Single, over REST.
      const first = await bannerWithHistory(t);
      const bannerRead = String((await banner(t))._rev);
      await singlesOf(t).update(
        BANNER,
        { notice: "Ana's", _overwrite: true },
        { overrideAccess: true, user: ANA as never }
      );
      const single = await rest(
        "POST",
        ["singles", BANNER, "versions", String(first), "restore"],
        key,
        { _rev: bannerRead }
      );
      expect(single.status, JSON.stringify(single.json)).toBe(409);
      expect((single.json.error as Doc).code).toBe("STALE_VERSION");
      expect((await banner(t)).notice).toBe("Ana's");
    });

    it("refuses a restore whose version is not one, before anything is written", async () => {
      const t = await boot(dialect);
      const key = await adminKey(t);
      const id = await postWithHistory(t);
      const refused = await rest(
        "POST",
        ["collections", POSTS, "entries", id, "versions", "1", "restore"],
        key,
        { _rev: "seven" }
      );
      expect(refused.status, JSON.stringify(refused.json)).toBe(400);
      expect(await postTitle(t, id)).toBe("second");
    });

    it("applies a restore carrying the current version", async () => {
      const t = await boot(dialect);
      const key = await adminKey(t);
      const id = await postWithHistory(t);
      const restored = await rest(
        "POST",
        ["collections", POSTS, "entries", id, "versions", "1", "restore"],
        key,
        { _rev: await postRev(t, id) }
      );
      expect(restored.status, JSON.stringify(restored.json)).toBe(200);
      expect(await postTitle(t, id)).toBe("first");
      // The answer gives the version the restore produced, the one the next
      // read gives, so a save can follow without reading first.
      expect(restored.json._rev).toBe(await postRev(t, id));

      const first = await bannerWithHistory(t);
      const single = await rest(
        "POST",
        ["singles", BANNER, "versions", String(first), "restore"],
        key,
        { _rev: String((await banner(t))._rev) }
      );
      expect(single.status, JSON.stringify(single.json)).toBe(200);
      expect((await banner(t)).notice).toBe("first");
      expect(single.json._rev).toBe((await banner(t))._rev);
    });

    it("refuses a restore with no version, restoring nothing", async () => {
      const t = await boot(dialect);
      const key = await adminKey(t);
      const id = await postWithHistory(t);
      const before = await postTitle(t, id);
      const refused = await rest(
        "POST",
        ["collections", POSTS, "entries", id, "versions", "1", "restore"],
        key
      );
      expect(refused.status, JSON.stringify(refused.json)).toBe(428);
      expect((refused.json.error as Doc).code).toBe("VERSION_REQUIRED");
      expect(await postTitle(t, id)).toBe(before);
      expect(before).not.toBe("first");
    });

    it("applies a restore over a change with the overwrite choice, and records the overwrite", async () => {
      const t = await boot(dialect);
      const key = await adminKey(t);
      const id = await postWithHistory(t);
      const read = await postRev(t, id);
      await handlerOf(t).updateEntry(
        { collectionName: POSTS, entryId: id, overrideAccess: true, user: ANA },
        { title: "Ana's", _rev: read }
      );
      const restored = await rest(
        "POST",
        ["collections", POSTS, "entries", id, "versions", "1", "restore"],
        key,
        { _rev: read, _overwrite: true }
      );
      expect(restored.status, JSON.stringify(restored.json)).toBe(200);
      expect(await postTitle(t, id)).toBe("first");
      const overwrites = (
        await t.nextly.contentEvents.list({
          subject: { kind: "collection", slug: POSTS, id },
          limit: 100,
        })
      ).items.filter(e => e.kind === "overwritten");
      expect(overwrites.map(e => e.payload)).toEqual([
        expect.objectContaining({
          given: "stale",
          replaced: expect.objectContaining({ kind: "person", id: ANA.id }),
        }),
      ]);
    });
  }
);
