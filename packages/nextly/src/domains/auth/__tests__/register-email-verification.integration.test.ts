// Self-registration must not mark the address verified.
//
// Anyone could type any address and receive an account the system treated as
// having proved it. `requireEmailVerification` then blocked nobody, and any
// later feature that trusts the flag — linking an external identity to a
// "verified" local account, for one — would trust an unproven claim.

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../database/index";
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

interface AuthServiceShape {
  registerUser(input: {
    email: string;
    name?: string;
    password: string;
  }): Promise<{ id: string; email: string }>;
  generateEmailVerificationToken(
    email: string,
    options?: { disableEmail?: boolean }
  ): Promise<{ token?: string }>;
  verifyEmail(token: string): Promise<{ email: string }>;
}

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
  return current;
}

/** The slice of the Drizzle instance this suite drives. */
interface TestDb {
  select: (columns: Record<string, unknown>) => {
    from: (table: unknown) => {
      where: (cond: unknown) => {
        limit: (n: number) => Promise<Array<{ emailVerified: unknown }>>;
      };
    };
  };
}

/** `emailVerified` straight off the row, so no service projection can soften the answer. */
async function emailVerifiedOf(t: TestNextly, email: string): Promise<unknown> {
  const db = t.adapter.getDrizzle() as unknown as TestDb;
  const { users } = getDialectTables();
  const rows = await db
    .select({ emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  expect(rows).toHaveLength(1);
  return rows[0].emailVerified ?? null;
}

describe.each(getConfiguredTestDialects())(
  "self-registration leaves the address unverified (%s)",
  (dialect: TestDialect) => {
    it("does not set emailVerified when a user registers themselves", async () => {
      const t = await boot(dialect);
      const auth = t.getService("authService") as unknown as AuthServiceShape;

      await auth.registerUser({
        email: "selfsignup@example.com",
        name: "Self Signup",
        password: "Str0ngPassw0rd!",
      });

      expect(await emailVerifiedOf(t, "selfsignup@example.com")).toBeNull();
    });

    it("sets emailVerified once the verification link is followed", async () => {
      // The positive control for the test above: without it, a gate that
      // never verifies anybody would also pass.
      const t = await boot(dialect);
      const auth = t.getService("authService") as unknown as AuthServiceShape;

      await auth.registerUser({
        email: "confirms@example.com",
        name: "Confirms",
        password: "Str0ngPassw0rd!",
      });
      const { token } = await auth.generateEmailVerificationToken(
        "confirms@example.com",
        { disableEmail: true }
      );
      expect(token).toBeTruthy();
      await auth.verifyEmail(token as string);

      expect(await emailVerifiedOf(t, "confirms@example.com")).not.toBeNull();
    });

    it("keeps an admin-set password vouching for the account", async () => {
      // Unchanged behaviour: an admin who types the password has established
      // the address out of band, so that account stays verified at creation.
      const t = await boot(dialect);
      const users = new ServiceContainer(t.adapter).users;

      await users.createLocalUser({
        email: "adminmade@example.com",
        name: "Admin Made",
        password: "Str0ngPassw0rd!",
        emailVerification: "admin-vouched",
      });

      expect(await emailVerifiedOf(t, "adminmade@example.com")).not.toBeNull();
    });

    it("leaves an invited account unverified, as before", async () => {
      const t = await boot(dialect);
      const users = new ServiceContainer(t.adapter).users;

      await users.createLocalUser({
        email: "invited@example.com",
        name: "Invited",
        emailVerification: "admin-vouched",
      });

      expect(await emailVerifiedOf(t, "invited@example.com")).toBeNull();
    });

    it("defaults to unverified when the caller says nothing", async () => {
      // The safe default is what protects a caller outside this package that
      // has not been updated: silence must not mean "vouched".
      const t = await boot(dialect);
      const users = new ServiceContainer(t.adapter).users;

      await users.createLocalUser({
        email: "unspecified@example.com",
        name: "Unspecified",
        password: "Str0ngPassw0rd!",
      });

      expect(await emailVerifiedOf(t, "unspecified@example.com")).toBeNull();
    });
  }
);
