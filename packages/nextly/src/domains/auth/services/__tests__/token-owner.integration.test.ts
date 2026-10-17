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

/**
 * The limiter asks a lookup which account a token belongs to; the handler
 * then consumes the token. The two must agree on which STORED tokens are
 * live: a lookup that named an owner for a token the consume refuses as
 * unknown, used or expired would charge an account for nothing, and one that
 * named nobody for a token the consume accepts would count a real completion
 * against the shared account-less budget. For every kind and every stored
 * state, the lookup names an owner exactly when the consume succeeds.
 *
 * Deliberately not covered: a live token whose ACCOUNT the consume then
 * refuses (deactivated, say). The lookup still names that account, which is
 * the limiter's intent: the request counts against the account it targets,
 * whatever the consume decides about the account afterwards.
 */
describe("the owner lookup and the consume agree on which stored tokens are live", () => {
  type Kind = {
    name: string;
    account: { emailVerified: Date | null; isActive: boolean };
    mint: (auth: AuthService) => Promise<string>;
    owner: (auth: AuthService, token: string) => Promise<string | null>;
    consume: (auth: AuthService, token: string) => Promise<unknown>;
    expire: (db: TestDb) => Promise<unknown>;
  };
  const kinds: Kind[] = [
    {
      name: "reset",
      account: { emailVerified: new Date(), isActive: true },
      mint: async auth =>
        minted(
          await auth.generatePasswordResetToken(EMAIL, { disableEmail: true })
        ),
      owner: (auth, token) => auth.resetTokenOwner(token),
      consume: (auth, token) => auth.resetPasswordWithToken(token, STRONG),
      expire: db =>
        db
          .update(passwordResetTokens)
          .set({ expires: PAST })
          .where(eq(passwordResetTokens.identifier, EMAIL)),
    },
    {
      name: "verification",
      account: { emailVerified: null, isActive: true },
      mint: async auth =>
        minted(
          await auth.generateEmailVerificationToken(EMAIL, {
            disableEmail: true,
          })
        ),
      owner: (auth, token) => auth.verificationTokenOwner(token),
      consume: (auth, token) => auth.verifyEmail(token),
      expire: db =>
        db
          .update(emailVerificationTokens)
          .set({ expires: PAST })
          .where(eq(emailVerificationTokens.identifier, EMAIL)),
    },
    {
      name: "invite",
      account: { emailVerified: null, isActive: false },
      mint: async auth => (await auth.generateInviteToken(USER_ID)).token,
      owner: (auth, token) => auth.inviteTokenOwner(token),
      consume: (auth, token) => auth.acceptInvite(token, STRONG),
      expire: db =>
        db
          .update(userInviteTokens)
          .set({ expires: PAST })
          .where(eq(userInviteTokens.userId, USER_ID)),
    },
  ];
  const states = ["live", "used", "expired", "unknown"] as const;

  for (const kind of kinds) {
    for (const state of states) {
      it(`${kind.name} token, ${state}`, async () => {
        const { auth, db } = await setup(kind.account);
        let token = "f".repeat(64);
        if (state !== "unknown") token = await kind.mint(auth);
        if (state === "used") await kind.consume(auth, token);
        if (state === "expired") await kind.expire(db);

        const owner = await kind.owner(auth, token);
        const consumed = await kind.consume(auth, token).then(
          () => true,
          () => false
        );

        expect(owner !== null).toBe(consumed);
        expect(consumed).toBe(state === "live");
      });
    }
  }
});
