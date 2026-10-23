/**
 * How many times one REST request, one Direct API call, or one plugin service
 * call asks the database about its caller.
 *
 * A list read asks about the caller at the route gate, in the collection
 * rule's context, and in every field rule of every row it returns. Each of
 * those asked the database for the caller's roles and permissions again, so
 * the cost grew with the number of rows. Within one request the answer is
 * looked up once, so a list of fifty rows costs what a list of one does.
 *
 * Counted: every statement read from a role, permission, role-assignment,
 * permission-cache or API-key table, with every cache emptied before the
 * request, so the count is what the request itself asked.
 *
 * Also here: what the request keeps ends where the answers would, when a role
 * assignment expires or a role or permission is written anywhere, and a check
 * that failed or ran through a transaction is never served from it.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { eq, getTableName, isTable } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../config";
import { getDialectTables } from "../../database/index";
import { ReleasesRepository } from "../../domains/releases/releases-repository";
import { seedAllPermissions } from "../../init/seed-permissions";
import { definePlugin } from "../../plugins/plugin-context";
import type { PluginCollectionService } from "../../plugins/service-opts";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import { ServiceContainer } from "../../services/index";
import type { AuthUserId } from "../../types/auth";
import {
  hasAnyPermission,
  hasPermission,
  invalidateAllPermissionCaches,
  isSuperAdmin,
  listEffectivePermissions,
  listRoleSlugsForUser,
  resolveUserRoles,
} from "../../services/lib/permissions";
import { runWithAccessMemo } from "../access/request-memo";
import { buildClaims } from "../jwt/claims";
import { signAccessToken } from "../jwt/sign";

const ORIGIN = "http://localhost";
// A role held for less than the caches' 60-second life, so only the role's
// own expiry can end what was kept from it.
const LAPSE_MS = 30_000;

/**
 * The tables every question about a caller's access is answered from. The
 * role-epoch row is not counted: it is read on a clock, at most once a second
 * however much is asked, so its count says how long a request ran, not how
 * often it asked.
 */
const ACCESS_TABLES = new Set([
  "roles",
  "permissions",
  "role_permissions",
  "user_roles",
  "role_inherits",
  "user_permission_cache",
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

/** The one statement a transaction's executor is asked for here. */
type RowDeleter = {
  delete: (table: unknown) => { where: (filter: unknown) => Promise<unknown> };
};

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

/** Runs `work` once a role held for `LAPSE_MS` from now has lapsed. */
async function pastTheLapse<T>(work: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + LAPSE_MS + 15_000);
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
    let superAdminId: string;
    // The plugin service a plugin is handed, taken at boot, outside any request.
    let services: { collections: PluginCollectionService } | undefined;

    beforeAll(async () => {
      const capture = definePlugin({
        name: "lookups-probe",
        version: "1.0.0",
        nextly: ">=0.0.1",
        init: ctx => {
          services = ctx.services as { collections: PluginCollectionService };
        },
      });
      t = await createTestNextly({
        dialect,
        collections: [notes],
        plugins: [capture],
      });
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
      superAdminId = String(superAdmin.id);
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

    /**
     * A user never asked about before, so no cache holds an answer about
     * them, holding `roleId` until `expiresAt` when one is given.
     */
    async function newHolder(name: string, roleId: string, expiresAt?: Date) {
      const made = await t.nextly.users.create({
        email: `${name}@lookups.test`,
        password: "Password123!",
        data: { name, isActive: true },
      });
      const id = String((made.item as { id: string | number }).id);
      const assigned = await new ServiceContainer(
        t.adapter
      ).userRoles.assignRoleToUser(id, roleId, expiresAt && { expiresAt });
      if (!assigned.success) throw new Error(assigned.message);
      return id;
    }

    const lapsing = () => new Date(Date.now() + LAPSE_MS);

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

    /**
     * The access tables read by `ask`, run in one request, with every cache
     * emptied first so the count is what the request itself asked.
     */
    async function inOneRequest<T>(ask: () => Promise<T>) {
      await invalidateAllPermissionCaches();
      const { result, tables } = await tablesRead(t, () =>
        runWithAccessMemo(ask)
      );
      return {
        result,
        access: tables.filter(table => ACCESS_TABLES.has(table)),
      };
    }

    /** Permissions the reader does not hold, beside the one it does. */
    const NOT_HELD: Array<[string, string]> = [
      ["update", "notes"],
      ["delete", "notes"],
      ["create", "notes"],
      ["read", "users"],
    ];

    it("reads the same access rows for several permission questions as for one", async () => {
      const one = await inOneRequest(() =>
        hasPermission(userId, "read", "notes")
      );
      const several = await inOneRequest(async () => {
        const answers: boolean[] = [];
        for (const [action, resource] of [["read", "notes"], ...NOT_HELD]) {
          answers.push(await hasPermission(userId, action, resource));
        }
        return answers;
      });
      // POPULATION CONTROL: the held permission allows, the others refuse,
      // and the caller's access was read for both.
      expect(one.result).toBe(true);
      expect(several.result).toEqual([true, false, false, false, false]);
      expect(one.access.length).toBeGreaterThan(0);
      expect(several.access).toEqual(one.access);
    });

    it("reads the same access rows for any of several permissions as for one", async () => {
      const one = await inOneRequest(() =>
        hasPermission(userId, "read", "notes")
      );
      // The held permission last, so every other one is asked first.
      const any = await inOneRequest(() =>
        hasAnyPermission(userId, [
          ...NOT_HELD.map(([action, resource]) => ({ action, resource })),
          { action: "read", resource: "notes" },
        ])
      );
      const none = await inOneRequest(() =>
        hasAnyPermission(
          userId,
          NOT_HELD.map(([action, resource]) => ({ action, resource }))
        )
      );
      expect(any.result).toBe(true);
      expect(none.result).toBe(false);
      expect(one.access.length).toBeGreaterThan(0);
      expect(any.access).toEqual(one.access);
      expect(none.access).toEqual(one.access);
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
        // Never asked about before, so the first ask has to read.
        const readerUserId = await newHolder(`failed-${table}`, readerId);
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
      const reader = await newHolder("lapsing-reader", readerId, lapsing());
      const admin = await newHolder("lapsing-admin", superAdminId, lapsing());
      await invalidateAllPermissionCaches();
      await runWithAccessMemo(async () => {
        expect(await hasPermission(reader, "read", "notes")).toBe(true);
        expect(await listRoleSlugsForUser(reader)).toEqual(["reader"]);
        expect(await isSuperAdmin(admin)).toBe(true);
        await pastTheLapse(async () => {
          expect(await hasPermission(reader, "read", "notes")).toBe(false);
          expect(await listRoleSlugsForUser(reader)).toEqual([]);
          expect(await isSuperAdmin(admin)).toBe(false);
        });
      });
    });

    it.each([
      [
        "a permission",
        "reader",
        (id: string) => hasPermission(id, "read", "notes"),
      ],
      [
        "super-admin authority",
        "super-admin",
        (id: string) => isSuperAdmin(id),
      ],
    ] as const)(
      "drops %s it took from the access kept between requests when the role behind it expires",
      async (_answer, role, asks) => {
        const holder = await newHolder(
          `cached-${role}`,
          role === "reader" ? readerId : superAdminId,
          lapsing()
        );
        const ask = () => asks(holder);
        await invalidateAllPermissionCaches();
        // Asked outside the request, so the user's access is kept between
        // requests.
        expect(await ask()).toBe(true);
        await runWithAccessMemo(async () => {
          const cached = await tablesRead(t, ask);
          // POPULATION CONTROL: served from what was kept, not by a role walk.
          expect(cached.result).toBe(true);
          expect(cached.tables).not.toContain("user_roles");
          expect(await pastTheLapse(ask)).toBe(false);
        });
      }
    );

    it("drops what it kept when another request takes the role away", async () => {
      const holder = await newHolder("revoked", readerId);
      await invalidateAllPermissionCaches();
      let askedOnce!: () => void;
      const asked = new Promise<void>(resolve => {
        askedOnce = resolve;
      });
      let revoked!: () => void;
      const revocation = new Promise<void>(resolve => {
        revoked = resolve;
      });
      // One request asks, waits while another takes the role away, and asks
      // again.
      const answers = runWithAccessMemo(async () => {
        const before = await hasPermission(holder, "read", "notes");
        askedOnce();
        await revocation;
        return { before, after: await hasPermission(holder, "read", "notes") };
      });
      await asked;
      // The other request, with a memo of its own.
      const removal = await runWithAccessMemo(() =>
        new ServiceContainer(t.adapter).userRoles.unassignRoleFromUser(
          holder,
          readerId
        )
      );
      revoked();
      // POPULATION CONTROL: the role was taken away.
      expect(removal.success).toBe(true);
      expect(await answers).toEqual({ before: true, after: false });
    });

    it("hands each caller lists of its own", async () => {
      // A rule that changes the list it is handed changes no other rule's.
      await invalidateAllPermissionCaches();
      await runWithAccessMemo(async () => {
        const permissions = await listEffectivePermissions(userId);
        const slugs = await listRoleSlugsForUser(userId);
        const { roleIds } = await resolveUserRoles(userId);
        // POPULATION CONTROL: each held something to take away.
        expect(permissions).toContain("notes:read");
        expect(slugs).toContain("writer");
        expect(roleIds.size).toBeGreaterThan(0);
        permissions.length = 0;
        slugs.length = 0;
        roleIds.clear();
        expect(await listEffectivePermissions(userId)).toContain("notes:read");
        expect(await listRoleSlugsForUser(userId)).toContain("writer");
        expect((await resolveUserRoles(userId)).roleIds.size).toBeGreaterThan(
          0
        );
      });
    });

    it("never answers a check made through a transaction from the memo", async () => {
      const holder = await newHolder("in-a-transaction", readerId);
      const { userRoles } = getDialectTables(dialect);
      await invalidateAllPermissionCaches();
      await runWithAccessMemo(async () => {
        // The pooled answer, kept for the request.
        expect(await hasPermission(holder, "read", "notes")).toBe(true);
        expect(await listEffectivePermissions(holder)).toContain("notes:read");
        await expect(
          t.adapter.transaction(async tx => {
            const executor = tx.getDrizzle() as unknown as RowDeleter;
            await executor
              .delete(userRoles)
              .where(eq(userRoles.userId, holder));
            // The transaction's own rows, in which the role is gone.
            expect(await hasPermission(holder, "read", "notes", executor)).toBe(
              false
            );
            expect(await listEffectivePermissions(holder, executor)).toEqual(
              []
            );
            throw new Error("roll back");
          })
        ).rejects.toThrow("roll back");
        // POPULATION CONTROL: rolled back, the pool still holds the role.
        expect(await hasPermission(holder, "read", "notes")).toBe(true);
      });
    });

    /** The access tables a Direct API list made as the user reads. */
    async function directListOf(limit: number) {
      await invalidateAllPermissionCaches();
      const { result, tables } = await tablesRead(t, () =>
        t.nextly.find({
          collection: "notes",
          limit,
          overrideAccess: false,
          user: { id: userId },
        })
      );
      return {
        items: result.items as { secret?: unknown }[],
        access: tables.filter(table => ACCESS_TABLES.has(table)),
      };
    }

    /** The access tables a plugin service list made as the user reads. */
    async function serviceListOf(limit: number) {
      if (!services)
        throw new Error("the probe plugin was not handed services");
      const collections = services.collections;
      await invalidateAllPermissionCaches();
      const { result, tables } = await tablesRead(t, () =>
        collections.listEntries(
          "notes",
          { pagination: { limit } },
          {
            as: "user",
            user: { id: userId as AuthUserId, email: "reader@lookups.test" },
          }
        )
      );
      return {
        items: result.data as { secret?: unknown }[],
        access: tables.filter(table => ACCESS_TABLES.has(table)),
      };
    }

    it.each([
      ["a Direct API call", directListOf],
      ["a plugin service call", serviceListOf],
    ] as const)(
      "%s reads the same access rows for fifty entries as for one",
      async (_way, listing) => {
        const one = await listing(1);
        const fifty = await listing(50);
        // POPULATION CONTROL: both read through the rules, and the field rule
        // showed the caller the field on every row.
        expect(one.items).toHaveLength(1);
        expect(fifty.items).toHaveLength(50);
        expect(fifty.items.every(item => typeof item.secret === "string")).toBe(
          true
        );
        expect(one.access.length).toBeGreaterThan(0);
        expect(fifty.access.length).toBe(one.access.length);
        expect(
          fifty.access.filter(table => table === "user_roles")
        ).toHaveLength(1);
      }
    );

    it("a Direct API namespace call walks the caller's roles once", async () => {
      // Asks several permissions of one caller: whether they may read the
      // release, and each thing they might do to it.
      const readReleases = (
        await t.nextly.permissions.find({ limit: 200 })
      ).items.find(permission => permission.slug === "read-content-releases");
      if (!readReleases) throw new Error("no read-content-releases permission");
      const releaseReader = await t.nextly.roles.create({
        data: {
          name: "release reader",
          slug: "release-reader",
          permissionIds: [String(readReleases.id)],
        },
      });
      const caller = await newHolder(
        "release-reader",
        String(releaseReader.item.id)
      );
      const release = await new ReleasesRepository(t.adapter).createRelease({
        title: "Relaunch",
        createdBy: caller,
      });
      await invalidateAllPermissionCaches();
      const { result, tables } = await tablesRead(t, () =>
        t.nextly.releases.capabilities({
          releases: [release],
          overrideAccess: false,
          userId: caller,
        })
      );
      // POPULATION CONTROL: answered for the release, from the caller's roles.
      expect(result.has(release.id)).toBe(true);
      expect(tables.filter(table => table === "user_roles")).toHaveLength(1);
    });

    it("walks the caller's roles once", async () => {
      const fifty = await listOf(50);
      expect(fifty.access.filter(table => table === "user_roles")).toHaveLength(
        1
      );
    });
  }
);
