/**
 * How many times one REST request asks the database about its caller.
 *
 * A list read asks about the caller at the route gate, in the collection
 * rule's context, and in every field rule of every row it returns. Each of
 * those asked the database for the caller's roles and permissions again, so
 * the cost grew with the number of rows. Within one request the answer is
 * looked up once, so a list of fifty rows costs what a list of one does.
 *
 * Counted: every statement read from a role, permission, role-assignment,
 * permission-cache, role-epoch or API-key table, with every cache emptied
 * before the request, so the count is what the request itself asked.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { getTableName, isTable } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../config";
import { seedAllPermissions } from "../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import { RBAC_EPOCH_TABLE } from "../../schemas/rbac-epoch";
import { ServiceContainer } from "../../services/index";
import {
  hasPermission,
  invalidateAllPermissionCaches,
  isSuperAdmin,
  listRoleSlugsForUser,
} from "../../services/lib/permissions";
import { runWithAccessMemo } from "../access/request-memo";
import { buildClaims } from "../jwt/claims";
import { signAccessToken } from "../jwt/sign";

const ORIGIN = "http://localhost";
const HOUR = 60 * 60 * 1000;

/** The tables every question about a caller's access is answered from. */
const ACCESS_TABLES = new Set([
  "roles",
  "permissions",
  "role_permissions",
  "user_roles",
  "role_inherits",
  "user_permission_cache",
  RBAC_EPOCH_TABLE,
  "api_keys",
]);

const holdsRead = ({ permissions }: { permissions: string[] }) =>
  permissions.includes("notes:read");

/** A collection whose read rule and field rule both read the permissions. */
const notes = defineCollection({
  slug: "notes",
  access: { read: holdsRead },
  fields: [
    text({ name: "title" }),
    text({ name: "secret", access: { read: holdsRead } }),
  ],
});

type Select = (...args: unknown[]) => { from: (...args: unknown[]) => unknown };

/**
 * Records the table of every statement read through the instance's Drizzle
 * client while `work` runs.
 */
async function tablesRead<T>(
  t: TestNextly,
  work: () => Promise<T>
): Promise<{ result: T; tables: string[] }> {
  const tables: string[] = [];
  const result = await watchingReads(t, table => tables.push(table), work);
  return { result, tables };
}

/**
 * Runs `work`, handing `seen` the table of every statement it reads through
 * the instance's Drizzle client before the statement is built. What `seen`
 * throws, the read throws.
 */
async function watchingReads<T>(
  t: TestNextly,
  seen: (table: string) => void,
  work: () => Promise<T>
): Promise<T> {
  const db = t.adapter.getDrizzle() as { select: Select };
  const select = db.select.bind(db);
  const spy = vi.spyOn(db, "select").mockImplementation((...args) => {
    const builder = select(...args);
    const from = builder.from.bind(builder);
    builder.from = (table: unknown, ...rest: unknown[]) => {
      if (isTable(table)) seen(getTableName(table));
      return from(table, ...rest);
    };
    return builder;
  });
  try {
    return await work();
  } finally {
    spy.mockRestore();
  }
}

/** Runs `work` with the first read of `table` failing; says whether one did. */
async function failingFirstRead<T>(
  t: TestNextly,
  table: string,
  work: () => Promise<T>
): Promise<{ result: T; failed: boolean }> {
  let failed = false;
  const result = await watchingReads(
    t,
    read => {
      if (failed || read !== table) return;
      failed = true;
      throw new Error(`the read of ${table} failed`);
    },
    work
  );
  return { result, failed };
}

/** Runs `work` two hours on, when a role assigned for one hour has lapsed. */
async function twoHoursOn<T>(work: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 2 * HOUR);
  try {
    return await work();
  } finally {
    vi.useRealTimers();
  }
}

async function sessionCookie(userId: string, roleIds: string[]) {
  const token = await signAccessToken(
    buildClaims({
      userId,
      email: "reader@lookups.test",
      name: "reader",
      image: null,
      roleIds,
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  return `nextly_session=${token}`;
}

describe.each(getConfiguredTestDialects())(
  "a REST request asks about its caller once (%s)",
  dialect => {
    let t: TestNextly;
    let cookie: string;
    let readerId: string;
    let newcomerId: string;
    let userId: string;
    // Each holds one role for the next hour only: reader, and super-admin.
    let lapsingReaderId: string;
    let lapsingAdminId: string;

    beforeAll(async () => {
      t = await createTestNextly({ dialect, collections: [notes] });
      await seedAllPermissions();
      const readNotes = (
        await t.nextly.permissions.find({ limit: 100 })
      ).items.find(permission => permission.slug === "read-notes");
      if (!readNotes) throw new Error("no read-notes permission was seeded");
      // The permission comes through an inherited role, so a lookup walks
      // the inheritance as a real one does.
      const reader = await t.nextly.roles.create({
        data: {
          name: "reader",
          slug: "reader",
          permissionIds: [String(readNotes.id)],
        },
      });
      const writer = await t.nextly.roles.create({
        data: {
          name: "writer",
          slug: "writer",
          permissionIds: [String(readNotes.id)],
          childRoleIds: [String(reader.item.id)],
        },
      });
      // The first user made is given super-admin. Made here, so the caller
      // measured below holds only the roles assigned to it.
      await t.nextly.users.create({
        email: "owner@lookups.test",
        password: "Password123!",
        data: { name: "owner", isActive: true },
      });
      const user = await t.nextly.users.create({
        email: "reader@lookups.test",
        password: "Password123!",
        data: { name: "reader", isActive: true },
      });
      userId = String((user.item as { id: string | number }).id);
      readerId = String(reader.item.id);
      const newcomer = await t.nextly.users.create({
        email: "newcomer@lookups.test",
        password: "Password123!",
        data: { name: "newcomer", isActive: true },
      });
      newcomerId = String((newcomer.item as { id: string | number }).id);
      const writerId = String(writer.item.id);
      await new ServiceContainer(t.adapter).userRoles.assignRoleToUser(
        userId,
        writerId
      );
      cookie = await sessionCookie(userId, [writerId]);
      const superAdmin = (await t.nextly.roles.find({ limit: 100 })).items.find(
        role => role.slug === "super-admin"
      );
      if (!superAdmin) throw new Error("no super-admin role was seeded");
      const inAnHour = new Date(Date.now() + HOUR);
      [lapsingReaderId, lapsingAdminId] = await Promise.all(
        [
          ["lapsing-reader", readerId],
          ["lapsing-admin", String(superAdmin.id)],
        ].map(async ([name, roleId]) => {
          const lapsing = await t.nextly.users.create({
            email: `${name}@lookups.test`,
            password: "Password123!",
            data: { name, isActive: true },
          });
          const id = String((lapsing.item as { id: string | number }).id);
          await new ServiceContainer(t.adapter).userRoles.assignRoleToUser(
            id,
            roleId,
            { expiresAt: inAnHour }
          );
          return id;
        })
      );
      for (let i = 0; i < 50; i++) {
        await t.nextly.create({
          collection: "notes",
          data: { title: `note ${i}`, secret: `secret ${i}` },
        });
      }
    }, 300_000);

    afterAll(async () => {
      await t?.destroy();
    });

    async function listOf(limit: number) {
      await invalidateAllPermissionCaches();
      const segments = ["collections", "notes", "entries"];
      const { result: response, tables } = await tablesRead(t, () =>
        createDynamicHandlers().GET(
          new Request(`${ORIGIN}/api/${segments.join("/")}?limit=${limit}`, {
            headers: { origin: ORIGIN, cookie },
          }),
          { params: Promise.resolve({ params: segments }) }
        )
      );
      const body = (await response.json()) as {
        items?: { secret?: unknown }[];
      };
      return {
        status: response.status,
        items: body.items ?? [],
        access: tables.filter(table => ACCESS_TABLES.has(table)),
      };
    }

    it("reads the same access rows for fifty entries as for one", async () => {
      const one = await listOf(1);
      const fifty = await listOf(50);
      // POPULATION CONTROL: both lists were read, through the rules, and the
      // field rule let the caller see the field on every row.
      expect(one.status).toBe(200);
      expect(fifty.status).toBe(200);
      expect(one.items).toHaveLength(1);
      expect(fifty.items).toHaveLength(50);
      expect(fifty.items.every(item => typeof item.secret === "string")).toBe(
        true
      );
      expect(one.access.length).toBeGreaterThan(0);
      expect(fifty.access.length).toBe(one.access.length);
    });

    it("sees a role the same request assigns", async () => {
      // A request that changes someone's roles and then asks about them must
      // see the change, so a role write forgets what the request had kept.
      await runWithAccessMemo(async () => {
        expect(await listRoleSlugsForUser(newcomerId)).toEqual([]);
        await new ServiceContainer(t.adapter).userRoles.assignRoleToUser(
          newcomerId,
          readerId
        );
        expect(await listRoleSlugsForUser(newcomerId)).toEqual(["reader"]);
      });
    });

    it("asks again after a check that failed closed", async () => {
      // A read that fails answers no, but only for that ask: the failure is
      // not the request's answer, so a later ask reads again.
      for (const table of ["user_roles", "role_permissions"]) {
        // A reader never asked about before, so no cache tier holds an answer
        // and the first ask has to read.
        const reader = await t.nextly.users.create({
          email: `failed-${table}@lookups.test`,
          password: "Password123!",
          data: { name: table, isActive: true },
        });
        const readerUserId = String(
          (reader.item as { id: string | number }).id
        );
        await new ServiceContainer(t.adapter).userRoles.assignRoleToUser(
          readerUserId,
          readerId
        );
        await invalidateAllPermissionCaches();
        await runWithAccessMemo(async () => {
          const first = await failingFirstRead(t, table, () =>
            hasPermission(readerUserId, "read", "notes")
          );
          // POPULATION CONTROL: the read failed, and the check failed closed.
          expect(first.failed).toBe(true);
          expect(first.result).toBe(false);
          expect(await hasPermission(readerUserId, "read", "notes")).toBe(true);
        });
      }
    });

    it("drops what it kept when a role it came from expires", async () => {
      await invalidateAllPermissionCaches();
      await runWithAccessMemo(async () => {
        expect(await hasPermission(lapsingReaderId, "read", "notes")).toBe(
          true
        );
        expect(await listRoleSlugsForUser(lapsingReaderId)).toEqual(["reader"]);
        expect(await isSuperAdmin(lapsingAdminId)).toBe(true);
        await twoHoursOn(async () => {
          expect(await hasPermission(lapsingReaderId, "read", "notes")).toBe(
            false
          );
          expect(await listRoleSlugsForUser(lapsingReaderId)).toEqual([]);
          expect(await isSuperAdmin(lapsingAdminId)).toBe(false);
        });
      });
    });

    it.each([
      ["a permission", () => hasPermission(lapsingReaderId, "read", "notes")],
      ["super-admin authority", () => isSuperAdmin(lapsingAdminId)],
    ] as const)(
      "drops %s it took from the process cache when the role behind it expires",
      async (_answer, ask) => {
        await invalidateAllPermissionCaches();
        // Asked outside the request, so the process cache holds the answer.
        expect(await ask()).toBe(true);
        await runWithAccessMemo(async () => {
          const cached = await tablesRead(t, ask);
          // POPULATION CONTROL: served from the cache, not by a role walk.
          expect(cached.result).toBe(true);
          expect(cached.tables).not.toContain("user_roles");
          expect(await twoHoursOn(ask)).toBe(false);
        });
      }
    );

    it("walks the caller's roles once", async () => {
      const fifty = await listOf(50);
      expect(fifty.access.filter(table => table === "user_roles")).toHaveLength(
        1
      );
    });
  }
);
