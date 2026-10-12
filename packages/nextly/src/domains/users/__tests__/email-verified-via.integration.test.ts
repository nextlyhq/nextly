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

/** An existing account, so the install is not empty. */
async function seedFounder(t: TestNextly): Promise<void> {
  await services(t).users.createLocalUser({
    email: "founder@example.com",
    name: "Founder",
    password: PASSWORD,
    isActive: true,
    emailVerification: "admin-vouched",
  });
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

      await services(t).users.createExternalUser({
        email: "external@example.com",
        name: "External",
        roleIds: [editor],
        emailVerifiedAt: new Date(),
      });

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
  }
);
