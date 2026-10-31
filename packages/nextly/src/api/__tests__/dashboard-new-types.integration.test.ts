/**
 * The New button's recent types through the real catch-all handler, the real
 * permission decision, the real preferences table and a real session:
 * `GET` and `POST /api/dashboard/new-types`.
 *
 * `new-types-service.test.ts` decides what is kept and what is read back over
 * fakes. Here the reader's create rights come from roles and rules, the list
 * is stored in `nextly_dashboard_preferences`, and each person reads only
 * their own.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { defineCollection, text } from "../../config";
import type { AccessRuleContext } from "../../shared/types/access";
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
/**
 * Created in English, the default language, alone: a create judged in the
 * language New's create writes is allowed, and one judged in every language
 * is refused.
 */
const notes = defineCollection({
  slug: "notes",
  localized: true,
  access: {
    create: ({ locale }: AccessRuleContext) => locale === "en",
    read: () => true,
  },
  fields: [text({ name: "body", localized: true })],
});
const COLLECTIONS = [posts, pages, notes];
const LOCALIZATION = { locales: ["en", "fr"], defaultLocale: "en" };

function handlers() {
  return createDynamicHandlers({
    config: sanitizeConfig({
      collections: COLLECTIONS,
      localization: LOCALIZATION,
    }),
  });
}

describe.each(getConfiguredTestDialects())("on %s", dialect => {
  let handle: TestNextly | undefined;
  /** The instance's first user: its super admin, who may create in both. */
  let ownerId = "";
  /** A second person, whose role may create posts and nothing else. */
  let writerId = "";

  beforeEach(async () => {
    handle = await createTestNextly({
      dialect,
      collections: COLLECTIONS,
      localization: LOCALIZATION,
    });
    ownerId = await userNamed("owner");
    writerId = await userNamed("writer");
    await grantRole(writerId, [
      "read-posts",
      "create-posts",
      "read-notes",
      "create-notes",
    ]);
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

  it("judges a type in the language its create writes, as the admin offers it", async () => {
    // The rule admits English alone. New's create names no language, so it
    // writes English and the rule allows it; the admin offers the type, and
    // the list keeps it.
    const writer = await sessionOf(writerId);
    expect((await record(writer, "notes")).status).toBe(200);
    expect(await recent(writer)).toEqual(["notes"]);
  });

  it("keeps both of two types recorded at once", async () => {
    const owner = await sessionOf(ownerId);
    const [first, second] = await Promise.all([
      record(owner, "posts"),
      record(owner, "pages"),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    // Either may land first; neither may be lost.
    expect([...(await recent(owner))].sort()).toEqual(["pages", "posts"]);
  });

  it("refuses a request with no session", async () => {
    const response = await handlers().GET(
      new Request("http://localhost/api/dashboard/new-types"),
      { params: Promise.resolve({ params: ["dashboard", "new-types"] }) }
    );
    expect(response.status).toBe(401);
  });
});
