/**
 * A user's access is resolved once and kept between requests, and every
 * change to it is seen by the next request: here, and through another
 * instance sharing the database.
 *
 * What is kept is the user's resolved actor (their roles, those roles' slugs,
 * the permissions they grant and whether one is `super-admin`), never an
 * answer. It is filed under the role version, `nextly_rbac_epoch`, which every
 * write that changes access moves and every request reads, at most once a
 * second. So a warm request reads nothing but that version, and a change
 * made anywhere retires what any instance kept.
 *
 * Each request is a request memo, as a REST request or a Direct API call
 * runs one. Each change is made through the service that makes it in
 * production; the other-instance case writes the rows and moves the version
 * in the database without touching this process, as another instance would.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { and, eq, getTableName, isTable, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { runWithAccessMemo } from "../../auth/access/request-memo";
import { defineCollection, text } from "../../config";
import { getDialectTables } from "../../database/index";
import { ApiKeyService } from "../../domains/auth/services/api-key-service";
import { seedAllPermissions } from "../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { ServiceContainer } from "../index";

import {
  hasPermission,
  invalidateAllPermissionCaches,
  isSuperAdmin,
  listEffectiveGrants,
  listRoleSlugsForUser,
} from "./permissions";
import { EPOCH_TTL_MS } from "./rbac-epoch";

/** Every table a question about a caller's access is answered from. */
const ACCESS_TABLES = new Set([
  "roles",
  "permissions",
  "role_permissions",
  "user_roles",
  "role_inherits",
  "user_permission_cache",
  "api_keys",
  "nextly_rbac_epoch",
]);

const gadgets = defineCollection({
  slug: "gadgets",
  fields: [text({ name: "title" })],
});

type Select = (...args: unknown[]) => { from: (...args: unknown[]) => unknown };

describe.each(getConfiguredTestDialects())(
  "a user's access kept between requests (%s)",
  dialect => {
    let t: TestNextly;
    let services: ServiceContainer;
    let readGadgets: string;
    let updateGadgets: string;

    beforeAll(async () => {
      t = await createTestNextly({ dialect, collections: [gadgets] });
      services = new ServiceContainer(t.adapter);
      await seedAllPermissions();
      const all = (await t.nextly.permissions.find({ limit: 500 })).items;
      const id = (slug: string) => {
        const found = all.find(permission => permission.slug === slug);
        if (!found) throw new Error(`no ${slug} permission was seeded`);
        return String(found.id);
      };
      readGadgets = id("read-gadgets");
      updateGadgets = id("update-gadgets");
      // The first user made is given super-admin; made here, so every user
      // below holds only what each test gives them.
      await t.nextly.users.create({
        email: "owner@kept.test",
        password: "Password123!",
        data: { name: "owner", isActive: true },
      });
    }, 300_000);

    afterAll(async () => {
      await t?.destroy();
    });

    /** A role granting `permissionIds`, under a name of its own. */
    async function newRole(permissionIds: string[]): Promise<string> {
      const slug = `role-${randomUUID().slice(0, 8)}`;
      const made = await t.nextly.roles.create({
        data: { name: slug, slug, permissionIds },
      });
      return String(made.item.id);
    }

    /** A user nothing has asked about, holding `roleId` until `expiresAt`. */
    async function newHolder(roleId?: string, expiresAt?: Date) {
      const made = await t.nextly.users.create({
        email: `${randomUUID()}@kept.test`,
        password: "Password123!",
        data: { name: "holder", isActive: true },
      });
      const userId = String((made.item as { id: string | number }).id);
      if (roleId) {
        const assigned = await services.userRoles.assignRoleToUser(
          userId,
          roleId,
          expiresAt && { expiresAt }
        );
        if (!assigned.success) throw new Error(assigned.message);
      }
      return userId;
    }

    /**
     * One request asking what a REST request asks of its caller, and the
     * access tables it read, one entry per statement.
     */
    async function request(userId: string) {
      const tables: string[] = [];
      const db = t.adapter.getDrizzle() as { select: Select };
      const select = db.select.bind(db);
      const spy = vi.spyOn(db, "select").mockImplementation((...args) => {
        const builder = select(...args);
        const from = builder.from.bind(builder);
        builder.from = (table: unknown, ...rest: unknown[]) => {
          if (isTable(table) && ACCESS_TABLES.has(getTableName(table))) {
            tables.push(getTableName(table));
          }
          return from(table, ...rest);
        };
        return builder;
      });
      try {
        const answers = await runWithAccessMemo(async () => ({
          reads: await hasPermission(userId, "read", "gadgets"),
          updates: await hasPermission(userId, "update", "gadgets"),
          superAdmin: await isSuperAdmin(userId),
          roles: await listRoleSlugsForUser(userId),
          grants: (await listEffectiveGrants(userId)).map(grant => grant.slug),
        }));
        return { ...answers, tables };
      } finally {
        spy.mockRestore();
      }
    }

    /** Runs `work` once the role version's read interval has passed. */
    async function afterTheInterval<T>(work: () => Promise<T>): Promise<T> {
      await new Promise(resolve => setTimeout(resolve, EPOCH_TTL_MS + 50));
      return work();
    }

    it("reads at most the role version on a warm request, and walks the roles on a cold one", async () => {
      const userId = await newHolder(await newRole([readGadgets]));
      await invalidateAllPermissionCaches();

      const cold = await request(userId);
      const warm = await request(userId);

      // POPULATION CONTROL: the cold request walked the user's roles and
      // answered from them, so the warm one had something to be spared.
      expect(cold.reads).toBe(true);
      expect(cold.tables).toContain("user_roles");
      expect(warm.reads).toBe(true);
      expect(warm.grants).toEqual(cold.grants);
      // The subject: nothing but the role version, at most once.
      expect(
        warm.tables.filter(table => table !== "nextly_rbac_epoch")
      ).toEqual([]);
      expect(warm.tables.length).toBeLessThanOrEqual(1);
    });

    it("sees a role's permissions edited between two requests", async () => {
      const roleId = await newRole([readGadgets]);
      const userId = await newHolder(roleId);
      expect((await request(userId)).updates).toBe(false);

      await services.rolePermissions.addPermissionToRole(roleId, {
        action: "update",
        resource: "gadgets",
      });
      expect((await request(userId)).updates).toBe(true);

      await services.rolePermissions.removePermissionFromRole(roleId, {
        action: "read",
        resource: "gadgets",
      });
      expect((await request(userId)).reads).toBe(false);
    });

    it("sees a user's roles assigned and removed between two requests", async () => {
      const roleId = await newRole([updateGadgets]);
      const userId = await newHolder();
      expect((await request(userId)).updates).toBe(false);

      const assigned = await services.userRoles.assignRoleToUser(
        userId,
        roleId
      );
      expect(assigned.success).toBe(true);
      expect((await request(userId)).updates).toBe(true);

      const removed = await services.userRoles.unassignRoleFromUser(
        userId,
        roleId
      );
      expect(removed.success).toBe(true);
      expect((await request(userId)).updates).toBe(false);
    });

    it("sees role inheritance changed between two requests", async () => {
      // A role holds the permissions of the roles it inherits from: the
      // holder's role, given the granting role as a child, gains its grants.
      const granting = await newRole([updateGadgets]);
      const holding = await newRole([readGadgets]);
      const userId = await newHolder(holding);
      expect((await request(userId)).updates).toBe(false);

      await services.roleInheritance.addRoleInheritance(granting, holding);
      expect((await request(userId)).updates).toBe(true);

      await services.roleInheritance.removeRoleInheritance(granting, holding);
      expect((await request(userId)).updates).toBe(false);
    });

    it("sees a role deleted between two requests", async () => {
      const roleId = await newRole([readGadgets]);
      const userId = await newHolder(roleId);
      expect((await request(userId)).reads).toBe(true);

      await t.nextly.roles.delete({ id: roleId });
      const after = await request(userId);
      expect(after.reads).toBe(false);
      expect(after.roles).toEqual([]);
    });

    it("reads a deactivated or deleted user's access afresh on the next request", async () => {
      for (const change of ["deactivate", "delete"] as const) {
        const userId = await newHolder(await newRole([readGadgets]));
        // Kept: the second request reads nothing of the user.
        await request(userId);
        expect((await request(userId)).tables).not.toContain("user_roles");

        if (change === "deactivate") {
          await t.nextly.users.update({
            id: userId,
            data: { isActive: false },
          });
        } else {
          await t.nextly.users.delete({ id: userId });
        }
        const after = await request(userId);
        // The kept actor was retired, so the user's roles were read again.
        expect(after.tables).toContain("user_roles");
        if (change === "delete") {
          expect(after.reads).toBe(false);
          expect(after.roles).toEqual([]);
        }
      }
    });

    it("sees a role assignment expire between two requests", async () => {
      const userId = await newHolder(
        await newRole([readGadgets]),
        new Date(Date.now() + 30_000)
      );
      expect((await request(userId)).reads).toBe(true);

      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 45_000);
      try {
        const after = await request(userId);
        expect(after.reads).toBe(false);
        expect(after.roles).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("sees an API key's grants follow its maker's change, and its revocation", async () => {
      const roleId = await newRole([readGadgets]);
      const makerId = await newHolder(roleId);
      const keys = t.getService("apiKeyService") as unknown as ApiKeyService;
      const { key, meta } = await keys.createApiKey(makerId, {
        name: "follows its maker",
        tokenType: "read-only",
        expiresIn: "unlimited",
      });
      const check = () => t.nextly.access.checkApiKey({ rawKey: key });

      // POPULATION CONTROL: the key holds the read its maker's role grants.
      expect((await check()).permissions).toContain("read-gadgets");

      await services.rolePermissions.removePermissionFromRole(roleId, {
        action: "read",
        resource: "gadgets",
      });
      const narrowed = await check();
      expect(narrowed.valid).toBe(true);
      expect(narrowed.permissions ?? []).not.toContain("read-gadgets");

      await t.nextly.apiKeys.revoke({ id: String(meta.id) });
      expect((await check()).valid).toBe(false);
    });

    it("sees a change made through another instance once the role version is read again", async () => {
      const roleId = await newRole([readGadgets]);
      const userId = await newHolder(roleId);
      expect((await request(userId)).reads).toBe(true);

      // Another instance takes the grant away: it writes the rows and moves
      // the shared role version, and nothing in this process is told.
      const db = t.adapter.getDrizzle() as unknown as {
        delete: (table: unknown) => {
          where: (cond: unknown) => Promise<unknown>;
        };
        update: (table: unknown) => {
          set: (patch: unknown) => {
            where: (cond: unknown) => Promise<unknown>;
          };
        };
      };
      const tables = getDialectTables() as unknown as {
        rolePermissions: { roleId: unknown; permissionId: unknown };
        nextlyRbacEpoch: { id: unknown; revision: unknown };
      };
      await db
        .delete(tables.rolePermissions)
        .where(
          and(
            eq(tables.rolePermissions.roleId as never, roleId),
            eq(tables.rolePermissions.permissionId as never, readGadgets)
          )
        );
      // The row is there once anything has published a version, as the
      // writes in this file have.
      await db
        .update(tables.nextlyRbacEpoch)
        .set({
          revision: sql`${tables.nextlyRbacEpoch.revision} + 5`,
          updatedAt: new Date(),
        })
        .where(eq(tables.nextlyRbacEpoch.id as never, "global"));

      // The control: inside the read interval this process still answers
      // from what it kept, so the answer below changes because the version
      // was read, not because nothing was kept.
      expect((await request(userId)).reads).toBe(true);

      const after = await afterTheInterval(() => request(userId));
      expect(after.reads).toBe(false);
    });
  }
);
