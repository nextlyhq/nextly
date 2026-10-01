/**
 * A deactivation that lands WHILE a password is being hashed.
 *
 * Both writes that set a password from a link — the reset and the forced
 * first-sign-in change — read the account first and refuse a deactivated one.
 * That read cannot see a deactivation made after it, and hashing takes long
 * enough for one to arrive. So each write is also conditional on
 * `deactivated_at IS NULL` in the same statement, and these cases make the
 * hash itself deactivate the account: the read has already passed, and only
 * the conditional write stands between the link and a password planted for a
 * later reactivation to switch on.
 */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Run once, inside the next hash, then cleared. */
const duringHash = vi.hoisted(() => ({
  run: undefined as (() => Promise<void>) | undefined,
}));

vi.mock("../../../../auth/password", async importOriginal => {
  const real =
    await importOriginal<typeof import("../../../../auth/password")>();
  return {
    ...real,
    hashPassword: async (password: string) => {
      const hash = await real.hashPassword(password);
      const hook = duringHash.run;
      duringHash.run = undefined;
      await hook?.();
      return hash;
    },
  };
});

import { hashPassword } from "../../../../auth/password";

import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { refreshTokens } from "../../../../schemas/auth-tokens/sqlite";
import { users } from "../../../../schemas/users/sqlite";
import type { AuthService } from "../auth-service";

/** Minimal slice of the Drizzle instance these tests drive. */
interface TestDb {
  insert: (table: unknown) => { values: (data: unknown) => Promise<unknown> };
  select: () => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<Record<string, unknown>[]>;
    };
  };
}

let current: TestNextly | undefined;

afterEach(async () => {
  duringHash.run = undefined;
  await current?.destroy();
  current = undefined;
});

const EMAIL = "race@example.com";
const USER_ID = "race-user-1";

async function setup(account: {
  passwordHash: string | null;
  mustChangePassword: boolean;
}): Promise<{ t: TestNextly; auth: AuthService; db: TestDb }> {
  current = await createTestNextly();
  const auth = current.getService("authService") as unknown as AuthService;
  const db = current.adapter.getDrizzle() as unknown as TestDb;
  await db.insert(users).values({
    id: USER_ID,
    email: EMAIL,
    name: "Race",
    emailVerified: new Date(),
    isActive: true,
    ...account,
  });
  return { t: current, auth, db };
}

async function row(db: TestDb): Promise<Record<string, unknown>> {
  const [user] = await db.select().from(users).where(eq(users.id, USER_ID));
  return user;
}

/** Deactivate the account the way an administrator does. */
function deactivateDuringHash(t: TestNextly): void {
  duringHash.run = async () => {
    await t.nextly.users.update({ id: USER_ID, data: { isActive: false } });
  };
}

describe("a password-reset link racing a deactivation", () => {
  it("sets no password when the account is deactivated mid-hash", async () => {
    const { t, auth, db } = await setup({
      passwordHash: null,
      mustChangePassword: true,
    });
    const { token } = await auth.generatePasswordResetToken(EMAIL, {
      disableEmail: true,
    });
    deactivateDuringHash(t);

    await expect(
      auth.resetPasswordWithToken(token as string, "Str0ngPassw0rd!")
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const user = await row(db);
    // The deactivation happened after the read: the refusal came from the
    // conditional write, which is what this case exists to show.
    expect(user.deactivatedAt).toBeTruthy();
    expect(user.passwordHash).toBeNull();
    expect(user.mustChangePassword).toBe(true);
  });
});

describe("the sessions of an account an administrator changes", () => {
  /** Give the account one live refresh row, as a signed-in browser has. */
  async function signIn(db: TestDb): Promise<void> {
    await db.insert(refreshTokens).values({
      id: `rt-${String(Math.random()).slice(2)}`,
      userId: USER_ID,
      tokenHash: "hash",
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    });
  }

  async function sessionCount(db: TestDb): Promise<number> {
    return (
      await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.userId, USER_ID))
    ).length;
  }

  it("end when the account is deactivated, and stay ended when it is reactivated", async () => {
    // Only the row a refused refresh presented was deleted, so every other
    // browser's session came back with the reactivation.
    const { t, db } = await setup({
      passwordHash: null,
      mustChangePassword: false,
    });
    await signIn(db);
    await signIn(db);

    await t.nextly.users.update({ id: USER_ID, data: { isActive: false } });
    expect(await sessionCount(db)).toBe(0);

    await t.nextly.users.update({ id: USER_ID, data: { isActive: true } });
    expect(await sessionCount(db)).toBe(0);
  });

  it("end when an administrator sets a new password", async () => {
    const { t, db } = await setup({
      passwordHash: null,
      mustChangePassword: false,
    });
    await signIn(db);

    await t.nextly.users.update({
      id: USER_ID,
      data: { password: "Str0ngPassw0rd!" },
    });

    expect(await sessionCount(db)).toBe(0);
  });

  it("survive an update that changes neither", async () => {
    // The control: ending sessions on every update would satisfy both cases
    // above and sign every edited account out.
    const { t, db } = await setup({
      passwordHash: null,
      mustChangePassword: false,
    });
    await signIn(db);

    await t.nextly.users.update({ id: USER_ID, data: { name: "Renamed" } });

    expect(await sessionCount(db)).toBe(1);
  });
});

describe("a signed-in password change on a deactivated account", () => {
  const CURRENT = "Curr3nt!Password";

  it("is refused once the account is deactivated", async () => {
    // A live access token or a Direct API token outlasts the deactivation.
    const { t, auth, db } = await setup({
      passwordHash: await hashPassword(CURRENT),
      mustChangePassword: false,
    });
    const before = (await row(db)).passwordHash;
    await t.nextly.users.update({ id: USER_ID, data: { isActive: false } });

    await expect(
      auth.changePassword(USER_ID, CURRENT, "Str0ngPassw0rd!")
    ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    expect((await row(db)).passwordHash).toBe(before);
  });

  it("is refused when the deactivation lands mid-hash", async () => {
    const { t, auth, db } = await setup({
      passwordHash: await hashPassword(CURRENT),
      mustChangePassword: false,
    });
    const before = (await row(db)).passwordHash;
    deactivateDuringHash(t);

    await expect(
      auth.changePassword(USER_ID, CURRENT, "Str0ngPassw0rd!")
    ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    expect((await row(db)).passwordHash).toBe(before);
  });

  it("still changes the password of an active account", async () => {
    const { auth, db } = await setup({
      passwordHash: await hashPassword(CURRENT),
      mustChangePassword: false,
    });
    const before = (await row(db)).passwordHash;

    await auth.changePassword(USER_ID, CURRENT, "Str0ngPassw0rd!");

    expect((await row(db)).passwordHash).not.toBe(before);
  });
});

describe("a forced first-sign-in change racing a deactivation", () => {
  it("keeps the temporary password when the account is deactivated mid-hash", async () => {
    const temporary = await hashPassword("Temp0rary!Pass");
    const { t, auth, db } = await setup({
      passwordHash: temporary,
      mustChangePassword: true,
    });
    deactivateDuringHash(t);

    await expect(
      auth.setInitialPassword(USER_ID, "Str0ngPassw0rd!")
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const user = await row(db);
    expect(user.deactivatedAt).toBeTruthy();
    expect(user.passwordHash).toBe(temporary);
    expect(user.mustChangePassword).toBe(true);
  });
});
