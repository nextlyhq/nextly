/**
 * Every path that verifies an address records how, in the same write.
 *
 * `email_verified` says an address is verified; `email_verified_via` says what
 * established it. A later decision keyed on how an address was verified, such
 * as linking a sign-in to an existing account by email, can only trust the
 * second if every writer of the first sets it, and clears it when the address
 * stops being verified.
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../database/index";
import { seedPermissions } from "../../../database/seeders/permissions";
import { seedSuperAdmin } from "../../../database/seeders/super-admin";
import { generateSqliteCoreTableStatements } from "../../../database/sqlite-core-tables";
import {
  asCaller,
  sessionCaller,
} from "../../../dispatcher/__tests__/request-caller";
import { dispatchUser } from "../../../dispatcher/handlers/user-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ServiceContainer } from "../../../services/index";
import type { UserService } from "../../../services/users/user-service";
import type { AuthService } from "../../auth/services/auth-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A users route dispatched as `adminId`, as the route handler dispatches it. */
function dispatchAsAdmin(
  adminId: string,
  ...args: Parameters<typeof dispatchUser>
): ReturnType<typeof dispatchUser> {
  return asCaller(sessionCaller({ userId: adminId }), () =>
    dispatchUser(...args)
  );
}

const PASSWORD = "Str0ng-P@ssw0rd!";

interface TestDb {
  select: () => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<Record<string, unknown>[]>;
    };
  };
  insert: (table: unknown) => { values: (v: unknown) => Promise<unknown> };
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

/** The two columns under test, read back from the database. */
async function verification(
  t: TestNextly,
  email: string
): Promise<{ verified: boolean; via: unknown }> {
  const db = t.adapter.getDrizzle() as unknown as TestDb;
  const { users } = getDialectTables();
  const [row] = await db.select().from(users).where(eq(users.email, email));
  if (!row) throw new Error(`no account for ${email}`);
  return { verified: Boolean(row.emailVerified), via: row.emailVerifiedVia };
}

/**
 * An existing account, so the install is not empty. Its id is returned so a
 * test can act as this account.
 */
async function seedFounder(t: TestNextly): Promise<string> {
  const founder = await services(t).users.createLocalUser({
    email: "founder@example.com",
    name: "Founder",
    password: PASSWORD,
    isActive: true,
    emailVerification: "admin-vouched",
  });
  return String(founder.id);
}

/** An account a login provider's sign-in made, with its id. */
async function externalAccount(t: TestNextly): Promise<string> {
  const db = t.adapter.getDrizzle() as unknown as TestDb;
  const { roles } = getDialectTables();
  const editor = randomUUID();
  await db.insert(roles).values({
    id: editor,
    name: "editor",
    slug: "editor",
    level: 10,
    isSystem: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const created = await services(t).users.createExternalUser({
    email: "external@example.com",
    name: "External",
    roleIds: [editor],
    emailVerifiedAt: new Date(),
  });
  return String(created.id);
}

describe.each(getConfiguredTestDialects())(
  "email_verified_via (%s)",
  (dialect: TestDialect) => {
    it("records an administrator's vouching at creation as admin", async () => {
      const t = await boot(dialect);
      await seedFounder(t);
      expect(await verification(t, "founder@example.com")).toEqual({
        verified: true,
        via: "admin",
      });
    });

    it("records an account an administrator creates through the admin route as admin", async () => {
      // The route vouches, not the request. The body names a mode of its own,
      // as any client could, and the account is still recorded as vouched for
      // by the administrator: the route sets the mode after the body, so the
      // body cannot unset it, and without the route's setting the service
      // would leave the address unproven.
      const t = await boot(dialect);
      const adminId = await seedFounder(t);
      await dispatchAsAdmin(
        adminId,
        services(t),
        "createLocalUser",
        {},
        {
          email: "routed@example.com",
          name: "Routed",
          password: PASSWORD,
          emailVerification: "pending",
        }
      );
      expect(await verification(t, "routed@example.com")).toEqual({
        verified: true,
        via: "admin",
      });
    });

    it("records the Direct API's default vouching as admin", async () => {
      const t = await boot(dialect);
      await (t.getService("userService") as UserService).create(
        { email: "direct@example.com", name: "Direct", password: PASSWORD },
        {}
      );
      expect(await verification(t, "direct@example.com")).toEqual({
        verified: true,
        via: "admin",
      });
    });

    it("records nothing for an address nobody vouched for", async () => {
      // The control for every case above: a column filled on every insert
      // would pass them while describing an unverified address.
      const t = await boot(dialect);
      await services(t).users.createLocalUser({
        email: "pending@example.com",
        name: "Pending",
        password: PASSWORD,
        emailVerification: "pending",
      });
      expect(await verification(t, "pending@example.com")).toEqual({
        verified: false,
        via: null,
      });
    });

    it("records a followed verification link as link", async () => {
      const t = await boot(dialect);
      await services(t).users.createLocalUser({
        email: "pending@example.com",
        name: "Pending",
        password: PASSWORD,
        emailVerification: "pending",
      });
      const auth = t.getService("authService") as unknown as AuthService;
      const { token } = await auth.generateEmailVerificationToken(
        "pending@example.com",
        { disableEmail: true }
      );

      await auth.verifyEmail(token as string);

      expect(await verification(t, "pending@example.com")).toEqual({
        verified: true,
        via: "link",
      });
    });

    it("records an accepted invite as invite", async () => {
      const t = await boot(dialect);
      await seedFounder(t);
      // No password: the account is an invite, and the link is handed back.
      const created = await services(t).users.createLocalUser({
        email: "invited@example.com",
        name: "Invited",
        emailVerification: "admin-vouched",
      });
      expect(await verification(t, "invited@example.com")).toEqual({
        verified: false,
        via: null,
      });
      const token = new URL(created.invite?.link as string).searchParams.get(
        "token"
      );

      const auth = t.getService("authService") as unknown as AuthService;
      await auth.acceptInvite(token as string, PASSWORD);

      expect(await verification(t, "invited@example.com")).toEqual({
        verified: true,
        via: "invite",
      });
    });

    it("records a login provider's account as external", async () => {
      const t = await boot(dialect);
      await seedFounder(t);
      await externalAccount(t);

      expect(await verification(t, "external@example.com")).toEqual({
        verified: true,
        via: "external",
      });
    });

    it("records setup's first account as admin", async () => {
      // Setup and the playground seed create the first administrator through
      // the seeder, which vouches for the address the operator typed.
      const t = await boot(dialect);
      await seedPermissions(t.adapter, { silent: true });
      const result = await seedSuperAdmin(t.adapter, {
        email: "owner@example.com",
        password: PASSWORD,
        name: "Owner",
        silent: true,
      });
      expect(result.success).toBe(true);

      expect(await verification(t, "owner@example.com")).toEqual({
        verified: true,
        via: "admin",
      });
    });

    it("records an update that verifies as admin, and clears both on unverify", async () => {
      const t = await boot(dialect);
      await services(t).users.createLocalUser({
        email: "pending@example.com",
        name: "Pending",
        password: PASSWORD,
        emailVerification: "pending",
      });
      const users = t.getService("userService") as UserService;
      const found = await users.findByEmail("pending@example.com", {});
      const id = found?.id as string;

      await users.update(id, { emailVerified: new Date() }, {});
      expect(await verification(t, "pending@example.com")).toEqual({
        verified: true,
        via: "admin",
      });

      // An update that does not name the address passes `emailVerified`
      // through as undefined, which must leave both columns alone.
      await users.update(id, { name: "Renamed" }, {});
      expect(await verification(t, "pending@example.com")).toEqual({
        verified: true,
        via: "admin",
      });

      await users.update(id, { emailVerified: null }, {});
      expect(await verification(t, "pending@example.com")).toEqual({
        verified: false,
        via: null,
      });
    });

    it("refuses a verification date string that is not an ISO date-time", async () => {
      // "0" would parse as the year 2000 and verify the address on a date
      // nobody gave; "soon" would not parse at all and fail the write.
      const t = await boot(dialect);
      const adminId = await seedFounder(t);
      await services(t).users.createLocalUser({
        email: "pending@example.com",
        name: "Pending",
        password: PASSWORD,
        emailVerification: "pending",
      });
      const users = t.getService("userService") as UserService;
      const found = await users.findByEmail("pending@example.com", {});
      const params = {
        userId: found?.id as string,
      };

      for (const emailVerified of ["0", "soon"]) {
        await expect(
          dispatchAsAdmin(adminId, services(t), "updateUser", params, {
            emailVerified,
          })
        ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      }
      expect(await verification(t, "pending@example.com")).toEqual({
        verified: false,
        via: null,
      });
    });

    it("takes a verification date the admin route sends as a string", async () => {
      // The update schema accepts an ISO string, and the route passes it on.
      const t = await boot(dialect);
      const adminId = await seedFounder(t);
      const id = await externalAccount(t);
      const db = t.adapter.getDrizzle() as unknown as TestDb;
      const { users } = getDialectTables();
      const [row] = await db.select().from(users).where(eq(users.id, id));
      const stored = new Date(row?.emailVerified as Date | string);
      const params = {
        userId: id,
      };

      // The stored moment: nothing is verified anew, so the provider still
      // vouches for the address.
      await dispatchAsAdmin(adminId, services(t), "updateUser", params, {
        name: "Renamed",
        emailVerified: stored.toISOString(),
      });
      expect(await verification(t, "external@example.com")).toEqual({
        verified: true,
        via: "external",
      });

      // Another moment: the administrator verifies it now.
      await dispatchAsAdmin(adminId, services(t), "updateUser", params, {
        emailVerified: "2026-01-02T03:04:05.000Z",
      });
      expect(await verification(t, "external@example.com")).toEqual({
        verified: true,
        via: "admin",
      });
    });
  }
);
