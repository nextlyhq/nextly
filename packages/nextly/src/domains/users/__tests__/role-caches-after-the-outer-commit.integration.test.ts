/**
 * A change to a user's roles made inside a plugin's `ctx.db.transaction`
 * retires what is cached about that user's access once the plugin's
 * transaction commits, not before.
 *
 * The service's own transaction joins the plugin's, so its change is not
 * visible to another connection until the plugin's transaction commits. A
 * permission check made on another connection in that window reads the user
 * as they were and keeps that answer under the role version it read. Retired
 * before the commit, that answer outlives the change: the user is refused a
 * role they now hold, or keeps one they no longer hold, until something else
 * moves the role version. Retired after the commit, the next check reads the
 * committed rows.
 *
 * PostgreSQL and MySQL only: SQLite has one connection, so there is no other
 * connection to check from while the transaction is open.
 */
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { runWithAccessMemo } from "../../../auth/access/request-memo";
import {
  definePlugin,
  type PluginContext,
  type PluginUserService,
} from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ServiceContainer } from "../../../services/index";
import { hasPermission, rbacRevision } from "../../../services/lib/permissions";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const RESOURCE = "ledgers";

interface Booted {
  db: PluginContext["db"];
  users: PluginUserService;
  services: ServiceContainer;
  roleId: string;
}

async function boot(dialect: TestDialect): Promise<Booted> {
  let captured: Pick<Booted, "db" | "users"> | undefined;
  const plugin = definePlugin({
    name: "@test/role-caches",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init(ctx) {
      captured = { db: ctx.db, users: ctx.services.users };
    },
  });
  current = await createTestNextly({ dialect, plugins: [plugin] });
  if (!captured) throw new Error("the plugin's init did not run");
  // The first account is given super-admin; made here, so each user below
  // holds only the role a case gives them.
  await current.nextly.users.create({
    email: "owner@role-caches.test",
    password: "Password123!",
    data: { name: "owner", isActive: true },
  });
  const permission = await current.nextly.permissions.create({
    data: {
      action: "read",
      resource: RESOURCE,
      name: "Read ledgers",
      slug: `read-${RESOURCE}`,
    },
  });
  const role = await current.nextly.roles.create({
    data: {
      name: "Ledger reader",
      slug: "ledger-reader",
      permissionIds: [String(permission.item.id)],
    },
  });
  await current.events.settle();
  return {
    ...captured,
    services: new ServiceContainer(current.adapter),
    roleId: String(role.item.id),
  };
}

/** One request's answer to whether `userId` may read ledgers. */
function mayRead(userId: string): Promise<boolean> {
  return runWithAccessMemo(() => hasPermission(userId, "read", RESOURCE));
}

/** A new user, holding the role when `withRole` says so. */
async function newUser(b: Booted, withRole: boolean): Promise<string> {
  const made = await b.users.create(
    {
      email: `${randomUUID()}@role-caches.test`,
      name: "holder",
      password: "Password123!",
      ...(withRole ? { roles: [b.roleId] } : {}),
    },
    {}
  );
  return String(made.id);
}

/**
 * Runs `write` inside the plugin's transaction, then asks {@link mayRead} on
 * another connection while that transaction is still open, then commits.
 * Asked from the test's own flow, outside the transaction, as a concurrent
 * request would ask it.
 *
 * @returns The user written, and the answer given while the transaction was open
 */
async function askedWhileOpen(
  b: Booted,
  write: () => Promise<string>
): Promise<{ userId: string; whileOpen: boolean }> {
  let written!: (userId: string) => void;
  const wrote = new Promise<string>(resolve => {
    written = resolve;
  });
  let release!: () => void;
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  const outer = b.db.transaction(async () => {
    written(await write());
    await released;
  });
  try {
    const userId = await Promise.race([
      wrote,
      outer.then(() => {
        throw new Error("the transaction ended before the write");
      }),
    ]);
    return { userId, whileOpen: await mayRead(userId) };
  } finally {
    release();
    await outer;
  }
}

/**
 * Each change to a user's roles: who it starts from (committed, and asked
 * about once so their access is cached), the change, and what they may do
 * while it is uncommitted and once it has committed.
 */
const CHANGES: ReadonlyArray<{
  name: string;
  /** The committed user the change starts from; none for a create. */
  from: (b: Booted) => Promise<string | undefined>;
  /** The change, inside the plugin's transaction; returns the user changed. */
  change: (b: Booted, userId: string | undefined) => Promise<string>;
  whileOpen: boolean;
  after: boolean;
}> = [
  {
    name: "creating a user with a role",
    from: async () => undefined,
    change: b => newUser(b, true),
    whileOpen: false,
    after: true,
  },
  {
    name: "assigning a role",
    from: b => newUser(b, false),
    change: async (b, userId) => {
      const result = await b.services.userRoles.assignRoleToUser(
        String(userId),
        b.roleId
      );
      if (!result.success) throw new Error(result.message);
      return String(userId);
    },
    whileOpen: false,
    after: true,
  },
  {
    name: "removing a role",
    from: b => newUser(b, true),
    change: async (b, userId) => {
      const result = await b.services.userRoles.unassignRoleFromUser(
        String(userId),
        b.roleId
      );
      if (!result.success) throw new Error(result.message);
      return String(userId);
    },
    whileOpen: true,
    after: false,
  },
];

const SERVER_DIALECTS = getConfiguredTestDialects().filter(
  dialect => dialect !== "sqlite"
);

describe.each(SERVER_DIALECTS)(
  "a role change inside a plugin's transaction (%s)",
  dialect => {
    it.each(CHANGES)(
      "is seen by the first check after the commit: $name",
      async ({ from, change, whileOpen, after }) => {
        const b = await boot(dialect);
        const existing = await from(b);
        // What the user may do before the change is cached, as a request
        // made before it would have cached it.
        if (existing !== undefined) {
          expect(await mayRead(existing)).toBe(!after);
        }

        const asked = await askedWhileOpen(b, () => change(b, existing));

        // The check on another connection saw the committed state, and kept
        // that answer: the race the change must outlast.
        expect(asked.whileOpen).toBe(whileOpen);
        expect(await mayRead(asked.userId)).toBe(after);
      }
    );

    // After the commit the caches are flushed and `user.created` announced,
    // in the order they were registered. Announced first, a subscriber is
    // told of the account while what was cached about it, the account holding
    // no role, still stands: the role version has not moved yet. Read when the
    // event is delivered, since handlers are called as it is emitted.
    it("retires the new account's cached access before announcing user.created", async () => {
      const b = await boot(dialect);
      const announced: Array<{ revision: string; mayRead: Promise<boolean> }> =
        [];
      current!.events.on<{ userId: string }>("user.created", event => {
        announced.push({
          revision: rbacRevision(),
          mayRead: mayRead(event.payload.userId),
        });
      });

      let written: string | undefined;
      const asked = await askedWhileOpen(b, async () => {
        const userId = await newUser(b, true);
        written = rbacRevision();
        return userId;
      });
      await current!.events.settle();

      expect(asked.whileOpen).toBe(false);
      expect(announced).toHaveLength(1);
      expect(written).toBeDefined();
      expect(announced[0].revision).not.toBe(written);
      expect(await announced[0].mayRead).toBe(true);
    });
  }
);
