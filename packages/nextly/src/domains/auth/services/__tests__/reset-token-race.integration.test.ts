/**
 * A password-reset token used concurrently by two requests over the same
 * database, tested across every dialect.
 *
 * The write that updates the password consumes the token conditionally in the
 * same transaction, so exactly one reset succeeds, the other is refused, and
 * a failing write after consumption commits neither.
 */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

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

const between = vi.hoisted(() => ({
  failReset: false,
}));

vi.mock("../../../users/services/password-write", async importOriginal => {
  const actual =
    await importOriginal<
      typeof import("../../../users/services/password-write")
    >();
  return {
    ...actual,
    updateUserEndingSessions: async (
      ...args: Parameters<typeof actual.updateUserEndingSessions>
    ) => {
      // Let the real write run first: the rollback under test has to undo a
      // password change that was actually made, not one the mock prevented.
      const result = await actual.updateUserEndingSessions(...args);
      if (between.failReset) {
        throw new Error("simulated failure after token claim");
      }
      return result;
    },
  };
});

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
  between.failReset = false;
  vi.useRealTimers();
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

      // Hold both requests at the transaction gate until each has read the
      // token row, so neither can see the other's committed usedAt and
      // refuse before claiming: the loser must lose the conditional claim.
      // No transaction is open while waiting, so serialized dialects queue
      // here without deadlocking.
      let arrived = 0;
      let release!: () => void;
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      for (const svc of [auth1, auth2]) {
        const original = svc["withTransaction"].bind(svc);
        svc["withTransaction"] = (async (
          fn: Parameters<AuthService["withTransaction"]>[0]
        ) => {
          arrived += 1;
          if (arrived === 2) release();
          await gate;
          return original(fn);
        }) as unknown as AuthService["withTransaction"];
      }

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

      if (res1.status === "fulfilled") {
        expect(isPassA).toBe(true);
        expect(isPassB).toBe(false);
      } else {
        expect(res2.status).toBe("fulfilled");
        expect(isPassB).toBe(true);
        expect(isPassA).toBe(false);
      }
    });

    it("commits neither if a write fails after token consumption", async () => {
      const { auth1, db } = await setup(dialect);
      const { token } = await auth1.generatePasswordResetToken(EMAIL, {
        disableEmail: true,
      });

      between.failReset = true;

      await expect(
        auth1.resetPasswordWithToken(token as string, "Passw0rdA123!")
      ).rejects.toMatchObject({
        code: "INTERNAL_ERROR",
        statusCode: 500,
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

    it("reports TOKEN_EXPIRED if the token expires before the consumption write", async () => {
      const { auth1 } = await setup(dialect);
      const { token } = await auth1.generatePasswordResetToken(EMAIL, {
        disableEmail: true,
      });

      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const origWithTransaction = auth1["withTransaction"].bind(auth1);
        auth1["withTransaction"] = (async (fn: any) => {
          vi.setSystemTime(Date.now() + 1000 * 60 * 60 * 24);
          return origWithTransaction(fn);
        }) as any;

        await expect(
          auth1.resetPasswordWithToken(token as string, "Passw0rdA123!")
        ).rejects.toMatchObject({
          code: "TOKEN_EXPIRED",
          statusCode: 401,
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("reports TOKEN_EXPIRED when the claim runs at the exact expiry instant", async () => {
      const { auth1, db } = await setup(dialect);
      const { token } = await auth1.generatePasswordResetToken(EMAIL, {
        disableEmail: true,
      });

      // Park the clock exactly on the token's stored expiry: the initial
      // expiry check passes (strict <), the claim refuses (not strictly
      // greater), and the refusal must be reported as an expiration.
      const [row] = await db
        .select()
        .from(tables.passwordResetTokens)
        .where(eq(tables.passwordResetTokens.identifier, EMAIL));
      const expires = row.expires as Date;

      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(expires.getTime());

        await expect(
          auth1.resetPasswordWithToken(token as string, "Passw0rdA123!")
        ).rejects.toMatchObject({
          code: "TOKEN_EXPIRED",
          statusCode: 401,
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
