/**
 * The trash through REST, and a relation to a trashed entry.
 *
 * A signed-in person's REST delete moves the entry to the trash with who
 * deleted it; `GET /trash` lists it to them, `POST /trash/restore` brings it
 * back, and `POST /trash/empty` removes it for good. While it is in the
 * trash, an entry relating to it reads as relating to nothing, as it would
 * to a deleted entry.
 *
 * @module domains/trash/__tests__/trash-rest.integration.test
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { superAdminUser } from "../../../__tests__/fixtures/permission-holders";
import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { defineCollection, relationship, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";

perLanguageStorageSuite();

const POSTS = "trashrest_posts";
const NOTES = "trashrest_notes";
const ADMIN = "trashrest-admin";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: POSTS,
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: NOTES,
        fields: [
          text({ name: "title" }),
          relationship({ name: "post", relationTo: POSTS }),
        ],
      }),
    ],
  });
  await superAdminUser(current, ADMIN);
  return current;
}

/** A REST call as the signed-in admin; its status and JSON body. */
async function rest(
  method: "GET" | "POST" | "DELETE",
  path: string[],
  options: { query?: string; body?: unknown } = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const token = await signAccessToken(
    buildClaims({
      userId: ADMIN,
      email: `${ADMIN}@example.test`,
      name: ADMIN,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET!
  );
  const url = `http://localhost/api/${path.join("/")}${options.query ?? ""}`;
  const request = new Request(url, {
    method,
    headers: {
      origin: "http://localhost",
      cookie: `nextly_session=${token}`,
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  const handlers = createDynamicHandlers();
  const context = { params: Promise.resolve({ params: path }) };
  const res = await handlers[method](request, context);
  const text = await res.text();
  return {
    status: res.status,
    body: text === "" ? {} : (JSON.parse(text) as Record<string, unknown>),
  };
}

describe.each(getConfiguredTestDialects())("on %s", dialect => {
  it("a REST delete goes to the trash with who deleted it, and REST lists, restores and empties it", async () => {
    const t = await boot(dialect);
    const made = await t.nextly.create({
      collection: POSTS,
      data: { title: "By REST" },
    });
    const id = String(made.item.id);

    const deleted = await rest("DELETE", ["collections", POSTS, "entries", id]);
    expect(deleted.status).toBe(200);

    const listed = await rest("GET", ["trash"], {
      query: `?collection=${POSTS}`,
    });
    expect(listed.status).toBe(200);
    expect(listed.body.items).toEqual([
      expect.objectContaining({
        itemId: id,
        scopeSlug: POSTS,
        label: "By REST",
        trashedByKind: "user",
        trashedById: ADMIN,
      }),
    ]);
    expect(listed.body.meta).toMatchObject({ total: 1, page: 1 });

    const restored = await rest("POST", ["trash", "restore"], {
      body: { id },
    });
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ restored: true, id });
    expect(
      (await t.nextly.findByID({ collection: POSTS, id })) as unknown
    ).toMatchObject({ id, title: "By REST" });

    await rest("DELETE", ["collections", POSTS, "entries", id]);
    const emptied = await rest("POST", ["trash", "empty"], {
      body: { collection: POSTS },
    });
    expect(emptied.status).toBe(200);
    expect(emptied.body).toMatchObject({ removed: 1 });
    const after = await rest("GET", ["trash"]);
    expect(after.body.items).toEqual([]);
  });

  it("an entry relating to a trashed one reads none of its content, and reads it again once it is restored", async () => {
    const t = await boot(dialect);
    const post = await t.nextly.create({
      collection: POSTS,
      data: { title: "Target" },
    });
    const postId = String(post.item.id);
    const note = await t.nextly.create({
      collection: NOTES,
      data: { title: "Points at it", post: postId },
    });
    const noteId = String(note.item.id);

    await t.nextly.delete({ collection: POSTS, id: postId });

    const read = async () =>
      ((await t.nextly.findByID({
        collection: NOTES,
        id: noteId,
        depth: 1,
      })) as unknown as Record<string, unknown>).post;

    // Not populated: the note keeps only the id it held, as it would after
    // any delete, and none of the trashed entry's content reaches it.
    const whileTrashed = await read();
    expect(whileTrashed).not.toEqual(
      expect.objectContaining({ title: "Target" })
    );
    expect(JSON.stringify(whileTrashed ?? null)).not.toContain("Target");

    await t.nextly.trash.restore({ id: postId });

    expect(await read()).toEqual(
      expect.objectContaining({ id: postId, title: "Target" })
    );
  });
});
