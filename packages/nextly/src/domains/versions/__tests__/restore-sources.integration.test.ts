/**
 * The version a restored value came from is recorded per field, on the version
 * the write that saves it records.
 *
 * Two writes carry restored values: a restore through the API, which records
 * its own version for every field it writes, and an editor's save after a
 * restore, which names each restored field's version in `_restoredFrom`. A
 * named field is recorded only when the save stores the value that version
 * holds: a restored value undone or overwritten before the save carries no
 * source. Retention keeps every version a recorded source names, so "Restored
 * from" never points at a version that is gone.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { superAdminUser } from "../../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { defineCollection, number, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { ServiceContainer } from "../../../services/index";
import type { VersionsService } from "../versions-service";

const ORIGIN = "http://localhost";
/** Kept with drafts, and at most three versions beyond the protected ones. */
const POSTS = "rsposts";
const ADMIN = "sourcer";

let handle: TestNextly | undefined;
let cookie: Record<string, string> = {};

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

async function boot(dialect: TestDialect): Promise<CollectionEntryService> {
  handle = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: POSTS,
        status: true,
        versions: { drafts: true, maxPerDoc: 3 },
        fields: [
          text({ name: "title" }),
          text({ name: "body" }),
          number({ name: "views" }),
        ],
      }),
    ],
  });
  await superAdminUser(handle, ADMIN);
  const role = await new ServiceContainer(
    handle.adapter
  ).roles.ensureSuperAdminRole();
  const token = await signAccessToken(
    buildClaims({
      userId: ADMIN,
      email: `${ADMIN}@example.test`,
      name: ADMIN,
      image: null,
      roleIds: [String(role.id)],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  cookie = { cookie: `nextly_session=${token}` };
  return (
    handle.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as CollectionEntryService;
}

const versions = () => handle!.getService<VersionsService>("versionsService");
const ref = (entryId: string) => ({
  scopeKind: "collection" as const,
  scopeSlug: POSTS,
  entryId,
});

/** Writes `data` as an editor's save does, over whatever is there now. */
async function save(
  entries: CollectionEntryService,
  id: string,
  data: Record<string, unknown>
): Promise<number> {
  const saved = await entries.updateEntry(
    { collectionName: POSTS, entryId: id, overrideAccess: true },
    { ...data, _overwrite: true }
  );
  expect(saved.success, JSON.stringify(saved)).toBe(true);
  return newestVersion(id);
}

/** The newest durable version of the entry: the one the last write recorded. */
async function newestVersion(entryId: string): Promise<number> {
  const parts = await versions().listPartVersions(ref(entryId));
  return Math.max(...parts.map(part => part.versionNo));
}

/** Every durable version the entry still has, oldest first. */
async function kept(entryId: string): Promise<number[]> {
  const parts = await versions().listPartVersions(ref(entryId));
  return [...new Set(parts.map(part => part.versionNo))].sort((a, b) => a - b);
}

/** The sources the version records, or null for none. */
async function sourcesOf(
  entryId: string,
  versionNo: number
): Promise<Record<string, number> | null> {
  const row = await versions().get(ref(entryId), versionNo);
  return row.fieldSources ?? null;
}

/** A draft document with three saved versions: t1/b1, t2/b2 and t3/b3. */
async function threeVersions(
  entries: CollectionEntryService
): Promise<{ id: string; a: number; b: number; c: number }> {
  const created = await entries.createEntry(
    { collectionName: POSTS, overrideAccess: true },
    { title: "t1", body: "b1", views: 0 }
  );
  expect(created.success, JSON.stringify(created)).toBe(true);
  const id = (created.data as { id: string }).id;
  const a = await newestVersion(id);
  const b = await save(entries, id, { title: "t2", body: "b2" });
  const c = await save(entries, id, { title: "t3", body: "b3" });
  return { id, a, b, c };
}

describe.each(getConfiguredTestDialects())(
  "a restored field's source version (%s)",
  dialect => {
    it("records the version a restore through the API wrote each field from", async () => {
      const entries = await boot(dialect);
      const { id, a } = await threeVersions(entries);

      const res = await createDynamicHandlers().POST(
        new Request(
          `${ORIGIN}/api/collections/${POSTS}/entries/${id}/versions/${a}/restore`,
          {
            method: "POST",
            headers: {
              origin: ORIGIN,
              "content-type": "application/json",
              ...cookie,
            },
            body: JSON.stringify({ _overwrite: true, fields: ["title"] }),
          }
        ),
        {
          params: Promise.resolve({
            params: [
              "collections",
              POSTS,
              "entries",
              id,
              "versions",
              String(a),
              "restore",
            ],
          }),
        }
      );
      expect(res.status, await res.clone().text()).toBe(200);

      expect(await sourcesOf(id, await newestVersion(id))).toEqual({
        title: a,
      });
    }, 120_000);

    it("records each restored field's version on the save, from two versions, and keeps both", async () => {
      const entries = await boot(dialect);
      const { id, a, b, c } = await threeVersions(entries);

      // The title restored from the first version, the body from the second.
      const restoredSave = await save(entries, id, {
        title: "t1",
        body: "b2",
        _restoredFrom: { title: a, body: b },
      });
      expect(await sourcesOf(id, restoredSave)).toEqual({ title: a, body: b });

      // Never stored as a value of the document.
      const read = await entries.getEntry({
        collectionName: POSTS,
        entryId: id,
        overrideAccess: true,
      });
      expect(read.data as Record<string, unknown>).not.toHaveProperty(
        "_restoredFrom"
      );

      // Later saves push the history past its cap of three: the third
      // version, which nothing names, goes, and both sources stay with the
      // save that names them.
      await save(entries, id, { views: 1 });
      await save(entries, id, { views: 2 });
      await save(entries, id, { views: 3 });
      const after = await kept(id);
      expect(after).not.toContain(c);
      expect(after).toEqual(expect.arrayContaining([a, b, restoredSave]));
    }, 120_000);

    it("records no source for a restored value undone before the save", async () => {
      const entries = await boot(dialect);
      const { id, a, b } = await threeVersions(entries);

      // The title was restored from the first version and then edited again;
      // the body still holds what the second version holds.
      const restoredSave = await save(entries, id, {
        title: "t9",
        body: "b2",
        _restoredFrom: { title: a, body: b },
      });
      expect(await sourcesOf(id, restoredSave)).toEqual({ body: b });
    }, 120_000);
  }
);
