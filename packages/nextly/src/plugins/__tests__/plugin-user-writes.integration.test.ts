/**
 * What a plugin may do to accounts through `ctx.services.users`.
 *
 * A plugin may create and update accounts, but not decide who administers the
 * site. Core makes an install's first account super-admin, and roles are
 * assigned as the caller names them, so without a limit any plugin, declaring
 * nothing, could make itself an administrator: by creating the first account,
 * or by naming a role that reaches `super-admin`.
 *
 * Every refusal is paired with the core path that must keep doing the same
 * thing, since a refusal applied to the shared service would also pass these
 * tests while breaking setup and the admin.
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDialectTables } from "../../database/index";
import { generateSqliteCoreTableStatements } from "../../database/sqlite-core-tables";
import { UserMutationService } from "../../domains/users/services/user-mutation-service";
import { NextlyError } from "../../errors";
import { ServiceContainer } from "../../services/index";
import { consoleLogger } from "../../services/shared";
import type { UserService } from "../../services/users/user-service";
import { definePlugin, type PluginUserService } from "../plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

/**
 * Work to run once, in the gap between a plugin write's early check and its
 * transaction: what another request could commit there. `superAdminCheck`
 * runs after the first super-admin check of `userId`; `passwordHash` runs
 * before the next password hash.
 */
const between = vi.hoisted(() => ({
  superAdminCheck: undefined as
    | { userId: string; run: () => Promise<void> }
    | undefined,
  passwordHash: undefined as (() => Promise<void>) | undefined,
}));

vi.mock("../../services/lib/permissions", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../../services/lib/permissions")>();
  return {
    ...actual,
    isSuperAdminOrThrow: async (userId: string, executor: unknown) => {
      const answer = await actual.isSuperAdminOrThrow(userId, executor);
      const pending = between.superAdminCheck;
      if (pending && pending.userId === userId) {
        between.superAdminCheck = undefined;
        await pending.run();
      }
      return answer;
    },
  };
});

vi.mock("../../auth/password", async importOriginal => {
  const actual = await importOriginal<typeof import("../../auth/password")>();
  return {
    ...actual,
    hashPassword: async (password: string) => {
      const pending = between.passwordHash;
      between.passwordHash = undefined;
      await pending?.();
      return actual.hashPassword(password);
    },
  };
});

let current: TestNextly | undefined;
afterEach(async () => {
  between.superAdminCheck = undefined;
  between.passwordHash = undefined;
  await current?.destroy();
  current = undefined;
});

const CONTEXT = {};

interface TestDb {
  select: (cols?: Record<string, unknown>) => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<Record<string, unknown>[]>;
    } & Promise<Record<string, unknown>[]>;
  };
  insert: (table: unknown) => { values: (v: unknown) => Promise<unknown> };
}

/** Boot with a plugin that declares nothing, and return its user service. */
async function boot(dialect: TestDialect): Promise<{
  t: TestNextly;
  pluginUsers: PluginUserService;
  coreUsers: UserService;
}> {
  let pluginUsers: PluginUserService | undefined;
  const plugin = definePlugin({
    name: "@test/user-writes",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init(ctx) {
      pluginUsers = ctx.services.users;
    },
  });
  current = await createTestNextly({
    plugins: [plugin],
    ...(dialect === "sqlite" ? {} : { dialect }),
  });
  if (dialect === "sqlite") {
    // The SQLite runtime auto-sync does not create the core auth tables.
    for (const statement of generateSqliteCoreTableStatements()) {
      await current.adapter.executeQuery(statement);
    }
  }
  if (!pluginUsers) throw new Error("the plugin's init did not run");
  return {
    t: current,
    pluginUsers,
    coreUsers: current.getService("userService") as UserService,
  };
}

function db(t: TestNextly): TestDb {
  return t.adapter.getDrizzle() as unknown as TestDb;
}

async function userRow(
  t: TestNextly,
  email: string
): Promise<Record<string, unknown> | undefined> {
  const { users } = getDialectTables();
  return (await db(t).select().from(users).where(eq(users.email, email)))[0];
}

async function countUsers(t: TestNextly): Promise<number> {
  const { users } = getDialectTables();
  return (await db(t).select().from(users)).length;
}

/** The same decision the request-time gate makes, uncached. */
async function isSuperAdmin(t: TestNextly, userId: string): Promise<boolean> {
  const { isSuperAdminOrThrow } = await import(
    "../../services/lib/permissions"
  );
  return isSuperAdminOrThrow(userId, t.adapter.getDrizzle());
}

/** An existing account, made by core, so the install is not empty. */
async function seedFounder(coreUsers: UserService): Promise<string> {
  const founder = await coreUsers.create(
    {
      email: "founder@example.com",
      name: "Founder",
      password: "Passw0rd!long",
    },
    CONTEXT
  );
  return founder.id;
}

async function superAdminRoleId(t: TestNextly): Promise<string> {
  const { id } = await new ServiceContainer(
    t.adapter
  ).roles.ensureSuperAdminRole();
  return id;
}

/**
 * A plain role, written directly: how a role is built is not under test. Its
 * id is a UUID because the create path looks each role up by one.
 */
async function makeRole(t: TestNextly, slug: string): Promise<string> {
  const { roles } = getDialectTables();
  const id = randomUUID();
  await db(t).insert(roles).values({
    id,
    name: slug,
    slug,
    level: 10,
    isSystem: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

/** A role that INHERITS super-admin while naming itself something else. */
async function makeRoleInheritingSuperAdmin(t: TestNextly): Promise<string> {
  const parent = await makeRole(t, "operator");
  const { roleInherits } = getDialectTables();
  await db(t)
    .insert(roleInherits)
    .values({
      id: randomUUID(),
      parentRoleId: parent,
      childRoleId: await superAdminRoleId(t),
      createdAt: new Date(),
    });
  return parent;
}

describe.each(getConfiguredTestDialects())(
  "ctx.services.users (%s)",
  (dialect: TestDialect) => {
    it("offers no way to create an external account", async () => {
      // Kept on core's own services only: a plugin creating active, verified,
      // passwordless accounts with roles of its choosing is an account policy
      // no operator reviewed.
      const { pluginUsers, coreUsers } = await boot(dialect);
      expect("createExternalUser" in pluginUsers).toBe(false);
      // Not the instance core uses, so the limits below cannot reach core.
      expect(pluginUsers).not.toBe(coreUsers);
    });

    it("refuses to create an install's first account, writing nothing", async () => {
      const { t, pluginUsers } = await boot(dialect);

      await expect(
        pluginUsers.create(
          {
            email: "first@example.com",
            name: "First",
            password: "Passw0rd!long",
          },
          CONTEXT
        )
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(await countUsers(t)).toBe(0);
    });

    it("still lets core create the first account, as super-admin", async () => {
      // The control: setup and the Direct API go through the same service.
      const { t, coreUsers } = await boot(dialect);

      const id = await seedFounder(coreUsers);

      expect(await isSuperAdmin(t, id)).toBe(true);
    });

    it("refuses a create naming the super-admin role, writing nothing", async () => {
      const { t, pluginUsers, coreUsers } = await boot(dialect);
      await seedFounder(coreUsers);
      const superAdmin = await superAdminRoleId(t);

      await expect(
        pluginUsers.create(
          {
            email: "escalate@example.com",
            name: "Escalate",
            password: "Passw0rd!long",
            roles: [superAdmin],
          },
          CONTEXT
        )
      ).rejects.toSatisfy(
        (error: unknown) => NextlyError.is(error) && error.code === "FORBIDDEN"
      );

      expect(await userRow(t, "escalate@example.com")).toBeUndefined();
    });

    it("refuses a create naming a role that inherits super-admin", async () => {
      const { t, pluginUsers, coreUsers } = await boot(dialect);
      await seedFounder(coreUsers);
      const operator = await makeRoleInheritingSuperAdmin(t);

      await expect(
        pluginUsers.create(
          {
            email: "indirect@example.com",
            name: "Indirect",
            password: "Passw0rd!long",
            roles: [operator],
          },
          CONTEXT
        )
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(await userRow(t, "indirect@example.com")).toBeUndefined();
    });

    it("creates an account with an ordinary role, recorded as vouched for by the plugin", async () => {
      // The control: refusing every plugin create would pass every test above.
      const { t, pluginUsers, coreUsers } = await boot(dialect);
      await seedFounder(coreUsers);
      const editor = await makeRole(t, "editor");

      const created = await pluginUsers.create(
        {
          email: "member@example.com",
          name: "Member",
          password: "Passw0rd!long",
          roles: [editor],
        },
        CONTEXT
      );

      const roles = await new ServiceContainer(
        t.adapter
      ).userRoles.listUserRoles(created.id);
      expect(roles).toEqual([editor]);
      expect(await isSuperAdmin(t, created.id)).toBe(false);
      const row = await userRow(t, "member@example.com");
      expect(row?.emailVerified).toBeTruthy();
      expect(row?.emailVerifiedVia).toBe("plugin");
    });

    it("refuses an update giving the super-admin role, changing nothing", async () => {
      const { t, pluginUsers, coreUsers } = await boot(dialect);
      await seedFounder(coreUsers);
      const editor = await makeRole(t, "editor");
      const member = await coreUsers.create(
        {
          email: "member@example.com",
          name: "Member",
          password: "Passw0rd!long",
          roles: [editor],
        },
        CONTEXT
      );
      const superAdmin = await superAdminRoleId(t);

      await expect(
        pluginUsers.update(
          member.id,
          // The name is written before the roles, so it shows whether the
          // refusal came before any write.
          { name: "Renamed", roles: [superAdmin] },
          CONTEXT
        )
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(await isSuperAdmin(t, member.id)).toBe(false);
      expect((await userRow(t, "member@example.com"))?.name).toBe("Member");
    });

    it("still lets core give the super-admin role in an update", async () => {
      // The control: the admin's role editor goes through the same write.
      const { t, coreUsers } = await boot(dialect);
      await seedFounder(coreUsers);
      const member = await coreUsers.create(
        {
          email: "member@example.com",
          name: "Member",
          password: "Passw0rd!long",
        },
        CONTEXT
      );

      await coreUsers.update(
        member.id,
        { roles: [await superAdminRoleId(t)] },
        CONTEXT
      );

      expect(await isSuperAdmin(t, member.id)).toBe(true);
    });

    /** The columns an administrator's account is controlled through. */
    async function controlColumns(
      t: TestNextly,
      id: string
    ): Promise<Record<string, unknown>> {
      const { users } = getDialectTables();
      const [row] = await db(t).select().from(users).where(eq(users.id, id));
      return {
        email: row?.email,
        passwordHash: row?.passwordHash,
        isActive: Boolean(row?.isActive),
        emailVerified: Boolean(row?.emailVerified),
      };
    }

    it.each([
      ["its password", { password: "Takeover-Passw0rd!" }],
      ["its email", { email: "attacker@example.com" }],
      ["its activation", { isActive: false }],
      ["its verification", { emailVerified: null }],
    ])(
      "refuses an update to %s on a super-admin's account, changing nothing",
      async (_, change) => {
        const { t, pluginUsers, coreUsers } = await boot(dialect);
        const founder = await seedFounder(coreUsers);
        const before = await controlColumns(t, founder);

        await expect(
          // A name rides along: it is written before anything else, so it
          // shows whether the refusal came before every write.
          pluginUsers.update(founder, { name: "Renamed", ...change }, CONTEXT)
        ).rejects.toMatchObject({ code: "FORBIDDEN" });

        expect(await controlColumns(t, founder)).toEqual(before);
        const { users } = getDialectTables();
        const [row] = await db(t)
          .select()
          .from(users)
          .where(eq(users.id, founder));
        expect(row?.name).toBe("Founder");
      }
    );

    it("refuses a role change that would demote a super-admin", async () => {
      const { t, pluginUsers, coreUsers } = await boot(dialect);
      const founder = await seedFounder(coreUsers);
      const editor = await makeRole(t, "editor");

      await expect(
        pluginUsers.update(founder, { roles: [editor] }, CONTEXT)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(await isSuperAdmin(t, founder)).toBe(true);
    });

    it("refuses an update to an account that reaches super-admin by inheritance", async () => {
      const { t, pluginUsers, coreUsers } = await boot(dialect);
      await seedFounder(coreUsers);
      const operator = await makeRoleInheritingSuperAdmin(t);
      const admin = await coreUsers.create(
        {
          email: "operator@example.com",
          name: "Operator",
          password: "Passw0rd!long",
          roles: [operator],
        },
        CONTEXT
      );
      expect(await isSuperAdmin(t, admin.id)).toBe(true);

      await expect(
        pluginUsers.update(admin.id, { email: "taken@example.com" }, CONTEXT)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect((await controlColumns(t, admin.id)).email).toBe(
        "operator@example.com"
      );
    });

    it("refuses to delete a super-admin's account", async () => {
      const { t, pluginUsers, coreUsers } = await boot(dialect);
      const founder = await seedFounder(coreUsers);

      await expect(pluginUsers.delete(founder, CONTEXT)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });

      expect(await userRow(t, "founder@example.com")).toBeDefined();
    });

    it("still lets a plugin update and delete an ordinary account", async () => {
      // The control: refusing every plugin write to these fields would pass
      // every refusal above.
      const { t, pluginUsers, coreUsers } = await boot(dialect);
      await seedFounder(coreUsers);
      const member = await coreUsers.create(
        {
          email: "member@example.com",
          name: "Member",
          password: "Passw0rd!long",
        },
        CONTEXT
      );

      await pluginUsers.update(
        member.id,
        {
          name: "Renamed",
          email: "moved@example.com",
          password: "New-Passw0rd!long",
          isActive: false,
        },
        CONTEXT
      );
      const row = await userRow(t, "moved@example.com");
      expect(row?.name).toBe("Renamed");
      expect(Boolean(row?.isActive)).toBe(false);

      await pluginUsers.delete(member.id, CONTEXT);
      expect(await userRow(t, "moved@example.com")).toBeUndefined();
    });

    // The early checks are reads, so another request can change the answer
    // before the write. Each case below changes it in that gap and expects
    // the check inside the write's transaction to refuse.
    it("refuses a create when the last account is deleted before its insert", async () => {
      const { t, pluginUsers, coreUsers } = await boot(dialect);
      const founder = await seedFounder(coreUsers);
      const { users, userRoles } = getDialectTables();
      between.passwordHash = async () => {
        const writer = t.adapter.getDrizzle() as unknown as {
          delete: (table: unknown) => {
            where: (cond: unknown) => Promise<unknown>;
          };
        };
        await writer.delete(userRoles).where(eq(userRoles.userId, founder));
        await writer.delete(users).where(eq(users.id, founder));
      };

      await expect(
        pluginUsers.create(
          {
            email: "first@example.com",
            name: "First",
            password: "Passw0rd!long",
          },
          CONTEXT
        )
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(await countUsers(t)).toBe(0);
    });

    /** An ordinary account, and a grant of super-admin to it, for the gap. */
    async function memberAndGrant(t: TestNextly, coreUsers: UserService) {
      await seedFounder(coreUsers);
      const editor = await makeRole(t, "editor");
      const member = await coreUsers.create(
        {
          email: "member@example.com",
          name: "Member",
          password: "Passw0rd!long",
          roles: [editor],
        },
        CONTEXT
      );
      const superAdmin = await superAdminRoleId(t);
      const grant = async () => {
        const result = await new ServiceContainer(
          t.adapter
        ).userRoles.assignRoleToUser(member.id, superAdmin);
        expect(result.success).toBe(true);
      };
      return { member, editor, grant };
    }

    it("refuses a role change on an account made super-admin after the early check", async () => {
      const { t, coreUsers } = await boot(dialect);
      const { member, editor, grant } = await memberAndGrant(t, coreUsers);
      const other = await makeRole(t, "author");
      between.superAdminCheck = { userId: member.id, run: grant };

      // The roles alone, as a plugin's write: the facade passes its other
      // fields through, so it never makes a roles-only write.
      await expect(
        new UserMutationService(t.adapter, consoleLogger).updateUser(
          member.id,
          { roles: [other] },
          "plugin"
        )
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(await isSuperAdmin(t, member.id)).toBe(true);
      expect(
        await new ServiceContainer(t.adapter).userRoles.listUserRoles(member.id)
      ).toContain(editor);
    });

    it("refuses an email change on an account made super-admin after the early check", async () => {
      const { t, pluginUsers, coreUsers } = await boot(dialect);
      const { member, grant } = await memberAndGrant(t, coreUsers);
      between.superAdminCheck = { userId: member.id, run: grant };

      await expect(
        pluginUsers.update(
          member.id,
          { email: "attacker@example.com" },
          CONTEXT
        )
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect((await controlColumns(t, member.id)).email).toBe(
        "member@example.com"
      );
    });

    it("refuses to delete an account made super-admin after the early check", async () => {
      const { t, pluginUsers, coreUsers } = await boot(dialect);
      const { member, grant } = await memberAndGrant(t, coreUsers);
      between.superAdminCheck = { userId: member.id, run: grant };

      await expect(
        pluginUsers.delete(member.id, CONTEXT)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(await userRow(t, "member@example.com")).toBeDefined();
    });

    it("still lets core update a super-admin's password and email", async () => {
      // The control: the admin edits its own administrators through the same
      // write.
      const { t, coreUsers } = await boot(dialect);
      const founder = await seedFounder(coreUsers);
      const before = await controlColumns(t, founder);

      await coreUsers.update(
        founder,
        { email: "owner@example.com", password: "New-Passw0rd!long" },
        CONTEXT
      );

      const after = await controlColumns(t, founder);
      expect(after.email).toBe("owner@example.com");
      expect(after.passwordHash).not.toBe(before.passwordHash);
    });
  }
);
