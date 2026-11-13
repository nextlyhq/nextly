/**
 * One resolution of a user's access at a time, on every dialect.
 *
 * The requests of one admin screen arrive together. When the user's actor is
 * not kept (the first screen after a start, or after the minute it is kept
 * for), each of them resolved it on its own: a walk of the user's roles, then
 * those roles' slugs and grants, sixteen times over where one answers them
 * all. A request arriving while a resolution for its user is under way is now
 * handed that one, and nothing else about what it may be answered changes:
 * - a role change made in this process applies at once to every request that
 *   starts after it: such a request never joins a resolution begun before;
 * - while a retirement runs, nothing is joined and nothing is kept;
 * - a resolution that fails fails every request that joined it closed, and
 *   the next request resolves again;
 * - an actor resolved from an assignment that expires is not served past it.
 *
 * Each request is a request memo of its own, as a REST request or a Direct
 * API call runs one. A resolution is counted by its walk's first read, of
 * `user_roles`, and held open there where a case needs one under way.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { getTableName, isTable } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { runWithAccessMemo } from "../../auth/access/request-memo";
import { defineCollection, text } from "../../config";
import { seedAllPermissions } from "../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { ServiceContainer } from "../index";

import {
  clearInMemoryPermissionTiersForTests,
  hasPermission,
} from "./permissions";
import { duringRetirement } from "./rbac-epoch";

const gadgets = defineCollection({
  slug: "gadgets",
  fields: [text({ name: "title" })],
});

type Select = (...args: unknown[]) => { from: (...args: unknown[]) => unknown };

/** How many concurrent requests one admin screen sends. */
const BURST = 16;

describe.each(getConfiguredTestDialects())(
  "one resolution of a user's access at a time (%s)",
  dialect => {
    let t: TestNextly;
    let services: ServiceContainer;
    let readGadgets: string;

    /** Walks begun since the last reset: reads of `user_roles`. */
    let walks = 0;
    /** Held open where set: the next walk waits for it before it runs. */
    let holdNext: Promise<void> | undefined;
    /** Where set: the next walk fails with it. */
    let failNext: Error | undefined;

    beforeAll(async () => {
      t = await createTestNextly({ dialect, collections: [gadgets] });
      services = new ServiceContainer(t.adapter);
      await seedAllPermissions();
      const all = (await t.nextly.permissions.find({ limit: 500 })).items;
      const found = all.find(permission => permission.slug === "read-gadgets");
      if (!found) throw new Error("no read-gadgets permission was seeded");
      readGadgets = String(found.id);
      // The first user made is given super-admin; made here, so every user
      // below holds only what each test gives them.
      await t.nextly.users.create({
        email: "owner@coalesced.test",
        password: "Password123!",
        data: { name: "owner", isActive: true },
      });

      const db = t.adapter.getDrizzle() as { select: Select };
      const select = db.select.bind(db);
      vi.spyOn(db, "select").mockImplementation((...args) => {
        const builder = select(...args);
        const from = builder.from.bind(builder);
        builder.from = (table: unknown, ...rest: unknown[]) => {
          const query = from(table, ...rest) as {
            then: (
              resolve: (value: unknown) => unknown,
              reject: (error: unknown) => unknown
            ) => Promise<unknown>;
          };
          if (!isTable(table) || getTableName(table) !== "user_roles") {
            return query;
          }
          walks += 1;
          const hold = holdNext;
          const failure = failNext;
          holdNext = undefined;
          failNext = undefined;
          if (hold === undefined && failure === undefined) return query;
          const run = query.then.bind(query);
          // The query's chained methods return the query itself, so the
          // walk awaits this `then`.
          query.then = (resolve, reject) =>
            (hold ?? Promise.resolve())
              .then(() => {
                if (failure) throw failure;
              })
              .then(() => run(resolve, reject), reject);
          return query;
        };
        return builder;
      });
    }, 300_000);

    afterEach(() => {
      walks = 0;
      holdNext = undefined;
      failNext = undefined;
    });

    afterAll(async () => {
      vi.restoreAllMocks();
      await t?.destroy();
    });

    /** A role granting read on gadgets, under a name of its own. */
    async function newRole(): Promise<string> {
      const slug = `role-${randomUUID().slice(0, 8)}`;
      const made = await t.nextly.roles.create({
        data: { name: slug, slug, permissionIds: [readGadgets] },
      });
      return String(made.item.id);
    }

    /** A user nothing has asked about, holding `roleId` until `expiresAt`. */
    async function newHolder(roleId: string, expiresAt?: Date) {
      const made = await t.nextly.users.create({
        email: `${randomUUID()}@coalesced.test`,
        password: "Password123!",
        data: { name: "holder", isActive: true },
      });
      const userId = String((made.item as { id: string | number }).id);
      const assigned = await services.userRoles.assignRoleToUser(
        userId,
        roleId,
        expiresAt && { expiresAt }
      );
      if (!assigned.success) throw new Error(assigned.message);
      // Nothing kept for them yet, as for a user after a start.
      clearInMemoryPermissionTiersForTests();
      walks = 0;
      return userId;
    }

    /** One request asking whether `userId` may read gadgets. */
    function request(userId: string): Promise<boolean> {
      return runWithAccessMemo(() => hasPermission(userId, "read", "gadgets"));
    }

    /** A gate the next walk waits at, and the call that opens it. */
    function holdTheNextWalk(): () => void {
      let open!: () => void;
      holdNext = new Promise<void>(resolve => {
        open = resolve;
      });
      return open;
    }

    /** Until `count` walks have begun, or a second has passed. */
    async function walksBegun(count: number): Promise<void> {
      for (let i = 0; i < 200 && walks < count; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    }

    it("resolves a cold user once for a burst of concurrent requests", async () => {
      const userId = await newHolder(await newRole());

      const answers = await Promise.all(
        Array.from({ length: BURST }, () => request(userId))
      );

      // POPULATION CONTROL: every request was answered from a resolution.
      expect(answers).toEqual(Array(BURST).fill(true));
      expect(walks).toBe(1);
    });

    it("never hands a request after a role change a resolution begun before it", async () => {
      const roleId = await newRole();
      const userId = await newHolder(roleId);

      const open = holdTheNextWalk();
      const before = Array.from({ length: 4 }, () => request(userId));
      await walksBegun(1);
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(walks).toBe(1);

      const removed = await services.userRoles.unassignRoleFromUser(
        userId,
        roleId
      );
      expect(removed.success).toBe(true);

      // Begun after the change, while the earlier resolution is still held
      // open: it resolves on its own and reads the change.
      const walksBefore = walks;
      const after = await request(userId);
      expect(after).toBe(false);
      expect(walks - walksBefore).toBe(1);

      open();
      await Promise.all(before);
      // The resolution begun before the change is not kept.
      expect(await request(userId)).toBe(false);
    });

    it("joins nothing and keeps nothing while a retirement runs", async () => {
      const userId = await newHolder(await newRole());

      await duringRetirement(async () => {
        const answers = await Promise.all([request(userId), request(userId)]);
        expect(answers).toEqual([true, true]);
      });
      expect(walks).toBe(2);

      expect(await request(userId)).toBe(true);
      expect(walks).toBe(3);
    });

    it("fails every request that joined a failed resolution closed, and resolves again for the next", async () => {
      const userId = await newHolder(await newRole());

      const open = holdTheNextWalk();
      failNext = new Error("the database went away");
      const joined = Array.from({ length: 4 }, () => request(userId));
      await walksBegun(1);
      // Every request has had time to begin a walk of its own: none did.
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(walks).toBe(1);
      open();

      // Each fails closed. (Each then asks, on its own, whether the user is
      // a super-admin, which a failed grants read does not refuse: that is
      // the walks after this one, and they answer no.)
      expect(await Promise.all(joined)).toEqual([false, false, false, false]);

      const walksBefore = walks;
      expect(await request(userId)).toBe(true);
      expect(walks - walksBefore).toBe(1);
    });

    it("serves a burst's resolution no longer than the assignment it came from", async () => {
      const userId = await newHolder(
        await newRole(),
        new Date(Date.now() + 1500)
      );

      const answers = await Promise.all(
        Array.from({ length: BURST }, () => request(userId))
      );
      expect(answers).toEqual(Array(BURST).fill(true));
      expect(walks).toBe(1);

      // Past the expiry, with room for a column that keeps whole seconds.
      await new Promise(resolve => setTimeout(resolve, 2600));
      expect(await request(userId)).toBe(false);
      expect(walks).toBe(2);
    });
  }
);
