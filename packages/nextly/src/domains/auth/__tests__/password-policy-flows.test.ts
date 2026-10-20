/**
 * R-5's per-flow lane: the password rule binds whenever a staff password is
 * set, so the same refusals run through every flow that sets one —
 * registration, reset, change, the password an invited user submits, and one
 * an administrator sets — and every refused set leaves the state it found
 * unchanged: no password installed, no account occupying the address, the
 * reset token and the invitation still pending (staff-only-access spec, R-5).
 *
 * The rule itself is unit-tested in `auth/password/password.test.ts`; the
 * set-password happy path of every flow here runs against a real database in
 * `domains/users/__tests__/password-hashing.integration.test.ts`. This lane
 * deliberately stops at the refusals and the state they must leave: the
 * transaction-dependent success legs of reset and invite do not run on the
 * unit lane's SQLite (see the skip notes in auth-service.test.ts), and the
 * registration success leg needs the RBAC bootstrap. Where the lane does
 * allow it — change, and the administrator create/update writes, whose
 * refusals are driven through the services themselves — acceptance
 * is asserted too, class-less passwords included.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  createTestDb,
  type TestDb,
  testLogger,
} from "../../../__tests__/fixtures/db";
import { userFactory } from "../../../__tests__/fixtures/users";
import { hashPassword, verifyPassword } from "../../../auth/password";
import {
  CreateLocalUserSchema,
  UpdateUserSchema,
} from "../../../schemas/_zod/user";
import { UserMutationService } from "../../../services/users/user-mutation-service";
import { hashInviteToken } from "../lib/invite-token";
import { AuthService } from "../services/auth-service";

/**
 * bcrypt cost for hashes this suite CREATES as fixtures. Production uses 12;
 * a fixture's strength protects nothing on an in-memory database, and
 * `verifyPassword` reads any cost alike (the full rationale stands in
 * auth-service.test.ts, which this suite mirrors).
 */
const FIXTURE_SALT_ROUNDS = 4;

/** The credential a fixture account holds before the flow under test runs. */
const CURRENT = "Current-Password-9";

/** Lowercase letters only, exactly the minimum length: no class passes it. */
const CLASSLESS = "xyzwvuts";

/** Head of the shipped common-passwords list; 8 characters, so the list is
 * the only rule it trips. */
const COMMON = "password";

/** ASCII, 80 bytes: inside the character bounds, past the 72-byte reach. */
const OVER_REACH = "a".repeat(80);

describe("the staff password rule runs in every flow that sets a staff password", () => {
  let testDb: TestDb;
  let service: AuthService;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new AuthService(testDb.adapter, testLogger);
  });

  afterEach(async () => {
    await testDb.reset();
    await testDb.close();
  });

  /** The stored hash of the account at `email`, read straight from the table. */
  async function storedHash(email: string): Promise<string | null> {
    const user = await testDb.db.query.users.findFirst({
      where: { email },
      columns: { passwordHash: true },
    });
    return user?.passwordHash ?? null;
  }

  /** The public validation errors a refused set carries. */
  function validationErrors(err: unknown): { path: string; message: string }[] {
    const publicData = (err as { publicData?: { errors?: unknown[] } })
      .publicData;
    return (publicData?.errors ?? []) as { path: string; message: string }[];
  }

  describe("registration", () => {
    it("refuses a password on the common list, leaving no account at the address", async () => {
      const email = "register-common@test.com";

      await expect(
        service.registerUser({ email, password: COMMON })
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      const user = await testDb.db.query.users.findFirst({
        where: { email },
      });
      expect(user).toBeUndefined();
    });

    it("refuses a password past the digester's reach, naming the limit, leaving no account", async () => {
      const email = "register-reach@test.com";

      const err = await service
        .registerUser({ email, password: OVER_REACH })
        .catch((e: unknown) => e);

      expect((err as { code?: string }).code).toBe("VALIDATION_ERROR");
      expect(validationErrors(err)).toEqual([
        expect.objectContaining({
          path: "password",
          message: expect.stringContaining("72-byte"),
        }),
      ]);

      const user = await testDb.db.query.users.findFirst({
        where: { email },
      });
      expect(user).toBeUndefined();
    });
  });

  describe("reset with a token", () => {
    it("refuses a common password, leaving the old credential and the token unused", async () => {
      const email = "reset-common@test.com";
      const currentHash = await hashPassword(CURRENT, FIXTURE_SALT_ROUNDS);
      await testDb.db
        .insert(testDb.schema.users)
        .values(userFactory({ email, passwordHash: currentHash }));

      const { token } = await service.generatePasswordResetToken(email);
      expect(token).toBeDefined();

      const err = await service
        .resetPasswordWithToken(token as string, COMMON)
        .catch((e: unknown) => e);
      expect((err as { code?: string }).code).toBe("VALIDATION_ERROR");
      expect(validationErrors(err)).toEqual([
        expect.objectContaining({
          path: "newPassword",
          message: expect.stringContaining("too common"),
        }),
      ]);

      expect(await storedHash(email)).toBe(currentHash);
      const row = await testDb.db.query.passwordResetTokens.findFirst({
        where: { identifier: email },
      });
      expect(row?.usedAt ?? null).toBeNull();
    });

    it("refuses a password past the digester's reach, the token still unused", async () => {
      const email = "reset-reach@test.com";
      const currentHash = await hashPassword(CURRENT, FIXTURE_SALT_ROUNDS);
      await testDb.db
        .insert(testDb.schema.users)
        .values(userFactory({ email, passwordHash: currentHash }));

      const { token } = await service.generatePasswordResetToken(email);

      await expect(
        service.resetPasswordWithToken(token as string, OVER_REACH)
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "newPassword",
              message: expect.stringContaining("72-byte"),
            }),
          ],
        },
      });

      expect(await storedHash(email)).toBe(currentHash);
      const row = await testDb.db.query.passwordResetTokens.findFirst({
        where: { identifier: email },
      });
      expect(row?.usedAt ?? null).toBeNull();
    });
  });

  describe("change of password", () => {
    it("accepts a class-less password within the policy", async () => {
      const email = "change-classless@test.com";
      const user = userFactory({
        email,
        passwordHash: await hashPassword(CURRENT, FIXTURE_SALT_ROUNDS),
      });
      await testDb.db.insert(testDb.schema.users).values(user);

      await service.changePassword(user.id, CURRENT, CLASSLESS);

      const newHash = await storedHash(email);
      expect(newHash).not.toBeNull();
      expect(newHash).not.toBe(user.passwordHash);
      expect(await verifyPassword(CLASSLESS, newHash as string)).toBe(true);
    });

    it("refuses a change to a password on the common list, the current credential standing", async () => {
      const email = "change-common@test.com";
      const currentHash = await hashPassword(CURRENT, FIXTURE_SALT_ROUNDS);
      const user = userFactory({ email, passwordHash: currentHash });
      await testDb.db.insert(testDb.schema.users).values(user);

      await expect(
        service.changePassword(user.id, CURRENT, COMMON)
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "newPassword",
              message: expect.stringContaining("too common"),
            }),
          ],
        },
      });

      expect(await storedHash(email)).toBe(currentHash);
    });

    it("refuses a change to a password past the digester's reach, the current credential standing", async () => {
      const email = "change-reach@test.com";
      const currentHash = await hashPassword(CURRENT, FIXTURE_SALT_ROUNDS);
      const user = userFactory({ email, passwordHash: currentHash });
      await testDb.db.insert(testDb.schema.users).values(user);

      await expect(
        service.changePassword(user.id, CURRENT, OVER_REACH)
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "newPassword",
              message: expect.stringContaining("72-byte"),
            }),
          ],
        },
      });

      expect(await storedHash(email)).toBe(currentHash);
    });
  });

  describe("the password an invited user submits", () => {
    /** An account awaiting its invite, and the raw token that sets it. */
    async function invitedUser(email: string): Promise<{
      rawToken: string;
    }> {
      const user = userFactory({ email });
      await testDb.db.insert(testDb.schema.users).values(user);
      const rawToken = `invite-token-${user.id}`;
      await testDb.db.insert(testDb.schema.userInviteTokens).values({
        userId: user.id,
        tokenHash: hashInviteToken(rawToken),
        expires: new Date(Date.now() + 60 * 60 * 1000),
      });
      return { rawToken };
    }

    it("refuses a common password, the invitation staying pending", async () => {
      const email = "invite-common@test.com";
      const { rawToken } = await invitedUser(email);

      await expect(
        service.acceptInvite(rawToken, COMMON)
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "newPassword",
              message: expect.stringContaining("too common"),
            }),
          ],
        },
      });

      expect(await storedHash(email)).toBeNull();
      const row = await testDb.db.query.userInviteTokens.findFirst({});
      expect(row?.usedAt ?? null).toBeNull();
    });

    it("refuses a password past the digester's reach, the invitation still pending", async () => {
      const email = "invite-reach@test.com";
      const { rawToken } = await invitedUser(email);

      await expect(
        service.acceptInvite(rawToken, OVER_REACH)
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "newPassword",
              message: expect.stringContaining("72-byte"),
            }),
          ],
        },
      });

      expect(await storedHash(email)).toBeNull();
      const row = await testDb.db.query.userInviteTokens.findFirst({});
      expect(row?.usedAt ?? null).toBeNull();
    });
  });

  describe("a password an administrator sets", () => {
    // The write itself is the gate under test: `createLocalUser` and
    // `updateUser` judge the password through their schemas before they hash,
    // and a refusal leaves the state it found unchanged. The boundary the
    // schemas accept (class-less, exactly at reach) is pinned separately,
    // since the success legs need the transaction/RBAC lanes the other
    // suites cover.
    const createInput = {
      email: "admin-set@test.com",
      name: "Admin Set",
    };

    it("accepts a class-less password at the schema both writes judge through", () => {
      expect(
        CreateLocalUserSchema.safeParse({ ...createInput, password: CLASSLESS })
          .success
      ).toBe(true);
      expect(UpdateUserSchema.safeParse({ password: CLASSLESS }).success).toBe(
        true
      );

      // 70 ASCII bytes plus one two-byte character: exactly the 72 bytes the
      // default digester reads whole.
      expect(
        CreateLocalUserSchema.safeParse({
          ...createInput,
          password: "b".repeat(70) + "é",
        }).success
      ).toBe(true);
    });

    it("refuses a create with a password on the common list, leaving no account at the address", async () => {
      const service = new UserMutationService(testDb.adapter, testLogger);

      const err = await service
        .createLocalUser({ ...createInput, password: COMMON })
        .catch((e: unknown) => e);

      expect((err as { code?: string }).code).toBe("VALIDATION_ERROR");
      expect(validationErrors(err)).toEqual([
        expect.objectContaining({
          path: "password",
          message: expect.stringContaining("too common"),
        }),
      ]);

      const user = await testDb.db.query.users.findFirst({
        where: { email: createInput.email },
      });
      expect(user).toBeUndefined();
    });

    it("refuses a create with a password past the digester's reach, leaving no account", async () => {
      const service = new UserMutationService(testDb.adapter, testLogger);

      const err = await service
        .createLocalUser({ ...createInput, password: OVER_REACH })
        .catch((e: unknown) => e);

      expect((err as { code?: string }).code).toBe("VALIDATION_ERROR");
      expect(validationErrors(err)).toEqual([
        expect.objectContaining({
          path: "password",
          message: expect.stringContaining("72-byte"),
        }),
      ]);

      const user = await testDb.db.query.users.findFirst({
        where: { email: createInput.email },
      });
      expect(user).toBeUndefined();
    });

    it("refuses an update to a password on the common list, the stored credential standing", async () => {
      const email = "admin-update@test.com";
      const currentHash = await hashPassword(CURRENT, FIXTURE_SALT_ROUNDS);
      const user = userFactory({ email, passwordHash: currentHash });
      await testDb.db.insert(testDb.schema.users).values(user);

      const service = new UserMutationService(testDb.adapter, testLogger);
      const err = await service
        .updateUser(user.id, { password: COMMON })
        .catch((e: unknown) => e);

      expect((err as { code?: string }).code).toBe("VALIDATION_ERROR");
      expect(validationErrors(err)).toEqual([
        expect.objectContaining({
          path: "password",
          message: expect.stringContaining("too common"),
        }),
      ]);

      expect(await storedHash(email)).toBe(currentHash);
    });

    it("refuses an update to a password past the digester's reach, the stored credential standing", async () => {
      const email = "admin-update-reach@test.com";
      const currentHash = await hashPassword(CURRENT, FIXTURE_SALT_ROUNDS);
      const user = userFactory({ email, passwordHash: currentHash });
      await testDb.db.insert(testDb.schema.users).values(user);

      const service = new UserMutationService(testDb.adapter, testLogger);
      const err = await service
        .updateUser(user.id, { password: OVER_REACH })
        .catch((e: unknown) => e);

      expect((err as { code?: string }).code).toBe("VALIDATION_ERROR");
      expect(validationErrors(err)).toEqual([
        expect.objectContaining({
          path: "password",
          message: expect.stringContaining("72-byte"),
        }),
      ]);

      expect(await storedHash(email)).toBe(currentHash);
    });
  });
});
