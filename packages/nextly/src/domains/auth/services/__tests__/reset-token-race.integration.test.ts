/**
 * A password-reset token used concurrently by two requests over the same
 * database, tested across every dialect.
 *
 * The write that updates the password consumes the token conditionally in the
 * same transaction, so exactly one reset succeeds, the other is refused, and
 * a failing write after consumption commits neither.
 */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { verifyPassword } from "../../../../auth/password";
import { getDialectTables } from "../../../../database/index";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { consoleLogger } from "../../../../services/shared";
import { AuthService } from "../auth-service";

interface TestDb {
  insert: (table: unknown) => { values: (data: unknown) => Promise<unknown> };
  select: () => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<Record<string, unknown>[]>;
    };
  };
}

let current: TestNextly | undefined;
let tables: ReturnType<typeof getDialectTables>;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const EMAIL = "token-race@example.com";
const USER_ID = "token-race-user-1";

async function setup(dialect: TestDialect): Promise<{
  t: TestNextly;
  auth1: AuthService;
  auth2: AuthService;
  db: TestDb;
}> {
  current = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
  tables = getDialectTables(dialect);
  const auth1 = current.getService("authService") as unknown as AuthService;
  const auth2 = new AuthService(
    current.adapter,
    consoleLogger,
    current.getService("emailService") as never
  );
  const db = current.adapter.getDrizzle() as unknown as TestDb;

  await db.insert(tables.users).values({
    id: USER_ID,
    email: EMAIL,
    name: "Reset Token Race User",
    emailVerified: new Date(),
    isActive: true,
    passwordHash: null,
    mustChangePassword: true,
  });

  return { t: current, auth1, auth2, db };
}

describe.each(getConfiguredTestDialects())("on %s", dialect => {
  describe("racing password resets with the same token", () => {
    it("completes one and refuses the other", async () => {
      const { auth1, auth2, db } = await setup(dialect);
      const { token } = await auth1.generatePasswordResetToken(EMAIL, {
        disableEmail: true,
      });

      const passA = "Passw0rdA123!";
      const passB = "Passw0rdB456!";

      // Race two resets running against separate service instances over the same database
      const [res1, res2] = await Promise.allSettled([
        auth1.resetPasswordWithToken(token as string, passA),
        auth2.resetPasswordWithToken(token as string, passB),
      ]);

      const successes = [res1, res2].filter(r => r.status === "fulfilled");
      const rejections = [res1, res2].filter(r => r.status === "rejected");

      expect(successes).toHaveLength(1);
      expect(rejections).toHaveLength(1);

      const rejected = (rejections[0] as PromiseRejectedResult).reason;
      expect(rejected).toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      // Token is now used
      const [tokenRow] = await db
        .select()
        .from(tables.passwordResetTokens)
        .where(eq(tables.passwordResetTokens.identifier, EMAIL));
      expect(tokenRow.usedAt).toBeTruthy();

      // Password matches the winning reset
      const [userRow] = await db
        .select()
        .from(tables.users)
        .where(eq(tables.users.id, USER_ID));

      const isPassA = await verifyPassword(
        passA,
        userRow.passwordHash as string
      );
      const isPassB = await verifyPassword(
        passB,
        userRow.passwordHash as string
      );

      expect(isPassA || isPassB).toBe(true);
      expect(isPassA && isPassB).toBe(false);
    });

    it("commits neither if a write fails after token consumption", async () => {
      const { t, auth1, db } = await setup(dialect);
      const { token } = await auth1.generatePasswordResetToken(EMAIL, {
        disableEmail: true,
      });

      // Deactivate user before the reset write, so updateUserEndingSessions rejects
      await t.nextly.users.update({ id: USER_ID, data: { isActive: false } });

      await expect(
        auth1.resetPasswordWithToken(token as string, "Passw0rdA123!")
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });

      // Assert token was NOT consumed (usedAt is still null)
      const [tokenRow] = await db
        .select()
        .from(tables.passwordResetTokens)
        .where(eq(tables.passwordResetTokens.identifier, EMAIL));
      expect(tokenRow.usedAt).toBeNull();

      // Assert user password was not set
      const [userRow] = await db
        .select()
        .from(tables.users)
        .where(eq(tables.users.id, USER_ID));
      expect(userRow.passwordHash).toBeNull();
    });
  });
});
