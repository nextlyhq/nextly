/**
 * The New button's recent types through the real catch-all handler, the real
 * permission decision, the real preferences table and a real session:
 * `GET` and `POST /api/dashboard/new-types`.
 *
 * `new-types-service.test.ts` decides what is kept and what is read back over
 * fakes. Here the reader's create rights come from roles, the list is stored
 * in `nextly_dashboard_preferences`, and each person reads only their own.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { defineCollection, text } from "../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import { ServiceContainer } from "../../services";
import { sanitizeConfig } from "../../shared/types/config";

const posts = defineCollection({
  slug: "posts",
  fields: [text({ name: "title" })],
});
const pages = defineCollection({
  slug: "pages",
  fields: [text({ name: "title" })],
});

function handlers() {
  return createDynamicHandlers({
    config: sanitizeConfig({ collections: [posts, pages] }),
  });
}

describe.each(getConfiguredTestDialects())("on %s", dialect => {
  let handle: TestNextly | undefined;
  /** The instance's first user: its super admin, who may create in both. */
  let ownerId = "";
  /** A second person, whose role may create posts and nothing else. */
  let writerId = "";

  beforeEach(async () => {
    handle = await createTestNextly({ dialect, collections: [posts, pages] });
    ownerId = await userNamed("owner");
    writerId = await userNamed("writer");
    await grantRole(writerId, ["read-posts", "create-posts"]);
  });

  afterEach(async () => {
    await handle?.destroy();
    handle = undefined;
  });

  async function userNamed(name: string): Promise<string> {
    const nextly = handle!.nextly as unknown as {
      users: {
        create: (a: { data: Record<string, unknown> }) => Promise<{
          item: { id: string };
        }>;
      };
    };
    const created = await nextly.users.create({
      data: {
        email: `${name}@example.com`,
        password: "Password123!",
        name,
        isActive: true,
      },
    });
    return created.item.id;
  }

  async function grantRole(userId: string, slugs: string[]): Promise<void> {
    const nextly = handle!.nextly as unknown as {
      permissions: {
        find: (a: { limit: number }) => Promise<{
          items: { id: string; slug: string }[];
        }>;
      };
      roles: {
        create: (a: { data: Record<string, unknown> }) => Promise<{
          item: { id: string };
        }>;
      };
    };
    const permissions = await nextly.permissions.find({ limit: 300 });
    const ids = slugs.map(slug => {
      const found = permissions.items.find(p => p.slug === slug);
      expect(found, `\`${slug}\` must be seeded`).toBeDefined();
      return found!.id;
    });
    const role = await nextly.roles.create({
      data: { name: "Writer", slug: "writer", permissionIds: ids },
    });
    const assigned = await new ServiceContainer(
      handle!.adapter
    ).userRoles.assignRoleToUser(userId, role.item.id);
    expect(assigned.success).toBe(true);
  }

  async function sessionOf(userId: string): Promise<string> {
    const token = await signAccessToken(
      buildClaims({
        userId,
        email: `${userId}@example.com`,
        name: userId,
        image: null,
        roleIds: [],
        sessionEpoch: 0,
      }),
      process.env.NEXTLY_SECRET!
    );
    return `nextly_session=${token}`;
  }

  async function recent(cookie: string): Promise<string[]> {
    const response = await handlers().GET(
      new Request("http://localhost/api/dashboard/new-types", {
        headers: { cookie },
      }),
      { params: Promise.resolve({ params: ["dashboard", "new-types"] }) }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: { slug: string }[] };
    return body.items.map(item => item.slug);
  }

  function record(cookie: string, slug: string): Promise<Response> {
    return handlers().POST(
      new Request("http://localhost/api/dashboard/new-types", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ slug }),
      }),
      { params: Promise.resolve({ params: ["dashboard", "new-types"] }) }
    );
  }

  it("keeps each person's recent types, the most recent first, theirs alone", async () => {
    const owner = await sessionOf(ownerId);
    const writer = await sessionOf(writerId);
    expect((await record(owner, "posts")).status).toBe(200);
    expect((await record(owner, "pages")).status).toBe(200);
    expect((await record(writer, "posts")).status).toBe(200);

    expect(await recent(owner)).toEqual(["pages", "posts"]);
    expect(await recent(writer)).toEqual(["posts"]);
  });

  it("refuses a type the person may not create in, and keeps what was stored", async () => {
    const writer = await sessionOf(writerId);
    expect((await record(writer, "posts")).status).toBe(200);
    expect((await record(writer, "pages")).status).toBe(403);
    expect((await record(writer, "nowhere")).status).toBe(403);
    expect(await recent(writer)).toEqual(["posts"]);
  });

  it("refuses a request with no session", async () => {
    const response = await handlers().GET(
      new Request("http://localhost/api/dashboard/new-types"),
      { params: Promise.resolve({ params: ["dashboard", "new-types"] }) }
    );
    expect(response.status).toBe(401);
  });
});
