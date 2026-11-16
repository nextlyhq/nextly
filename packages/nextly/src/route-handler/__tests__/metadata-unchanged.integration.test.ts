/**
 * The admin's metadata reads answer "unchanged" only when an ordinary request
 * would send the same body, on every dialect, through the real catch-all
 * handler.
 *
 * Each read (the collection, Single and field group lists, and a collection's
 * and a Single's schema) answers with a tag (`ETag`). Asked again with that
 * tag (`If-None-Match`), it answers `304` with no body while the answer is the
 * same. The separating cases change what the body would hold, each through a
 * different input, and must get the full, new body: a handler that answers 304
 * to any tag, or one tagging fewer inputs than the body depends on, fails one.
 * - a field added in the Schema Builder (the schema);
 * - a role given, and a role whose assignment lapses (what the caller may
 *   read, the second moving no version);
 * - a code-defined read rule answering differently (state nothing versions);
 * - a field group's use count, shown only to a reader of every owner, turning
 *   to none when one owner stops being readable;
 * - another caller, whose answer differs, sending this caller's tag.
 * And a change that leaves the body as it was (an entry written) still
 * answers "unchanged". `If-None-Match: *` never answers "unchanged", so a
 * missing schema is still answered 404, and the startup request, which
 * answers several reads at once, answers every part in full.
 */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
  superAdminUser,
  userWhoMay,
} from "../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  text,
} from "../../config";
import { getDialectTables } from "../../database/index";
import { dispatchCollections } from "../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import type { ServiceContainer } from "../../services";

const NOTES = "unchanged_notes";
const GATED = "unchanged_gated";
/** What the gated collection's read rule reads: state no version follows. */
const gate = { open: true };
const TAGS = "unchanged_tags";
const HOME = "unchanged_home";
const CARD = "unchanged_card";
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
  gate.open = true;
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

/** The body `path` answers `userId` with in full, and its tag. */
async function answerOf(
  userId: string,
  path: string
): Promise<{ body: string; tag: string }> {
  const response = await get(userId, path);
  expect(response.status, path).toBe(200);
  const tag = response.headers.get("etag") ?? "";
  expect(tag, path).toMatch(/^W\/".+"$/);
  return { body: await response.text(), tag };
}

/**
 * Take `userId`'s answer to `path` and its tag, see the tag answered
 * "unchanged", run `change`, and send the tag again: the answer must be the
 * new body in full, the same an ordinary request now receives, under a new
 * tag. Asserts the change did change the body, so a case that never reached
 * its input cannot pass. Returns the new body.
 */
async function answeredAfter(
  userId: string,
  path: string,
  change: () => Promise<unknown>
): Promise<string> {
  const before = await answerOf(userId, path);
  expect((await get(userId, path, before.tag)).status, path).toBe(304);
  await change();
  const conditional = await get(userId, path, before.tag);
  expect(conditional.status, path).toBe(200);
  const body = await conditional.text();
  expect(body, "the change reached the body").not.toBe(before.body);
  expect(conditional.headers.get("etag")).not.toBe(before.tag);
  expect(body).toBe((await answerOf(userId, path)).body);
  return body;
}

/** The slugs a list's body names. */
function slugsOf(body: string): string[] {
  return (JSON.parse(body) as { items: { slug: string }[] }).items.map(
    item => item.slug
  );
}

/** A Drizzle handle, as far as these writes go. */
function rawDb(t: TestNextly) {
  return t.adapter.getDrizzle() as unknown as {
    select(fields: Record<string, unknown>): {
      from(table: unknown): {
        where(condition: unknown): Promise<Record<string, unknown>[]>;
      };
    };
    insert(table: unknown): {
      values(values: Record<string, unknown>): Promise<unknown>;
    };
    update(table: unknown): {
      set(values: Record<string, unknown>): {
        where(condition: unknown): Promise<unknown>;
      };
    };
  };
}

/** Give `to` every role `from` holds, by a row each. */
async function giveRolesOf(
  t: TestNextly,
  from: string,
  to: string
): Promise<void> {
  const { userRoles } = getDialectTables(t.adapter.dialect);
  const rows = await rawDb(t)
    .select({ roleId: userRoles.roleId })
    .from(userRoles)
    .where(eq(userRoles.userId, from));
  for (const row of rows) {
    await rawDb(t)
      .insert(userRoles)
      .values({
        id: `${to}-${String(row.roleId)}`,
        userId: to,
        roleId: row.roleId,
        createdAt: new Date(),
      });
  }
}

describe.each(getConfiguredTestDialects())(
  "a repeated metadata read (%s)",
  dialect => {
    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: NOTES,
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "card", component: CARD }),
            ],
          }),
          defineCollection({
            slug: GATED,
            access: { read: () => gate.open },
            fields: [text({ name: "title" })],
          }),
        ],
        singles: [
          defineSingle({ slug: HOME, fields: [text({ name: "heading" })] }),
        ],
        fieldGroups: [
          defineFieldGroup({ slug: CARD, fields: [text({ name: "heading" })] }),
        ],
      });
      await superAdminUser(current, EDITOR);
      return current;
    }

    it("answers 'unchanged', with no body, while the answer is the same", async () => {
      await boot();
      for (const path of READS) {
        const { tag } = await answerOf(EDITOR, path);
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

    it("answers 'unchanged' after a change that leaves the answer as it was", async () => {
      const t = await boot();
      const schema = `/collections/schema/${NOTES}`;
      const { tag } = await answerOf(EDITOR, schema);
      await t.nextly.create({
        collection: NOTES,
        data: { title: "An entry, not the schema" },
      });
      expect((await get(EDITOR, schema, tag)).status).toBe(304);
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
      const body = await answeredAfter(
        EDITOR,
        `/collections/schema/${TAGS}`,
        async () => {
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
        }
      );
      const now = (JSON.parse(body) as { fields: { name: string }[] }).fields;
      expect(now.map(field => field.name)).toContain("colour");
    }, 300_000);

    it("answers in full once the caller may read more", async () => {
      const t = await boot();
      await userWhoMay(t, READER, "read", [NOTES]);
      const body = await answeredAfter(READER, LIST, async () => {
        // A role that may read GATED, given to this reader too.
        await userWhoMay(t, `${READER}-2`, "read", [GATED]);
        await giveRolesOf(t, `${READER}-2`, READER);
      });
      expect(slugsOf(body)).toContain(GATED);
    }, 300_000);

    it("answers in full once a role the caller held lapses", async () => {
      const t = await boot();
      await userWhoMay(t, READER, "read", [NOTES]);
      // The role that lets the reader read NOTES lapses a few seconds from now.
      const lapses = Date.now() + 3000;
      const { userRoles } = getDialectTables(t.adapter.dialect);
      await rawDb(t)
        .update(userRoles)
        .set({ expiresAt: new Date(lapses) })
        .where(eq(userRoles.userId, READER));
      const body = await answeredAfter(
        READER,
        LIST,
        () =>
          new Promise(resolve =>
            setTimeout(resolve, Math.max(0, lapses - Date.now()) + 500)
          )
      );
      expect(slugsOf(body)).not.toContain(NOTES);
    }, 300_000);

    it("answers a list in full once a read rule answers differently", async () => {
      const t = await boot();
      await userWhoMay(t, READER, "read", [NOTES, GATED]);
      // The rule now refuses: no version moves, and the list is different.
      const body = await answeredAfter(READER, LIST, async () => {
        gate.open = false;
      });
      expect(slugsOf(body)).not.toContain(GATED);
    }, 300_000);

    it("answers a field group's use count in full once it is no longer shown", async () => {
      const t = await boot();
      // A reader of every collection and Single is shown how often each field
      // group is placed; one who cannot read them all is shown none.
      await userWhoMay(t, READER, "read", [NOTES, GATED, HOME]);
      const placedBy = (body: string) =>
        (
          JSON.parse(body) as { items: { slug: string; placedBy: unknown }[] }
        ).items.find(item => item.slug === CARD)?.placedBy;
      const shown = await answerOf(READER, "/field-groups");
      expect(placedBy(shown.body)).toEqual(expect.any(Number));
      const body = await answeredAfter(READER, "/field-groups", async () => {
        gate.open = false;
      });
      expect(placedBy(body)).toBeNull();
    }, 300_000);

    it("answers another caller whose answer differs in full, whatever tag it sends", async () => {
      const t = await boot();
      await userWhoMay(t, READER, "read", [NOTES]);
      const editors = await answerOf(EDITOR, LIST);
      const answer = await get(READER, LIST, editors.tag);
      expect(answer.status).toBe(200);
      expect(await answer.text()).not.toBe(editors.body);
    }, 300_000);

    it("answers `If-None-Match: *` in full, and a missing schema 404", async () => {
      await boot();
      // A schema that does not exist is answered as missing, not "unchanged".
      const missing = await get(EDITOR, "/collections/schema/no_such_one", "*");
      expect(missing.status).toBe(404);
      const present = await get(EDITOR, `/collections/schema/${NOTES}`, "*");
      expect(present.status).toBe(200);
    }, 300_000);

    it("answers every part of the startup request in full", async () => {
      await boot();
      const { tag } = await answerOf(EDITOR, LIST);
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
