/**
 * Which of the dashboard summary's installation-wide counts each caller is
 * given, through the real catch-all handler, on every configured dialect.
 *
 * The summary used to answer every signed-in caller with how many users,
 * roles, permissions, media items, field groups and active API keys exist.
 * Each is now given only to a caller its own list endpoint would admit, and is
 * LEFT OUT for anyone else: a zero would still be an answer, and one that
 * changes when the rows behind it do.
 */

// Must be set before the harness boots (env validation) and to sign tokens.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { apiKeys as apiKeysMysql } from "../../../schemas/api-keys/mysql";
import { apiKeys as apiKeysPg } from "../../../schemas/api-keys/postgres";
import { apiKeys as apiKeysSqlite } from "../../../schemas/api-keys/sqlite";
import { ServiceContainer } from "../../index";

// Each case makes real requests through the whole handler. Set
// NEXTLY_TEST_SLOW_DB=1 when the database is across a network; CI keeps the
// package default, so a slow query there still fails.
if (process.env.NEXTLY_TEST_SLOW_DB === "1") {
  vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });
}

const NOTES = "notes";
const notes = defineCollection({
  slug: NOTES,
  fields: [text({ name: "title" })],
});

/** The six counts, by the name each is reported under here. */
const ADMIN_COUNTS = [
  "apiKeys",
  "fieldGroups",
  "media",
  "permissions",
  "roles",
  "users",
] as const;

type StatsBody = Record<string, unknown> & {
  content: Record<string, unknown>;
};

/**
 * Which of the six counts a response CARRIES, each checked to be a number.
 *
 * Present-and-numeric or absent: a field that is there as `null`, `0` sent in
 * place of a refusal, or a string fails this rather than reading as either.
 */
function carried(body: StatsBody): string[] {
  const fields: Record<(typeof ADMIN_COUNTS)[number], [object, string]> = {
    apiKeys: [body, "apiKeys"],
    fieldGroups: [body, "fieldGroups"],
    media: [body.content, "totalMedia"],
    permissions: [body, "permissions"],
    roles: [body, "roles"],
    users: [body, "users"],
  };
  return ADMIN_COUNTS.filter(name => {
    const [holder, key] = fields[name];
    if (!(key in holder)) return false;
    expect(
      typeof (holder as Record<string, unknown>)[key],
      `${name} is present, so it must be a count`
    ).toBe("number");
    return true;
  });
}

describe.each(getConfiguredTestDialects())(
  "the dashboard summary's admin counts (%s)",
  dialect => {
    let handle: TestNextly;
    let services: ServiceContainer;
    /** The first account, which core makes super-admin. */
    let admin: Caller;
    /** A role holding `read-users` and nothing else. */
    let usersReader: Caller;
    /** A role holding only a content grant: no admin permission at all. */
    let contentOnly: Caller;
    /** An API key whose role holds `read-roles` alone. */
    let rolesKey: string;
    /** A key administrator who is not a super-admin, owning exactly one key. */
    let keyAdmin: Caller;

    interface Caller {
      id: string;
      roleIds: string[];
    }

    const nextly = () =>
      handle.nextly as unknown as {
        users: {
          create: (a: { data: Record<string, unknown> }) => Promise<{
            item: { id: string };
          }>;
        };
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

    const apiKeys = () =>
      handle.getService("apiKeyService") as unknown as {
        createApiKey: (
          userId: string,
          input: {
            name: string;
            tokenType: string;
            roleId?: string;
            expiresIn: string;
          }
        ) => Promise<{ key: string; meta: { id: string } }>;
        revokeApiKey: (id: string, userId: string) => Promise<void>;
      };

    /**
     * Lapses a key a day ago by its row, since no request makes a key that is already expired.
     * The api_keys table of the dialect under test, as the key service picks it.
     */
    async function expire(keyId: string): Promise<void> {
      const table = {
        postgresql: apiKeysPg,
        mysql: apiKeysMysql,
        sqlite: apiKeysSqlite,
      }[dialect] as typeof apiKeysPg;
      const db = handle.adapter.getDrizzle() as unknown as {
        update: (t: unknown) => {
          set: (values: unknown) => {
            where: (cond: unknown) => Promise<unknown>;
          };
        };
      };
      await db
        .update(table)
        .set({ expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) })
        .where(eq(table.id, keyId));
    }

    async function account(email: string): Promise<string> {
      const created = await nextly().users.create({
        data: { email, password: "Password123!", name: email, isActive: true },
      });
      return created.item.id;
    }

    /** A role holding exactly the named, seeded permissions. */
    async function role(slug: string, permissionSlugs: string[]) {
      const seeded = await nextly().permissions.find({ limit: 1000 });
      const ids = permissionSlugs.map(wanted => {
        const found = seeded.items.find(p => p.slug === wanted);
        expect(
          found,
          `\`${wanted}\` must be seeded, or the role grants nothing and each ` +
            "refusal below is for the wrong reason"
        ).toBeDefined();
        return found!.id;
      });
      const created = await nextly().roles.create({
        data: { name: slug, slug, permissionIds: ids },
      });
      return created.item.id;
    }

    async function withRole(email: string, roleId: string): Promise<Caller> {
      const id = await account(email);
      await services.userRoles.assignRoleToUser(id, roleId);
      return { id, roleIds: [roleId] };
    }

    async function sessionHeaders(caller: Caller) {
      const token = await signAccessToken(
        buildClaims({
          userId: caller.id,
          email: `${caller.id}@example.com`,
          name: caller.id,
          image: null,
          roleIds: caller.roleIds,
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET!
      );
      return { cookie: `nextly_session=${token}` };
    }

    async function stats(headers: Record<string, string>): Promise<StatsBody> {
      const res = await createDynamicHandlers().GET(
        new Request("http://localhost/api/dashboard/stats", { headers }),
        { params: Promise.resolve({ params: ["dashboard", "stats"] }) }
      );
      expect(res.status).toBe(200);
      return (await res.json()) as StatsBody;
    }

    /**
     * The keys the API-key list shows this caller: how many in all, and how many of them the
     * summary counts, the active and unexpired ones. Read from the list endpoint itself, so the
     * count is held to the list rather than to a number written here. The list takes no filter,
     * so the active-and-unexpired cut is made here, and the case below seeds a revoked and an
     * expired key so the cut is seen to remove something.
     */
    async function listedKeys(
      headers: Record<string, string>
    ): Promise<{ all: number; countable: number }> {
      const res = await createDynamicHandlers().GET(
        new Request("http://localhost/api/api-keys", { headers }),
        { params: Promise.resolve({ params: ["api-keys"] }) }
      );
      expect(res.status).toBe(200);
      const { items } = (await res.json()) as {
        items: { isActive: boolean; expiresAt: string | null }[];
      };
      const now = Date.now();
      const countable = items.filter(
        key =>
          key.isActive &&
          (key.expiresAt === null || Date.parse(key.expiresAt) > now)
      ).length;
      return { all: items.length, countable };
    }

    beforeAll(async () => {
      handle = await createTestNextly({ dialect, collections: [notes] });
      services = new ServiceContainer(handle.adapter);
      // What a real boot does before serving anything: the harness boots
      // without it, and the roles below are made of these permissions.
      const seeder = handle.getService("permissionSeedService") as unknown as {
        seedSystemPermissions: () => Promise<unknown>;
        seedAllCollectionPermissions: () => Promise<unknown>;
      };
      await seeder.seedSystemPermissions();
      await seeder.seedAllCollectionPermissions();
      admin = { id: await account("admin@example.com"), roleIds: [] };
      usersReader = await withRole(
        "users-reader@example.com",
        await role("users-reader", ["read-users"])
      );
      contentOnly = await withRole(
        "content-only@example.com",
        await role("content-only", [`read-${NOTES}`])
      );
      ({ key: rolesKey } = await apiKeys().createApiKey(admin.id, {
        name: "roles reader",
        tokenType: "role-based",
        roleId: await role("roles-reader", ["read-roles"]),
        expiresIn: "never",
      }));
      const keyAdminRole = await role("key-admin", ["read-api-keys"]);
      keyAdmin = await withRole("key-admin@example.com", keyAdminRole);
      await apiKeys().createApiKey(keyAdmin.id, {
        name: "key admin's own",
        tokenType: "role-based",
        roleId: keyAdminRole,
        expiresIn: "never",
      });
    });

    afterAll(async () => {
      await handle?.destroy();
    });

    it("gives a super-admin every count", async () => {
      // The control: without it, every absence below is equally consistent
      // with an endpoint that stopped counting for anyone.
      expect(carried(await stats(await sessionHeaders(admin)))).toEqual([
        ...ADMIN_COUNTS,
      ]);
    });

    it("gives a role holding only read-users the user count alone", async () => {
      expect(carried(await stats(await sessionHeaders(usersReader)))).toEqual([
        "users",
      ]);
    });

    it("gives a role with no admin permission none of them", async () => {
      const body = await stats(await sessionHeaders(contentOnly));
      expect(carried(body)).toEqual([]);
      // Still a summary: the counts it may read are not taken with the rest.
      expect(body.collectionCounts).toEqual([
        expect.objectContaining({ slug: NOTES, count: 0 }),
      ]);
    });

    it("judges an API key on its own grant", async () => {
      // `read-roles` is what both the roles list and the permissions list
      // admit, so the key is given those two and nothing its super-admin
      // owner could see.
      expect(
        carried(await stats({ authorization: `Bearer ${rolesKey}` }))
      ).toEqual(["permissions", "roles"]);
    });

    it("counts for a key administrator every key their list shows", async () => {
      // 🔴 The API-key list shows anyone who may read keys every key, whoever owns it, and
      // the count follows the list. The plausible slip is a count narrowed to the caller's
      // own keys: one here, where the list shows the super-admin's key as well.
      // A revoked key and an expired one, both the super-admin's: listed, never counted.
      const revoked = await apiKeys().createApiKey(admin.id, {
        name: "revoked",
        tokenType: "role-based",
        roleId: await role("revoked-role", ["read-users"]),
        expiresIn: "unlimited",
      });
      await apiKeys().revokeApiKey(revoked.meta.id, admin.id);
      const lapsed = await apiKeys().createApiKey(admin.id, {
        name: "lapsed",
        tokenType: "role-based",
        roleId: await role("lapsed-role", ["read-users"]),
        expiresIn: "7d",
      });
      await expire(lapsed.meta.id);

      const headers = await sessionHeaders(keyAdmin);
      const own = await stats(headers);
      expect(carried(own)).toEqual(["apiKeys"]);
      const listed = await listedKeys(headers);
      // The controls: the cut removes exactly the revoked and the expired key, and what is
      // left still reaches a key this caller does not own, so a count of their own keys alone
      // would differ from it.
      expect(listed.all).toBe(listed.countable + 2);
      expect(listed.countable).toBeGreaterThan(1);
      expect(own.apiKeys).toBe(listed.countable);
      // And the super-admin, whose list is the same keys, counts the same.
      expect((await stats(await sessionHeaders(admin))).apiKeys).toBe(
        listed.countable
      );
    });

    it("answers a refused caller the same whether or not the rows exist", async () => {
      const before = await stats(await sessionHeaders(contentOnly));
      const adminBefore = await stats(await sessionHeaders(admin));

      await apiKeys().createApiKey(admin.id, {
        name: "another key",
        tokenType: "role-based",
        roleId: await role("another-role", ["read-users"]),
        expiresIn: "never",
      });
      await account("one-more@example.com");

      // The control: the rows did change, as the caller allowed to count them sees.
      const adminAfter = await stats(await sessionHeaders(admin));
      expect(adminAfter.apiKeys).toBe(Number(adminBefore.apiKeys) + 1);
      expect(adminAfter.users).toBe(Number(adminBefore.users) + 1);
      expect(adminAfter.roles).toBe(Number(adminBefore.roles) + 1);

      expect(await stats(await sessionHeaders(contentOnly))).toEqual(before);
    });
  }
);
