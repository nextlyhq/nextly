/**
 * Creating or updating an entry as published needs the publish permission as
 * well as the create or update one, asked through REST as a site's caller asks.
 *
 * Two callers hold create, read and update but not publish: a signed-in user
 * whose role leaves publish out, and a role-based API key whose role leaves it
 * out, made by a user who holds publish. Each is refused a create, an update,
 * a create in another language and a Single's update that name `published`,
 * and nothing they sent is stored. The same writes naming `draft` are allowed,
 * so the refusal is the publish and not the create; and a user and a key
 * granted publish are allowed the writes refused above, so it is the missing
 * grant. The key is judged on its own role, not its maker's.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { defineCollection, defineSingle, text } from "../../config";
import { seedAllPermissions } from "../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import { ServiceContainer } from "../../services/index";
import { buildClaims } from "../jwt/claims";
import { signAccessToken } from "../jwt/sign";

const ORIGIN = "http://localhost";

/** A collection with a draft and a published status. */
const POSTS = "rest_posts";
/** The same, localized. */
const PAGES = "rest_pages";
/** A Single with a draft and a published status. */
const BANNER = "rest_banner";

type Headers = Record<string, string>;

/** Who sends the writes: each without publish, and its counterpart with it. */
interface Callers {
  writer: Headers;
  writerKey: Headers;
  publisher: Headers;
  publisherKey: Headers;
}

/**
 * A role holding the fixture permissions whose action `actions` names. A
 * Single is never created, so it has no create permission to hold.
 */
async function roleWith(
  t: TestNextly,
  name: string,
  actions: readonly string[]
): Promise<string> {
  const wanted = new Set([
    ...[POSTS, PAGES].flatMap(slug => actions.map(a => `${a}-${slug}`)),
    ...actions.filter(a => a !== "create").map(a => `${a}-${BANNER}`),
  ]);
  const ids: string[] = [];
  for (let page = 1; ; page++) {
    const found = await t.nextly.permissions.find({ limit: 100, page });
    for (const permission of found.items) {
      if (wanted.has(permission.slug)) ids.push(String(permission.id));
    }
    if (!found.meta.hasNext) break;
  }
  expect(ids).toHaveLength(wanted.size);
  const role = await t.nextly.roles.create({
    data: { name, slug: name, permissionIds: ids },
  });
  return String(role.item.id);
}

/** A signed-in user holding `roleId`, with the cookie a session sends. */
async function userWith(
  t: TestNextly,
  name: string,
  roleId: string
): Promise<{ id: string; headers: Headers }> {
  const email = `${name}@publish-on-write.test`;
  const made = await t.nextly.users.create({
    email,
    password: "Password123!",
    data: { name, isActive: true },
  });
  const id = String((made.item as { id: string | number }).id);
  await new ServiceContainer(t.adapter).userRoles.assignRoleToUser(id, roleId);
  const token = await signAccessToken(
    buildClaims({
      userId: id,
      email,
      name,
      image: null,
      roleIds: [roleId],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  return { id, headers: { cookie: `nextly_session=${token}` } };
}

/** A role-based key `makerId` makes, holding `roleId` and nothing more. */
async function keyWith(
  t: TestNextly,
  makerId: string,
  roleId: string
): Promise<Headers> {
  const { key } = await t.getService("apiKeyService").createApiKey(makerId, {
    name: `key ${roleId}`,
    tokenType: "role-based",
    roleId,
    expiresIn: "unlimited",
  });
  return { authorization: `Bearer ${key}` };
}

async function seedCallers(t: TestNextly): Promise<Callers> {
  await seedAllPermissions();
  // The first user an install makes is its super-admin, who passes every
  // check, so one is made before the callers under test.
  await t.nextly.users.create({
    email: "root@publish-on-write.test",
    password: "Password123!",
    data: { name: "root", isActive: true },
  });
  const writes = ["create", "read", "update"];
  const writerRole = await roleWith(t, "writer", writes);
  const publisherRole = await roleWith(t, "publisher", [...writes, "publish"]);
  const writer = await userWith(t, "writer", writerRole);
  const publisher = await userWith(t, "publisher", publisherRole);
  return {
    writer: writer.headers,
    // Made by the publisher, who holds publish: the key holds only its role.
    writerKey: await keyWith(t, publisher.id, writerRole),
    publisher: publisher.headers,
    publisherKey: await keyWith(t, publisher.id, publisherRole),
  };
}

/** One request through the REST catch-all, as a site's caller sends it. */
function rest(
  method: "POST" | "PATCH",
  path: string,
  headers: Headers,
  body: unknown
): Promise<Response> {
  const segments = (path.split("?")[0] ?? "").split("/").filter(Boolean);
  const req = new Request(`${ORIGIN}/api/${path}`, {
    method,
    headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return createDynamicHandlers()[method](req, {
    params: Promise.resolve({ params: segments }),
  });
}

/**
 * The entries of `collection` titled `title`, as stored, read in `locale`
 * where one is given: a localized title is stored per language.
 */
async function stored(
  t: TestNextly,
  collection: string,
  title: string,
  locale?: string
) {
  const found = await t.nextly.find({
    collection,
    where: { title: { equals: title } },
    status: "all",
    ...(locale === undefined ? {} : { locale }),
  });
  return found.items as { status?: unknown }[];
}

/** A draft entry made by trusted code, for an update to publish. */
async function draftOf(t: TestNextly, title: string): Promise<string> {
  const made = await t.nextly.create({
    collection: POSTS,
    data: { title, status: "draft" },
  });
  return String((made.item as { id: string | number }).id);
}

/** The Single's headline and status as stored, or `null` with no document. */
async function singleNow(
  t: TestNextly
): Promise<{ headline: unknown; status: unknown } | null> {
  const found = (await t.nextly.findSingle({
    slug: BANNER,
    status: "all",
  })) as { headline?: unknown; status?: unknown } | null;
  return found && { headline: found.headline, status: found.status };
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`creating or updating as published needs publish, through REST (${dialect})`, () => {
    let t: TestNextly;
    let callers: Callers;

    beforeAll(async () => {
      // A refused write is logged by the gate that refuses it.
      vi.spyOn(console, "error").mockImplementation(() => {});
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        localization: { locales: ["en", "fr"], defaultLocale: "en" },
        collections: [
          defineCollection({
            slug: POSTS,
            status: true,
            fields: [text({ name: "title" })],
          }),
          defineCollection({
            slug: PAGES,
            localized: true,
            status: true,
            fields: [text({ name: "title" })],
          }),
        ],
        singles: [
          defineSingle({
            slug: BANNER,
            status: true,
            fields: [text({ name: "headline" })],
          }),
        ],
      });
      try {
        callers = await seedCallers(t);
      } catch (error) {
        await t.destroy();
        throw error;
      }
    }, 120_000);

    afterAll(async () => {
      vi.restoreAllMocks();
      await t?.destroy();
    });

    describe.each([
      ["a signed-in user", "writer", "publisher"],
      ["a role-based API key", "writerKey", "publisherKey"],
    ] as const)("%s", (_who, without, granted) => {
      it("is refused a create as published, and nothing is stored", async () => {
        const title = `${without} create published`;
        const res = await rest(
          "POST",
          `collections/${POSTS}/entries`,
          callers[without],
          { title, status: "published" }
        );
        expect(res.status).toBe(403);
        expect(await stored(t, POSTS, title)).toEqual([]);
      });

      it("is allowed the same create as a draft, so the refusal is the publish", async () => {
        const title = `${without} create draft`;
        const res = await rest(
          "POST",
          `collections/${POSTS}/entries`,
          callers[without],
          { title, status: "draft" }
        );
        expect(res.status).toBe(201);
        expect(await stored(t, POSTS, title)).toMatchObject([
          { status: "draft" },
        ]);
      });

      it("is refused an update to published, and the entry stays a draft", async () => {
        const title = `${without} update`;
        const id = await draftOf(t, title);
        const res = await rest(
          "PATCH",
          `collections/${POSTS}/entries/${id}`,
          callers[without],
          { status: "published" }
        );
        expect(res.status).toBe(403);
        expect(await stored(t, POSTS, title)).toMatchObject([
          { status: "draft" },
        ]);
      });

      it("is refused a create as published in another language", async () => {
        const title = `${without} create fr`;
        const res = await rest(
          "POST",
          `collections/${PAGES}/entries?locale=fr`,
          callers[without],
          { title, status: "published" }
        );
        expect(res.status).toBe(403);
        // Read in French, where the write would have landed, and in English.
        expect(await stored(t, PAGES, title, "fr")).toEqual([]);
        expect(await stored(t, PAGES, title)).toEqual([]);
      });

      it("is refused a Single's update to published, and it is left as it was", async () => {
        const before = await singleNow(t);
        expect(before).not.toBeNull();
        const res = await rest("PATCH", `singles/${BANNER}`, callers[without], {
          headline: `${without} banner`,
          status: "published",
        });
        expect(res.status).toBe(403);
        // Neither the content sent with the publish nor the status is stored.
        expect(await singleNow(t)).toEqual(before);
      });

      it("is allowed each of those writes once granted publish, so it is the missing grant", async () => {
        const title = `${granted} create published`;
        const created = await rest(
          "POST",
          `collections/${POSTS}/entries`,
          callers[granted],
          { title, status: "published" }
        );
        expect(created.status).toBe(201);
        expect(await stored(t, POSTS, title)).toMatchObject([
          { status: "published" },
        ]);

        const updatedTitle = `${granted} update`;
        const id = await draftOf(t, updatedTitle);
        const updated = await rest(
          "PATCH",
          `collections/${POSTS}/entries/${id}`,
          callers[granted],
          { status: "published" }
        );
        expect(updated.status).toBe(200);
        expect(await stored(t, POSTS, updatedTitle)).toMatchObject([
          { status: "published" },
        ]);

        const localized = await rest(
          "POST",
          `collections/${PAGES}/entries?locale=fr`,
          callers[granted],
          { title: `${granted} create fr`, status: "published" }
        );
        expect(localized.status).toBe(201);

        const single = await rest(
          "PATCH",
          `singles/${BANNER}`,
          callers[granted],
          {
            headline: `${granted} banner`,
            status: "published",
          }
        );
        expect(single.status).toBe(200);
        expect((await singleNow(t))?.status).toBe("published");
        // Back to a draft, so the next caller's refusal is seen on a draft.
        await t.nextly.updateSingle({
          slug: BANNER,
          data: { status: "draft" },
        });
      });
    });
  });
}
