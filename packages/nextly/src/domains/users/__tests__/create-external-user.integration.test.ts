// Creating a user for an identity a trusted provider has already verified.
//
// A passwordless `createLocalUser` makes an INACTIVE invite with a set-password
// link, and the very first account it creates becomes super-admin. Neither is
// right for an external login: the account must be usable at once, and a login
// provider must never be able to mint the first administrator.

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../database/index";
import { generateSqliteCoreTableStatements } from "../../../database/sqlite-core-tables";
import { z } from "zod";

import { NextlyError } from "../../../errors";
import { CreateLocalUserSchema } from "../../../schemas/_zod/user";
import { ServiceContainer } from "../../../services/index";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SYSTEM_CONTEXT = { user: undefined } as never;

/**
 * The unique-violation each driver actually raises.
 *
 * Spelled per dialect because that is the input `toDbError` reads: a generic
 * error carrying no recognised code or message classifies as internal, and a
 * test built on one would fail whether or not the translation exists.
 */
function uniqueViolation(dialect: TestDialect): Error {
  if (dialect === "postgresql") {
    return Object.assign(
      new Error(
        'duplicate key value violates unique constraint "users_email_unique"'
      ),
      { code: "23505" }
    );
  }
  if (dialect === "mysql") {
    return Object.assign(
      new Error("Duplicate entry 'raced@example.com' for key 'users.email'"),
      { code: "ER_DUP_ENTRY", errno: 1062 }
    );
  }
  return Object.assign(new Error("UNIQUE constraint failed: users.email"), {
    code: "SQLITE_CONSTRAINT_UNIQUE",
  });
}

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

/** An existing account, so the install is not empty. */
async function seedFirstUser(t: TestNextly): Promise<void> {
  await services(t).users.createLocalUser({
    email: "founder@example.com",
    name: "Founder",
    password: "Str0ng-P@ssw0rd!",
    isActive: true,
    emailVerification: "admin-vouched",
  });
}

/**
 * A role row, written directly.
 *
 * The role service requires a permission set this suite has no opinion about;
 * what is under test is which roles an external user ends up with, not how a
 * role is built.
 */
async function makeRole(t: TestNextly, slug: string): Promise<string> {
  const db = t.adapter.getDrizzle() as unknown as {
    insert: (table: unknown) => { values: (v: unknown) => Promise<unknown> };
  };
  const { roles } = getDialectTables();
  const id = `role-${slug}`;
  await db.insert(roles).values({
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

interface TestDb {
  select: (cols?: Record<string, unknown>) => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<Record<string, unknown>[]>;
    } & Promise<Record<string, unknown>[]>;
  };
}

async function userRow(
  t: TestNextly,
  email: string
): Promise<Record<string, unknown> | undefined> {
  const db = t.adapter.getDrizzle() as unknown as TestDb;
  const { users } = getDialectTables();
  const rows = await db.select().from(users).where(eq(users.email, email));
  return rows[0];
}

async function countUsers(t: TestNextly): Promise<number> {
  const db = t.adapter.getDrizzle() as unknown as TestDb;
  const { users } = getDialectTables();
  return (await db.select().from(users)).length;
}

describe.each(getConfiguredTestDialects())(
  "createExternalUser (%s)",
  (dialect: TestDialect) => {
    it("creates an active, verified, passwordless account with exactly the given roles", async () => {
      const t = await boot(dialect);
      await seedFirstUser(t);
      const editor = await makeRole(t, "editor");
      const verifiedAt = new Date("2026-05-01T10:00:00Z");

      const created = await services(t).users.createExternalUser(
        {
          email: "External@Example.com",
          name: "External Person",
          roleIds: [editor],
          emailVerifiedAt: verifiedAt,
        },
        SYSTEM_CONTEXT
      );

      const row = await userRow(t, "external@example.com");
      expect(row).toBeDefined();
      expect(row?.isActive).toBeTruthy();
      expect(row?.emailVerified).not.toBeNull();
      // No credential, and no set-password invite to deliver either.
      expect(row?.passwordHash).toBeFalsy();
      expect(created.email).toBe("external@example.com");

      const roles = await services(t).userRoles.listUserRoles(
        String(created.id)
      );
      expect(roles).toEqual([editor]);
    });

    it("records user.created, like the local path does", async () => {
      // The public facade delegates straight here, so an account provisioned
      // by a login provider was invisible to every webhook and plugin
      // subscriber that sees an ordinary creation. Asserted against the outbox
      // rather than a spy: the row is what a subscriber actually reads, and it
      // must be written inside the account's own transaction.
      const t = await boot(dialect);
      await seedFirstUser(t);
      const editor = await makeRole(t, "editor");

      const created = await services(t).users.createExternalUser(
        {
          email: "evented@example.com",
          name: "Evented Person",
          roleIds: [editor],
          emailVerifiedAt: new Date("2026-05-01T10:00:00Z"),
        },
        SYSTEM_CONTEXT
      );

      const db = t.adapter.getDrizzle() as unknown as TestDb;
      const { nextlyEvents } = getDialectTables();
      const rows = (await db.select().from(nextlyEvents)) as {
        type?: string;
        resourceId?: string;
      }[];
      const mine = rows.filter(
        row =>
          row.type === "user.created" && row.resourceId === String(created.id)
      );
      expect(mine).toHaveLength(1);
    });

    it("writes no creation event when the account is refused", async () => {
      // The control. An event recorded outside the account's transaction, or
      // before the policy checks, would still satisfy the assertion above
      // while announcing a user that does not exist.
      const t = await boot(dialect);
      const db = t.adapter.getDrizzle() as unknown as TestDb;
      const { nextlyEvents } = getDialectTables();
      const before = ((await db.select().from(nextlyEvents)) as unknown[])
        .length;

      await expect(
        services(t).users.createExternalUser(
          {
            email: "refused@example.com",
            name: "Refused",
            roleIds: [],
            emailVerifiedAt: new Date("2026-05-01T10:00:00Z"),
          },
          SYSTEM_CONTEXT
        )
      ).rejects.toThrow(NextlyError);

      const after = ((await db.select().from(nextlyEvents)) as unknown[])
        .length;
      expect(after).toBe(before);
    });

    it("refuses on an empty install, writing nothing", async () => {
      // The first account decides who administers the site. A login provider
      // must never be the thing that creates it.
      const t = await boot(dialect);
      const editor = await makeRole(t, "editor");

      await expect(
        services(t).users.createExternalUser(
          {
            email: "first@example.com",
            name: "First",
            roleIds: [editor],
            emailVerifiedAt: new Date(),
          },
          SYSTEM_CONTEXT
        )
      ).rejects.toSatisfy(NextlyError.is);

      expect(await countUsers(t)).toBe(0);
    });

    it("refuses the super-admin role", async () => {
      const t = await boot(dialect);
      await seedFirstUser(t);
      const { id: superAdminId } =
        await services(t).roles.ensureSuperAdminRole();

      await expect(
        services(t).users.createExternalUser(
          {
            email: "escalate@example.com",
            name: "Escalate",
            roleIds: [superAdminId],
            emailVerifiedAt: new Date(),
          },
          SYSTEM_CONTEXT
        )
      ).rejects.toSatisfy(NextlyError.is);

      expect(await userRow(t, "escalate@example.com")).toBeUndefined();
    });

    it("refuses an empty role list", async () => {
      // An external account must carry an explicit privilege decision rather
      // than defaulting to whatever the system later treats as "no roles".
      const t = await boot(dialect);
      await seedFirstUser(t);

      await expect(
        services(t).users.createExternalUser(
          {
            email: "noroles@example.com",
            name: "No Roles",
            roleIds: [],
            emailVerifiedAt: new Date(),
          },
          SYSTEM_CONTEXT
        )
      ).rejects.toSatisfy(NextlyError.is);
    });

    it("refuses an unknown role id and writes no user", async () => {
      const t = await boot(dialect);
      await seedFirstUser(t);

      await expect(
        services(t).users.createExternalUser(
          {
            email: "badrole@example.com",
            name: "Bad Role",
            roleIds: ["role-that-does-not-exist"],
            emailVerifiedAt: new Date(),
          },
          SYSTEM_CONTEXT
        )
      ).rejects.toSatisfy(NextlyError.is);

      expect(await userRow(t, "badrole@example.com")).toBeUndefined();
    });

    it("refuses an address differing only by case from an existing account", async () => {
      const t = await boot(dialect);
      await seedFirstUser(t);
      const editor = await makeRole(t, "editor");

      await expect(
        services(t).users.createExternalUser(
          {
            email: "FOUNDER@EXAMPLE.COM",
            name: "Impostor",
            roleIds: [editor],
            emailVerifiedAt: new Date(),
          },
          SYSTEM_CONTEXT
        )
      ).rejects.toSatisfy(NextlyError.is);
    });

    it("does not make the account super-admin even when it is the second user", async () => {
      // The first-user branch in createLocalUser must not run on this path.
      const t = await boot(dialect);
      await seedFirstUser(t);
      const editor = await makeRole(t, "editor");

      const created = await services(t).users.createExternalUser(
        {
          email: "second@example.com",
          name: "Second",
          roleIds: [editor],
          emailVerifiedAt: new Date(),
        },
        SYSTEM_CONTEXT
      );

      const names = await services(t).userRoles.listUserRoleNames(
        String(created.id)
      );
      expect(names).not.toContain("super-admin");
    });

    it("is not blocked by a REQUIRED custom user field", async () => {
      // The merged create schema carries the install's custom fields, and a
      // provider asserts none of them — so an install that marked any custom
      // field required failed every external login on a value the caller had
      // no way to send. The external path validates the CORE schema instead.
      //
      // The merged schema is installed on the instance rather than configured
      // through the harness, because what is under test is WHICH schema this
      // path consults, not how custom fields are declared.
      const t = await boot(dialect);
      await seedFirstUser(t);
      const editor = await makeRole(t, "editor");

      const users = services(t).users;
      const mutation = (
        users as unknown as {
          mutationService: { createSchema: unknown; schemasStale?: boolean };
        }
      ).mutationService;
      mutation.createSchema = CreateLocalUserSchema.extend({
        department: z.string().min(1, "Department is required"),
      });

      const created = await users.createExternalUser(
        {
          email: "custom@example.com",
          name: "Custom",
          roleIds: [editor],
          emailVerifiedAt: new Date(),
        },
        SYSTEM_CONTEXT
      );

      expect(created.email).toBe("custom@example.com");
    });

    it("still refuses input the CORE schema rejects", async () => {
      // The control: ignoring the merged schema must not mean validating
      // nothing, or a malformed address would reach the insert.
      const t = await boot(dialect);
      await seedFirstUser(t);
      const editor = await makeRole(t, "editor");

      await expect(
        services(t).users.createExternalUser(
          {
            email: "not-an-address",
            name: "Bad",
            roleIds: [editor],
            emailVerifiedAt: new Date(),
          },
          SYSTEM_CONTEXT
        )
      ).rejects.toSatisfy(NextlyError.is);
    });

    it("reports a unique violation from the INSERT as a duplicate", async () => {
      // The pre-flight lookup is a READ, so it cannot settle a race: two
      // provider callbacks for the same new address both pass it and the
      // loser's insert violates the unique index. Untranslated that surfaced
      // as an untyped 500, and the provider could not tell "already exists" —
      // the case it recovers from by loading the account — from a real failure.
      //
      // The violation is INDUCED rather than raced for, because a race is not
      // reproducible: two calls that happen to serialize would be refused by
      // the read instead, and the test would pass without ever reaching the
      // classification it names. The transaction is made to fail exactly as
      // the database fails it.
      const t = await boot(dialect);
      await seedFirstUser(t);
      const editor = await makeRole(t, "editor");

      // ONE instance, held, and the MUTATION service rather than the facade:
      // `services()` builds a fresh container each call, and `users` delegates
      // to `mutationService`, which is where the transaction runs. Patching
      // anything else leaves the real transaction in place and the test passes
      // without ever reaching the branch it names.
      const users = services(t).users;
      const mutation = (
        users as unknown as {
          mutationService: {
            withTransaction: (...args: never[]) => unknown;
          };
        }
      ).mutationService;
      mutation.withTransaction = async () => {
        // The shape THIS dialect's driver reports, not a NextlyError:
        // translating a ready-made NextlyError would prove nothing about the
        // classification, and a shape no driver produces would be classified
        // as internal and fail the test for the wrong reason.
        throw uniqueViolation(dialect);
      };

      await expect(
        users.createExternalUser(
          {
            email: "raced@example.com",
            name: "Raced",
            roleIds: [editor],
            emailVerifiedAt: new Date(),
          },
          SYSTEM_CONTEXT
        )
      ).rejects.toMatchObject({ code: "DUPLICATE" });
    });
  }
);
