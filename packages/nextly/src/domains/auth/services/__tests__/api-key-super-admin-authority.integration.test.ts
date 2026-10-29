/**
 * A full-access API key acts with super-admin authority while the person who
 * made it is an active super-admin, and with no more than its type allows
 * otherwise.
 *
 * Every read here is of `posts`, whose read rule refuses everyone: only
 * super-admin authority passes it, so a 200 says the key carried that
 * authority and a 403 says it did not. Each key holds the read permission,
 * so a refusal is the rule's and not a missing grant's.
 *
 * - The super-admin's full-access key passes; their read-only and role-based
 *   keys keep their types' limits, and so does a full-access key made by
 *   someone who is no super-admin.
 * - The authority is the key's own, decided for each request from its maker's
 *   standing: it goes when the maker loses the role, by removal, by
 *   deactivation or by the assignment expiring, and comes when an ordinary
 *   maker gains it, directly or through a role that inherits it, each seen by
 *   the key's next request within the bound the maker's own sessions follow.
 *   Every key is used before each change, so the next request has to see past
 *   anything kept from the first.
 * - A plugin route that narrows the key's scope carries none of it.
 * - The schema journal, kept for a super-admin, is read by that key.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { and, eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
  narrowScope,
  type AuthenticatedScope,
} from "../../../../auth/authenticated-scope";
import {
  SESSION_CUTOFF_SECONDS,
  resetSessionStandingForTests,
} from "../../../../auth/session/session-standing";
import { defineCollection, text } from "../../../../config";
import { getDialectTables } from "../../../../database/index";
import { seedAllPermissions } from "../../../../init/seed-permissions";
import { definePlugin } from "../../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../../routeHandler";
import { ServiceContainer } from "../../../../services/index";
import { EPOCH_TTL_MS } from "../../../../services/lib/rbac-epoch";
import type { ApiKeyService, ApiKeyTokenType } from "../api-key-service";

const PLUGIN = "@test/narrowing";

/** A key's scope a plugin route kept past the request it arrived with. */
let retained: AuthenticatedScope | undefined;

/** A read rule only super-admin authority passes. */
const posts = defineCollection({
  slug: "posts",
  access: { read: () => false },
  fields: [text({ name: "title" })],
});

/**
 * Two routes reading `posts` as the request's key: one hands the service the
 * key's scope as it arrived, the other a narrowed copy that keeps every grant.
 * Only narrowing differs between them.
 */
const narrowing = definePlugin({
  name: PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    routes: [
      {
        method: "POST",
        path: "/read",
        handler: async (_req, ctx) => {
          await ctx.services.collections.listEntries(
            "posts",
            {},
            {
              as: "user",
              user: ctx.user ?? undefined,
              authenticatedScope: ctx.authenticatedScope,
            }
          );
          // A refusal is thrown, and reaches the client as its status.
          return Response.json({});
        },
      },
      {
        method: "POST",
        path: "/retain",
        handler: async (_req, ctx) => {
          retained = ctx.authenticatedScope;
          return Response.json({});
        },
      },
      {
        method: "POST",
        path: "/read-retained",
        handler: async (_req, ctx) => {
          await ctx.services.collections.listEntries(
            "posts",
            {},
            {
              as: "user",
              user: ctx.user ?? undefined,
              authenticatedScope: retained,
            }
          );
          return Response.json({});
        },
      },
      {
        method: "POST",
        path: "/narrowed-read",
        handler: async (_req, ctx) => {
          const narrowed = narrowScope(ctx.authenticatedScope, () => true);
          await ctx.services.collections.listEntries(
            "posts",
            {},
            {
              as: "user",
              user: ctx.user ?? undefined,
              authenticatedScope: narrowed,
            }
          );
          // A refusal is thrown, and reaches the client as its status.
          return Response.json({});
        },
      },
    ],
  },
});

/** The part of the Direct API these tests drive, typed where the shim is not. */
interface Direct {
  users: {
    create(a: {
      email: string;
      password: string;
      data: Record<string, unknown>;
    }): Promise<{ item: { id: string | number } }>;
    update(a: { id: string; data: Record<string, unknown> }): Promise<unknown>;
  };
  permissions: {
    find(a: {
      limit: number;
    }): Promise<{ items: { id: string | number; slug: string }[] }>;
  };
  roles: {
    create(a: { data: Record<string, unknown> }): Promise<{
      item: { id: string | number };
    }>;
  };
}

interface Install {
  t: TestNextly;
  direct: Direct;
  services: ServiceContainer;
  superAdminRole: string;
  readersRole: string;
  readPosts: string;
}

let current: TestNextly | undefined;
afterEach(async () => {
  resetSessionStandingForTests();
  await current?.destroy();
  current = undefined;
});

/** A GET of the posts' entries through the REST dispatcher, with `key`. */
async function readPosts(key: string): Promise<number> {
  const res = await createDynamicHandlers().GET(
    new Request("http://localhost/api/collections/posts/entries", {
      headers: { authorization: `Bearer ${key}` },
    }),
    { params: Promise.resolve({ params: ["collections", "posts", "entries"] }) }
  );
  return res.status;
}

/** A GET of the schema journal through the REST dispatcher, with `key`. */
async function readJournal(key: string): Promise<number> {
  const res = await createDynamicHandlers().GET(
    new Request("http://localhost/api/schema/journal", {
      headers: { authorization: `Bearer ${key}` },
    }),
    { params: Promise.resolve({ params: ["schema", "journal"] }) }
  );
  return res.status;
}

/** One entry of `posts` through the REST dispatcher, with `key`. */
async function readPost(key: string, id: string): Promise<number> {
  const res = await createDynamicHandlers().GET(
    new Request(`http://localhost/api/collections/posts/entries/${id}`, {
      headers: { authorization: `Bearer ${key}` },
    }),
    {
      params: Promise.resolve({
        params: ["collections", "posts", "entries", id],
      }),
    }
  );
  return res.status;
}

/** Marks the entry's first version as seen, with `key`: status and message. */
async function markSeen(
  key: string,
  id: string
): Promise<{ status: number; message: string }> {
  const res = await createDynamicHandlers().PUT(
    new Request(
      `http://localhost/api/collections/posts/entries/${id}/versions/1/seen`,
      { method: "PUT", headers: { authorization: `Bearer ${key}` } }
    ),
    {
      params: Promise.resolve({
        params: [
          "collections",
          "posts",
          "entries",
          id,
          "versions",
          "1",
          "seen",
        ],
      }),
    }
  );
  const body = (await res.json()) as { error?: { message?: string } };
  return { status: res.status, message: body.error?.message ?? "" };
}

/** One of the narrowing plugin's routes, with `key`: the status it answered. */
async function pluginRead(
  sub: "read" | "narrowed-read" | "retain" | "read-retained",
  key: string
): Promise<number> {
  const res = await createDynamicHandlers().POST(
    new Request(`http://localhost/api/plugins/${PLUGIN}/${sub}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
    }),
    {
      params: Promise.resolve({
        params: ["plugins", ...PLUGIN.split("/"), sub],
      }),
    }
  );
  return res.status;
}

/** Runs `work` once the role version's read interval has passed. */
async function afterTheInterval<T>(work: () => Promise<T>): Promise<T> {
  await new Promise(resolve => setTimeout(resolve, EPOCH_TTL_MS + 50));
  return work();
}

/**
 * An expiry a few seconds ahead, on a whole second: SQLite and MySQL keep
 * whole seconds, so a fraction would lapse the role early.
 */
function wholeSecondsAhead(seconds: number): Date {
  return new Date((Math.floor(Date.now() / 1000) + seconds) * 1000);
}

async function waitUntilPast(at: Date): Promise<void> {
  const remaining = at.getTime() - Date.now();
  if (remaining > 0) {
    await new Promise(resolve => setTimeout(resolve, remaining + 50));
  }
}

describe.each(getConfiguredTestDialects())(
  "a full-access key made by a super-admin (%s)",
  (dialect: TestDialect) => {
    async function boot(): Promise<Install> {
      current = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [posts],
        plugins: [narrowing],
      });
      const t = current;
      const direct = t.nextly as unknown as Direct;
      const services = new ServiceContainer(t.adapter);
      await seedAllPermissions();
      // The install's first account is given super-admin, and stays one, so
      // a maker below can lose the role without being the last.
      await direct.users.create({
        email: "founder@example.com",
        password: "Str0ng-P@ssw0rd!",
        data: { name: "Founder", isActive: true },
      });
      const all = (await direct.permissions.find({ limit: 1000 })).items;
      const readPostsId = all.find(p => p.slug === "read-posts")?.id;
      if (readPostsId === undefined) throw new Error("read-posts not seeded");
      const readers = await direct.roles.create({
        data: {
          name: "Readers",
          slug: "readers",
          permissionIds: [String(readPostsId)],
        },
      });
      const superAdminRole = (await services.roles.ensureSuperAdminRole()).id;
      return {
        t,
        direct,
        services,
        superAdminRole,
        readersRole: String(readers.item.id),
        readPosts: String(readPostsId),
      };
    }

    /** A new active account holding the readers role, and `extra` if given. */
    async function maker(
      install: Install,
      name: string,
      extra?: { roleId: string; expiresAt?: Date }
    ): Promise<string> {
      const made = await install.direct.users.create({
        email: `${name}@example.com`,
        password: "Str0ng-P@ssw0rd!",
        data: { name, isActive: true, roles: [install.readersRole] },
      });
      const id = String(made.item.id);
      if (extra) {
        const assigned = await install.services.userRoles.assignRoleToUser(
          id,
          extra.roleId,
          extra.expiresAt ? { expiresAt: extra.expiresAt } : undefined
        );
        if (!assigned.success) throw new Error(assigned.message);
      }
      return id;
    }

    /** A key of `tokenType` made by `userId`; a role-based one on readers. */
    async function keyOf(
      install: Install,
      userId: string,
      tokenType: ApiKeyTokenType
    ): Promise<string> {
      const keys = install.t.getService(
        "apiKeyService"
      ) as unknown as ApiKeyService;
      const { key } = await keys.createApiKey(userId, {
        name: `${tokenType} key`,
        tokenType,
        ...(tokenType === "role-based" ? { roleId: install.readersRole } : {}),
        expiresIn: "unlimited",
      });
      return key;
    }

    it("passes a rule only super-admin authority passes, where the maker's read-only and role-based keys do not", async () => {
      const install = await boot();
      const root = await maker(install, "root", {
        roleId: install.superAdminRole,
      });
      const ordinary = await maker(install, "ordinary");

      expect(await readPosts(await keyOf(install, root, "full-access"))).toBe(
        200
      );
      // Each holds the read permission, and is refused by the rule.
      expect(await readPosts(await keyOf(install, root, "read-only"))).toBe(
        403
      );
      expect(await readPosts(await keyOf(install, root, "role-based"))).toBe(
        403
      );
      // The control: a full-access key whose maker is no super-admin.
      expect(
        await readPosts(await keyOf(install, ordinary, "full-access"))
      ).toBe(403);
    });

    it("loses it on the next request once the maker's super-admin role is removed", async () => {
      const install = await boot();
      const root = await maker(install, "root", {
        roleId: install.superAdminRole,
      });
      const key = await keyOf(install, root, "full-access");
      expect(await readPosts(key)).toBe(200);

      const removed = await install.services.userRoles.unassignRoleFromUser(
        root,
        install.superAdminRole
      );
      expect(removed.success).toBe(true);

      expect(await readPosts(key)).toBe(403);
    });

    it("loses it once another instance removes the maker's role and the role version is read again", async () => {
      const install = await boot();
      const root = await maker(install, "root", {
        roleId: install.superAdminRole,
      });
      const key = await keyOf(install, root, "full-access");
      expect(await readPosts(key)).toBe(200);

      // Another instance takes the role away: it deletes the row and moves
      // the shared role version, and nothing in this process is told.
      const tables = getDialectTables(dialect) as unknown as {
        userRoles: { userId: unknown; roleId: unknown };
        nextlyRbacEpoch: { id: unknown; revision: unknown };
      };
      const db = install.t.adapter.getDrizzle() as unknown as {
        delete: (table: unknown) => {
          where: (cond: unknown) => Promise<unknown>;
        };
        update: (table: unknown) => {
          set: (patch: unknown) => {
            where: (cond: unknown) => Promise<unknown>;
          };
        };
      };
      await db
        .delete(tables.userRoles)
        .where(
          and(
            eq(tables.userRoles.userId as never, root),
            eq(tables.userRoles.roleId as never, install.superAdminRole)
          )
        );
      await db
        .update(tables.nextlyRbacEpoch)
        .set({
          revision: sql`${tables.nextlyRbacEpoch.revision} + 5`,
          updatedAt: new Date(),
        })
        .where(eq(tables.nextlyRbacEpoch.id as never, "global"));

      expect(await afterTheInterval(() => readPosts(key))).toBe(403);
    });

    it("loses it while the maker is deactivated, and has it again once they are reactivated", async () => {
      const install = await boot();
      const root = await maker(install, "root", {
        roleId: install.superAdminRole,
      });
      const key = await keyOf(install, root, "full-access");
      expect(await readPosts(key)).toBe(200);

      await install.direct.users.update({
        id: root,
        data: { isActive: false },
      });
      expect(await readPosts(key)).toBe(401);

      await install.direct.users.update({
        id: root,
        data: { isActive: true },
      });
      expect(await readPosts(key)).toBe(200);
    });

    it("loses it once another instance deactivates the maker and the account's bound has passed", async () => {
      const install = await boot();
      const root = await maker(install, "root", {
        roleId: install.superAdminRole,
      });
      const key = await keyOf(install, root, "full-access");
      let offset = 0;
      resetSessionStandingForTests({ now: () => Date.now() + offset });
      expect(await readPosts(key)).toBe(200);

      const { users } = getDialectTables(dialect);
      const db = install.t.adapter.getDrizzle() as unknown as {
        update(table: unknown): {
          set(values: Record<string, unknown>): {
            where(condition: unknown): Promise<unknown>;
          };
        };
      };
      await db.update(users).set({ isActive: false }).where(eq(users.id, root));
      offset += SESSION_CUTOFF_SECONDS * 1000;

      expect(await readPosts(key)).toBe(401);
    });

    it("loses it once the maker's super-admin assignment expires", async () => {
      const install = await boot();
      const until = wholeSecondsAhead(3);
      const root = await maker(install, "brief", {
        roleId: install.superAdminRole,
        expiresAt: until,
      });
      const key = await keyOf(install, root, "full-access");
      expect(await readPosts(key)).toBe(200);

      await waitUntilPast(until);

      expect(await readPosts(key)).toBe(403);
    }, 20_000);

    it("gains it once an ordinary maker becomes super-admin directly, and through a role that inherits it", async () => {
      const install = await boot();
      const direct = await maker(install, "direct");
      const directKey = await keyOf(install, direct, "full-access");
      expect(await readPosts(directKey)).toBe(403);

      const assigned = await install.services.userRoles.assignRoleToUser(
        direct,
        install.superAdminRole
      );
      expect(assigned.success).toBe(true);
      expect(await readPosts(directKey)).toBe(200);

      // A second maker, whose only way to super-admin is a role inheriting it.
      const inheritor = await maker(install, "inheritor");
      const inheritorKey = await keyOf(install, inheritor, "full-access");
      expect(await readPosts(inheritorKey)).toBe(403);
      // A role whose children include super-admin inherits it.
      const chief = await install.direct.roles.create({
        data: {
          name: "Chief",
          slug: "chief",
          permissionIds: [install.readPosts],
          childRoleIds: [install.superAdminRole],
        },
      });
      const given = await install.services.userRoles.assignRoleToUser(
        inheritor,
        String(chief.item.id)
      );
      expect(given.success).toBe(true);

      expect(await readPosts(inheritorKey)).toBe(200);
    });

    it("carries none of it through a plugin route that narrows the key's scope", async () => {
      const install = await boot();
      const root = await maker(install, "root", {
        roleId: install.superAdminRole,
      });
      const key = await keyOf(install, root, "full-access");

      // The control: the same route shape, with the scope as it arrived.
      expect(await pluginRead("read", key)).toBe(200);
      // Narrowed to keep every grant, the scope is judged on those alone.
      expect(await pluginRead("narrowed-read", key)).toBe(403);
    });

    it("loses it in a scope a plugin keeps past its request, once the bound its maker's sessions follow has passed", async () => {
      const install = await boot();
      const root = await maker(install, "root", {
        roleId: install.superAdminRole,
      });
      const key = await keyOf(install, root, "full-access");
      expect(await pluginRead("retain", key)).toBe(200);
      expect(await pluginRead("read-retained", key)).toBe(200);

      const removed = await install.services.userRoles.unassignRoleFromUser(
        root,
        install.superAdminRole
      );
      expect(removed.success).toBe(true);
      // The key's next request carries none of it at once, and the kept scope
      // still does within the bound: so the read below is the kept scope's.
      expect(await readPosts(key)).toBe(403);
      expect(await pluginRead("read-retained", key)).toBe(200);

      await new Promise(resolve =>
        setTimeout(resolve, SESSION_CUTOFF_SECONDS * 1000 + 100)
      );
      expect(await pluginRead("read-retained", key)).toBe(403);
    }, 30_000);

    it("is judged the same by a route that checks the key itself and hands the Direct API its actor", async () => {
      const install = await boot();
      const root = await maker(install, "root", {
        roleId: install.superAdminRole,
      });
      const full = await keyOf(install, root, "full-access");
      const readOnly = await keyOf(install, root, "read-only");

      /** A custom route's read: the key checked, then its actor handed on. */
      const viaCheck = async (rawKey: string, handBuilt = false) => {
        const checked = await install.t.nextly.access.checkApiKey({ rawKey });
        expect(checked.valid).toBe(true);
        const actor: AuthenticatedScope | undefined = handBuilt
          ? {
              actorType: "apiKey",
              permissions: checked.permissions ?? [],
              roles: checked.roles ?? [],
            }
          : checked.actor;
        try {
          await install.t.nextly.find({
            collection: "posts",
            overrideAccess: false,
            user: { id: String(checked.userId) },
            actor,
          });
          return 200;
        } catch (error) {
          return (error as { statusCode?: number }).statusCode ?? 500;
        }
      };

      expect(await viaCheck(full)).toBe(await readPosts(full));
      expect(await viaCheck(full)).toBe(200);
      expect(await viaCheck(readOnly)).toBe(await readPosts(readOnly));
      expect(await viaCheck(readOnly)).toBe(403);
      // A scope built by hand from the same answer carries none of it.
      expect(await viaCheck(full, true)).toBe(403);
    });

    it("reads the schema journal, where the maker's read-only key may not", async () => {
      const install = await boot();
      const root = await maker(install, "root", {
        roleId: install.superAdminRole,
      });

      expect(await readJournal(await keyOf(install, root, "full-access"))).toBe(
        200
      );
      expect(await readJournal(await keyOf(install, root, "read-only"))).toBe(
        403
      );
    });

    it("is refused what is kept for a signed-in person, such as marking a version as seen", async () => {
      const install = await boot();
      const root = await maker(install, "root", {
        roleId: install.superAdminRole,
      });
      const key = await keyOf(install, root, "full-access");
      const created = await install.t.nextly.create({
        collection: "posts",
        data: { title: "Seen" },
      });
      const id = String(created.item.id);

      // The control: the key reads the entry, past a rule only super-admin
      // authority passes, so the refusal below is not a read refused.
      expect(await readPost(key, id)).toBe(200);
      const seen = await markSeen(key, id);
      expect(seen.status).toBe(403);
      expect(seen.message).toContain("signed-in person");
    });
  }
);
