/**
 * The admin's metadata reads answer "unchanged" from the versions, on every
 * dialect, through the real catch-all handler.
 *
 * Each read (the collection, Single and field group lists, and a collection's
 * and a Single's schema) answers with a tag (`ETag`). Asked again with that
 * tag (`If-None-Match`), it answers `304` with no body. The separating cases
 * are what must NOT be answered "unchanged", since a handler that answers 304
 * to any tag passes the first half alone:
 * - after a schema change (a field added in the Schema Builder), the old tag
 *   gets the full, new answer;
 * - after a change to what the caller may read (a role granted), the old tag
 *   gets the full answer;
 * - another caller sending this caller's tag gets the full answer.
 * The startup request, which answers several reads at once, never answers a
 * part "unchanged", whatever it is sent.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  superAdminUser,
  userWhoMay,
} from "../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { defineCollection, defineSingle, text } from "../../config";
import { dispatchCollections } from "../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import type { ServiceContainer } from "../../services";

const NOTES = "unchanged_notes";
const TAGS = "unchanged_tags";
const HOME = "unchanged_home";
const EDITOR = "unchanged-editor";
const READER = "unchanged-reader";
const ORIGIN = "http://localhost";

/** Every metadata read the admin makes again, as it spells them. */
const READS = [
  "/collections?limit=100&page=1&sortBy=name&sortOrder=asc",
  `/collections/schema/${NOTES}`,
  `/collections/${NOTES}`,
  "/singles",
  `/singles/${HOME}/schema`,
  "/field-groups",
];
const LIST = READS[0];

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A session cookie for `userId`. */
async function sessionOf(userId: string): Promise<string> {
  const token = await signAccessToken(
    buildClaims({
      userId,
      email: `${userId}@example.test`,
      name: userId,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  return `nextly_session=${token}`;
}

/** A GET of `path` within the admin API, as `userId`, holding `tag`. */
async function get(
  userId: string,
  path: string,
  tag?: string
): Promise<Response> {
  const url = new URL(`${ORIGIN}/admin/api${path}`);
  const params = url.pathname
    .slice("/admin/api/".length)
    .split("/")
    .filter(Boolean);
  const headers: Record<string, string> = {
    origin: ORIGIN,
    cookie: await sessionOf(userId),
  };
  if (tag !== undefined) headers["if-none-match"] = tag;
  return createDynamicHandlers().GET(new Request(url, { headers }), {
    params: Promise.resolve({ params }),
  });
}

/** The tag `path` answers `userId` with, asserting it answered in full. */
async function tagOf(userId: string, path: string): Promise<string> {
  const response = await get(userId, path);
  expect(response.status, path).toBe(200);
  const tag = response.headers.get("etag");
  expect(tag, path).toMatch(/^W\/".+"$/);
  return tag ?? "";
}

describe.each(getConfiguredTestDialects())(
  "a repeated metadata read (%s)",
  dialect => {
    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({ slug: NOTES, fields: [text({ name: "title" })] }),
        ],
        singles: [
          defineSingle({ slug: HOME, fields: [text({ name: "heading" })] }),
        ],
      });
      await superAdminUser(current, EDITOR);
      return current;
    }

    it("answers 'unchanged', with no body, to a caller holding the current answer", async () => {
      await boot();
      for (const path of READS) {
        const tag = await tagOf(EDITOR, path);
        const again = await get(EDITOR, path, tag);
        expect(again.status, path).toBe(304);
        expect(await again.text(), path).toBe("");
        expect(again.headers.get("etag"), path).toBe(tag);
        // Signed in, so still kept by no shared cache.
        expect(again.headers.get("cache-control"), path).toContain("no-store");
        // A tag that is not the current one is answered in full.
        expect((await get(EDITOR, path, 'W/"other"')).status, path).toBe(200);
      }
    }, 300_000);

    it("answers in full once the schema changed", async () => {
      const t = await boot();
      // A Builder collection, saved before the tag is taken.
      const fields = [{ name: "name", type: "text" }];
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: TAGS, label: TAGS, fields }
      );
      const schema = `/collections/schema/${TAGS}`;
      const tag = await tagOf(EDITOR, schema);
      expect((await get(EDITOR, schema, tag)).status).toBe(304);

      // A field added: a schema change, and no change to who may read what.
      const row = await t.adapter.selectOne<{ schema_version?: unknown }>(
        "dynamic_collections",
        { where: { and: [{ column: "slug", op: "=", value: TAGS }] } }
      );
      await dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: TAGS },
        {
          fields: [...fields, { name: "colour", type: "text" }],
          confirmed: true,
          schemaVersion: Number(row?.schema_version ?? 1),
        }
      );
      const after = await get(EDITOR, schema, tag);
      expect(after.status).toBe(200);
      expect(after.headers.get("etag")).not.toBe(tag);
      const body = (await after.json()) as { fields: { name: string }[] };
      expect(body.fields.map(field => field.name)).toContain("colour");
    }, 300_000);

    it("answers in full once what the caller may read changed", async () => {
      const t = await boot();
      await userWhoMay(t, READER, "read", [NOTES]);
      const tag = await tagOf(READER, LIST);
      expect((await get(READER, LIST, tag)).status).toBe(304);

      await grantTo(t, READER, "update", [NOTES]);
      expect((await get(READER, LIST, tag)).status).toBe(200);
    }, 300_000);

    it("answers another caller in full, whatever tag it sends", async () => {
      const t = await boot();
      await userWhoMay(t, READER, "read", [NOTES]);
      const editors = await tagOf(EDITOR, LIST);
      const answer = await get(READER, LIST, editors);
      expect(answer.status).toBe(200);
      expect(answer.headers.get("etag")).not.toBe(editors);
    }, 300_000);

    it("answers every part of the startup request in full", async () => {
      await boot();
      const tag = await tagOf(EDITOR, LIST);
      const response = await get(
        EDITOR,
        `/startup?path=${encodeURIComponent(LIST)}`,
        tag
      );
      expect(response.status).toBe(200);
      const { parts } = (await response.json()) as {
        parts: { status: number; body: { items?: unknown[] } }[];
      };
      expect(parts[0]?.status).toBe(200);
      expect(parts[0]?.body.items?.length).toBeGreaterThan(0);
    }, 300_000);
  }
);
