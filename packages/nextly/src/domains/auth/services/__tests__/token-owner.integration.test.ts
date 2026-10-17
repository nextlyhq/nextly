/**
 * The token-owner lookups the auth limiter asks, against a real database.
 *
 * Each names the account a live token belongs to, and nothing for a token
 * that is unknown, used or expired. Each must also leave its token usable:
 * the limiter asks before the handler consumes, so a lookup that spent or
 * altered the token would break every reset, verification and invite.
 */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import {
  emailVerificationTokens,
  passwordResetTokens,
  userInviteTokens,
} from "../../../../schemas/auth-tokens/sqlite";
import { users } from "../../../../schemas/users/sqlite";
import type { AuthService } from "../auth-service";

/** Minimal slice of the Drizzle instance these tests drive. */
interface TestDb {
  insert: (table: unknown) => { values: (data: unknown) => Promise<unknown> };
  update: (table: unknown) => {
    set: (data: unknown) => { where: (cond: unknown) => Promise<unknown> };
  };
}

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const STRONG = "Str0ng!Passw0rd";
const EMAIL = "owner@example.com";
const USER_ID = "token-owner-1";
const PAST = new Date(Date.now() - 60_000);

async function setup(account: {
  emailVerified: Date | null;
  isActive: boolean;
}): Promise<{ auth: AuthService; db: TestDb }> {
  current = await createTestNextly();
  const auth = current.getService("authService") as unknown as AuthService;
  const db = current.adapter.getDrizzle() as unknown as TestDb;
  await db.insert(users).values({
    id: USER_ID,
    email: EMAIL,
    name: "Owner",
    passwordHash: null,
    ...account,
  });
  return { auth, db };
}

/** A minted token, failing the test when the service mints none. */
function minted(result: { token?: string }): string {
  if (!result.token) throw new Error("expected a token to be minted");
  return result.token;
}

describe("resetTokenOwner", () => {
  const account = { emailVerified: new Date(), isActive: true };

  it("names the token's address and leaves the token usable", async () => {
    const { auth } = await setup(account);
    const token = minted(
      await auth.generatePasswordResetToken(EMAIL, { disableEmail: true })
    );

    expect(await auth.resetTokenOwner(token)).toBe(EMAIL);
    await expect(auth.resetPasswordWithToken(token, STRONG)).resolves.toEqual(
      expect.objectContaining({ email: EMAIL })
    );
  });

  it("names nobody for an unknown, a used or an expired token", async () => {
    const { auth, db } = await setup(account);
    expect(await auth.resetTokenOwner("f".repeat(64))).toBeNull();

    const used = minted(
      await auth.generatePasswordResetToken(EMAIL, { disableEmail: true })
    );
    await auth.resetPasswordWithToken(used, STRONG);
    expect(await auth.resetTokenOwner(used)).toBeNull();

    const expired = minted(
      await auth.generatePasswordResetToken(EMAIL, { disableEmail: true })
    );
    await db
      .update(passwordResetTokens)
      .set({ expires: PAST })
      .where(eq(passwordResetTokens.identifier, EMAIL));
    expect(await auth.resetTokenOwner(expired)).toBeNull();
  });
});

describe("verificationTokenOwner", () => {
  const account = { emailVerified: null, isActive: true };

  it("names the token's address and leaves the token usable", async () => {
    const { auth } = await setup(account);
    const token = minted(
      await auth.generateEmailVerificationToken(EMAIL, { disableEmail: true })
    );

    expect(await auth.verificationTokenOwner(token)).toBe(EMAIL);
    await expect(auth.verifyEmail(token)).resolves.toEqual({ email: EMAIL });
  });

  it("names nobody for an unknown or an expired token", async () => {
    const { auth, db } = await setup(account);
    expect(await auth.verificationTokenOwner("f".repeat(64))).toBeNull();

    const expired = minted(
      await auth.generateEmailVerificationToken(EMAIL, { disableEmail: true })
    );
    await db
      .update(emailVerificationTokens)
      .set({ expires: PAST })
      .where(eq(emailVerificationTokens.identifier, EMAIL));
    expect(await auth.verificationTokenOwner(expired)).toBeNull();
  });
});

describe("inviteTokenOwner", () => {
  const account = { emailVerified: null, isActive: false };

  it("names the invited account's address and leaves the token usable", async () => {
    const { auth } = await setup(account);
    const { token } = await auth.generateInviteToken(USER_ID);

    expect(await auth.inviteTokenOwner(token)).toBe(EMAIL);
    await expect(auth.acceptInvite(token, STRONG)).resolves.toEqual(
      expect.objectContaining({ userId: USER_ID })
    );
  });

  it("names nobody for an unknown, a used or an expired invite", async () => {
    const { auth, db } = await setup(account);
    expect(await auth.inviteTokenOwner("f".repeat(64))).toBeNull();

    const { token: used } = await auth.generateInviteToken(USER_ID);
    await auth.acceptInvite(used, STRONG);
    expect(await auth.inviteTokenOwner(used)).toBeNull();

    // A fresh account, since accepting activated the first one.
    await db.insert(users).values({
      id: "token-owner-2",
      email: "second@example.com",
      name: "Second",
      passwordHash: null,
      emailVerified: null,
      isActive: false,
    });
    const { token: expired } = await auth.generateInviteToken("token-owner-2");
    await db
      .update(userInviteTokens)
      .set({ expires: PAST })
      .where(eq(userInviteTokens.userId, "token-owner-2"));
    expect(await auth.inviteTokenOwner(expired)).toBeNull();
  });
});
