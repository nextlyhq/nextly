// Who becomes the install's first administrator.
//
// An account the app itself provisions (its setup route, its admin, its own
// server code) on an install with no administrator becomes super-admin: that is
// how a fresh install gets one. A stranger's self-registration never does,
// whoever was there before it, and two provisioned accounts racing on an empty
// install leave exactly one administrator.

import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildAuthRouterDeps } from "../../../auth/handlers/deps-bridge";
import { handleSetupStatus } from "../../../auth/handlers/setup";
import { getDialectTables } from "../../../database/index";
import { generateSqliteCoreTableStatements } from "../../../database/sqlite-core-tables";
import { ServiceContainer } from "../../../services/index";
import { UserMutationService } from "../services/user-mutation-service";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
  if (dialect === "sqlite") {
    // The SQLite runtime auto-sync does not create the core auth tables.
    for (const statement of generateSqliteCoreTableStatements()) {
      await current.adapter.executeQuery(statement);
    }
  }
  return current;
}

function services(t: TestNextly) {
  return new ServiceContainer(t.adapter);
}

const PASSWORD = "Str0ng-P@ssw0rd!";

/** A hand-provisioned account: the app's own caller. */
async function provision(t: TestNextly, email: string): Promise<string> {
  const created = await services(t).users.createLocalUser({
    email,
    name: email,
    password: PASSWORD,
    isActive: true,
    emailVerification: "admin-vouched",
  });
  return String(created.id);
}

/** A self-registered account, as the register route creates it. */
async function selfRegister(t: TestNextly, email: string): Promise<string> {
  const created = await services(t).users.createLocalUser(
    {
      email,
      name: email,
      password: PASSWORD,
      emailVerification: "pending",
    },
    undefined,
    "self-registration"
  );
  return String(created.id);
}

async function isAdministrator(t: TestNextly, userId: string) {
  const { id } = await services(t).roles.ensureSuperAdminRole();
  return (await services(t).userRoles.listUserRoles(userId)).includes(id);
}

/**
 * Write a row straight into one of Nextly's tables. For fixtures the services
 * would refuse or would surround with unrelated work: a role with no
 * permissions, an inheritance edge.
 */
async function insertRow(
  t: TestNextly,
  table: unknown,
  row: Record<string, unknown>
): Promise<void> {
  await (
    t.adapter.getDrizzle() as unknown as {
      insert: (table: unknown) => {
        values: (row: Record<string, unknown>) => Promise<unknown>;
      };
    }
  )
    .insert(table)
    .values(row);
}

/** A role of the install's own, with no permissions. */
async function insertRole(
  t: TestNextly,
  name: string,
  slug: string
): Promise<{ id: string }> {
  const id = randomUUID();
  await insertRow(t, getDialectTables().roles, {
    id,
    name,
    slug,
    description: "A role an install made itself",
    level: 10,
    isSystem: false,
  });
  return { id };
}

describe.each(getConfiguredTestDialects())(
  "the first administrator (%s)",
  (dialect: TestDialect) => {
    it("makes the first hand-provisioned account the administrator", async () => {
      const t = await boot(dialect);
      const id = await provision(t, "owner@example.com");
      expect(await isAdministrator(t, id)).toBe(true);
    });

    it("never makes a self-registered account the administrator, even the first", async () => {
      const t = await boot(dialect);
      const id = await selfRegister(t, "stranger@example.com");
      expect(await services(t).userRoles.listUserRoles(id)).toEqual([]);
    });

    it("never makes the administrator through the registration service, even on an empty install", async () => {
      // The register route's path to an account: the service it calls, not a
      // stand-in, so a registration that stopped saying what it is would show.
      const t = await boot(dialect);
      const registered = await services(t).auth.registerUser({
        email: "stranger@example.com",
        name: "Stranger",
        password: PASSWORD,
      });
      expect(
        await services(t).userRoles.listUserRoles(String(registered.id))
      ).toEqual([]);
    });

    it("still makes a hand-provisioned account the administrator after a self-registered one", async () => {
      const t = await boot(dialect);
      await selfRegister(t, "stranger@example.com");
      const id = await provision(t, "owner@example.com");
      expect(await isAdministrator(t, id)).toBe(true);
    });

    it("keeps setup open after a self-registration, so the owner can still create the administrator", async () => {
      const t = await boot(dialect);
      const deps = buildAuthRouterDeps(
        t.getService as unknown as (name: string) => unknown
      );
      await selfRegister(t, "stranger@example.com");

      // Setup's gate asks whether anyone is an administrator, not whether
      // anyone has an account: a stranger's sign-up must not close it.
      expect(await deps.hasAdministrator()).toBe(false);
      const status = await handleSetupStatus(
        new Request("http://localhost/api/auth/setup-status"),
        deps
      );
      expect(await status.json()).toMatchObject({ isSetup: false });

      const owner = await provision(t, "owner@example.com");
      expect(await isAdministrator(t, owner)).toBe(true);
      expect(await deps.hasAdministrator()).toBe(true);
    });

    it("counts an administrator whose authority comes through a role that inherits super-admin", async () => {
      const t = await boot(dialect);
      const deps = buildAuthRouterDeps(
        t.getService as unknown as (name: string) => unknown
      );
      const { id: superAdmin } = await services(t).roles.ensureSuperAdminRole();
      const owners = await insertRole(t, "Owners", "owners");
      await insertRow(t, getDialectTables().roleInherits, {
        id: randomUUID(),
        parentRoleId: owners.id,
        childRoleId: superAdmin,
      });
      const owner = await selfRegister(t, "owner@example.com");
      await services(t).userRoles.assignRoleToUser(owner, owners.id);

      // The install has an administrator, so setup is closed and the next
      // account the app provisions is not made a second one.
      expect(await deps.hasAdministrator()).toBe(true);
      const next = await provision(t, "next@example.com");
      expect(await services(t).userRoles.listUserRoles(next)).not.toContain(
        superAdmin
      );
    });

    it("makes exactly one of two setups racing on an empty install the administrator", async () => {
      const t = await boot(dialect);
      const deps = buildAuthRouterDeps(
        t.getService as unknown as (name: string) => unknown
      );
      // Where a created account is published (its `user.created` delivery and
      // the hooks after the commit): only the winner may reach it.
      const published = vi.spyOn(
        UserMutationService.prototype as unknown as {
          afterUserCreated: (...args: unknown[]) => Promise<void>;
        },
        "afterUserCreated"
      );
      const emails = ["first@example.com", "second@example.com"];
      const settled = await Promise.allSettled(
        emails.map(email =>
          deps.createSuperAdmin({ email, name: email, password: PASSWORD })
        )
      );

      // One setup wins and is answered with its account; the other is told
      // setup is complete (or fails), and is never made an administrator.
      const won = settled.filter(
        r => r.status === "fulfilled" && r.value !== null
      );
      expect(won).toHaveLength(1);
      const administrators = [];
      for (const email of emails) {
        const account = await services(t).users.findByEmail(email);
        if (account && (await isAdministrator(t, String(account.id)))) {
          administrators.push(email);
        }
      }
      expect(administrators).toHaveLength(1);
      // The loser was refused inside its own transaction, before any account
      // of its existed to publish.
      expect(published).toHaveBeenCalledTimes(1);
      // A setup answered "complete" leaves no account behind.
      for (const [i, r] of settled.entries()) {
        if (r.status === "fulfilled" && r.value === null) {
          expect(await services(t).users.findByEmail(emails[i])).toBeFalsy();
        }
      }
    });

    it("refuses setup for an address a registration already holds, granting it nothing", async () => {
      const t = await boot(dialect);
      const deps = buildAuthRouterDeps(
        t.getService as unknown as (name: string) => unknown
      );
      const registrant = await selfRegister(t, "owner@example.com");

      // Adopting the account would make the registrant's own password sign in
      // as the administrator.
      await expect(
        deps.createSuperAdmin({
          email: "owner@example.com",
          name: "Owner",
          password: PASSWORD,
        })
      ).rejects.toMatchObject({ code: "DUPLICATE" });
      expect(await services(t).userRoles.listUserRoles(registrant)).toEqual([]);
      expect(await deps.hasAdministrator()).toBe(false);
    });

    it("never turns an existing role that is merely named Super Admin into the administrator role", async () => {
      const t = await boot(dialect);
      const lookalike = await insertRole(
        t,
        "Super Admin",
        "custom-super-admin"
      );

      // The administrator role cannot be created beside a role holding its
      // name, and the role already there keeps its own slug: on MySQL an
      // upsert that rewrote it would hand the global bypass to its holders.
      await expect(services(t).roles.ensureSuperAdminRole()).rejects.toThrow();
      const after = await services(t).roles.getRoleById(lookalike.id);
      expect(after?.slug).toBe("custom-super-admin");
    });

    it("gives a hand-provisioned account only its own roles once an administrator exists", async () => {
      const t = await boot(dialect);
      await provision(t, "owner@example.com");
      const id = await provision(t, "colleague@example.com");
      expect(await services(t).userRoles.listUserRoles(id)).toEqual([]);
    });

    it("leaves exactly one administrator when two hand-provisioned accounts race on an empty install", async () => {
      const t = await boot(dialect);
      const ids = await Promise.all([
        provision(t, "first@example.com"),
        provision(t, "second@example.com"),
      ]);
      const admins = await Promise.all(ids.map(id => isAdministrator(t, id)));
      expect(admins.filter(Boolean)).toHaveLength(1);
    });
  }
);
