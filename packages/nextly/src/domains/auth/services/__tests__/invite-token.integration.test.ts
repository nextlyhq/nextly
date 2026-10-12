/**
 * Invite tokens, end to end against a real database.
 *
 * The link is the artifact: minting one for an account, and accepting it,
 * should set the password, prove the address and let the account sign in — in
 * one step, with nothing left half-done on any failure path.
 */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import {
  refreshTokens,
  userInviteTokens,
} from "../../../../schemas/auth-tokens/sqlite";
import { users } from "../../../../schemas/users/sqlite";
import type { AuthService } from "../auth-service";

/** Minimal slice of the Drizzle instance these tests drive. */
interface TestDb {
  insert: (table: unknown) => { values: (data: unknown) => Promise<unknown> };
  select: () => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<Record<string, unknown>[]>;
    } & Promise<Record<string, unknown>[]>;
  };
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

async function setup(): Promise<{
  auth: AuthService;
  db: TestDb;
  userId: string;
}> {
  current = await createTestNextly();
  const auth = current.getService("authService") as unknown as AuthService;
  const db = current.adapter.getDrizzle() as unknown as TestDb;

  const userId = "invited-user-1";
  await db.insert(users).values({
    id: userId,
    email: "new.person@example.com",
    name: "New Person",
    passwordHash: null,
    emailVerified: null,
    isActive: false,
  });

  return { auth, db, userId };
}

describe("generateInviteToken", () => {
  it("mints a 256-bit link for an existing account, expiring in the future", async () => {
    const { auth, userId } = await setup();
    const { token, expiresAt } = await auth.generateInviteToken(userId);

    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("refuses to mint for an account that does not exist", async () => {
    const { auth } = await setup();
    await expect(auth.generateInviteToken("nobody")).rejects.toBeInstanceOf(
      NextlyError
    );
  });

  it("stores only the hash, never the raw token", async () => {
    const { auth, db, userId } = await setup();
    const { token } = await auth.generateInviteToken(userId);

    const rows = await db.select().from(userInviteTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(token);
    expect(String(rows[0].tokenHash)).toHaveLength(64);
  });

  it("keeps only one active invite per account", async () => {
    const { auth, db, userId } = await setup();
    await auth.generateInviteToken(userId);
    await auth.generateInviteToken(userId);

    const rows = await db.select().from(userInviteTokens);
    expect(rows).toHaveLength(1);
  });
});

describe("acceptInvite", () => {
  it("sets the password, verifies the email, activates, and consumes the token", async () => {
    const { auth, db, userId } = await setup();
    const { token } = await auth.generateInviteToken(userId);

    const result = await auth.acceptInvite(token, STRONG);
    expect(result.userId).toBe(userId);

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user.passwordHash).toBeTruthy();
    expect(user.emailVerified).toBeTruthy();
    expect(user.isActive).toBe(true);

    const [invite] = await db.select().from(userInviteTokens);
    expect(invite.usedAt).toBeTruthy();
  });

  it("ends every session the account already holds", async () => {
    // A password write like any other: a session issued before the invite
    // was accepted must not keep renewing under the password it replaced.
    const { auth, db, userId } = await setup();
    await db.insert(refreshTokens).values({
      id: "rt-before-invite",
      userId,
      tokenHash: "hash-before-invite",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const { token } = await auth.generateInviteToken(userId);

    await auth.acceptInvite(token, STRONG);

    expect(
      await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.userId, userId))
    ).toEqual([]);
  });

  it("refuses an account an administrator deactivated, and changes nothing", async () => {
    // An invite must not set credentials on, or switch back on, an account
    // an administrator turned off after the link was sent.
    const { auth, db, userId } = await setup();
    const { token } = await auth.generateInviteToken(userId);
    await db
      .update(users)
      .set({ deactivatedAt: new Date() })
      .where(eq(users.id, userId));

    await expect(auth.acceptInvite(token, STRONG)).rejects.toBeInstanceOf(
      NextlyError
    );

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user.passwordHash).toBeNull();
    expect(user.isActive).toBe(false);
    // The claim rolled back with the refusal, so the token is not spent.
    const [invite] = await db.select().from(userInviteTokens);
    expect(invite.usedAt).toBeNull();
  });

  it("will not mint an invite for an account an administrator deactivated", async () => {
    // The link could never be accepted, so the administrator is told now
    // rather than the invitee meeting a dead link later.
    const { auth, db, userId } = await setup();
    await db
      .update(users)
      .set({ deactivatedAt: new Date() })
      .where(eq(users.id, userId));

    await expect(auth.generateInviteToken(userId)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await db.select().from(userInviteTokens)).toHaveLength(0);
  });

  it("refuses a token that was already used", async () => {
    const { auth, userId } = await setup();
    const { token } = await auth.generateInviteToken(userId);
    await auth.acceptInvite(token, STRONG);

    await expect(auth.acceptInvite(token, STRONG)).rejects.toBeInstanceOf(
      NextlyError
    );
  });

  it("refuses an unknown token", async () => {
    const { auth } = await setup();
    await expect(
      auth.acceptInvite("d".repeat(64), STRONG)
    ).rejects.toBeInstanceOf(NextlyError);
  });

  it("refuses an expired token", async () => {
    const { auth, db, userId } = await setup();
    const { token } = await auth.generateInviteToken(userId);

    await db
      .update(userInviteTokens)
      .set({ expires: new Date(Date.now() - 1000) })
      .where(eq(userInviteTokens.userId, userId));

    await expect(auth.acceptInvite(token, STRONG)).rejects.toBeInstanceOf(
      NextlyError
    );
  });

  it("lets only one of two concurrent acceptances win", async () => {
    // The race the atomic claim exists to stop: both calls read the token as
    // unused, and without the claim both would set a password — last writer
    // wins. Exactly one must succeed; the token is consumed once.
    const { auth, db, userId } = await setup();
    const { token } = await auth.generateInviteToken(userId);

    const results = await Promise.allSettled([
      auth.acceptInvite(token, STRONG),
      auth.acceptInvite(token, "D1fferent!Pass"),
    ]);

    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      NextlyError
    );

    const invites = await db.select().from(userInviteTokens);
    expect(invites).toHaveLength(1);
    expect(invites[0].usedAt).toBeTruthy();

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user.passwordHash).toBeTruthy();
    expect(user.isActive).toBe(true);
  });

  it("refuses a weak password and leaves both the token and the account untouched", async () => {
    const { auth, db, userId } = await setup();
    const { token } = await auth.generateInviteToken(userId);

    await expect(auth.acceptInvite(token, "weak")).rejects.toBeInstanceOf(
      NextlyError
    );

    const [invite] = await db.select().from(userInviteTokens);
    expect(invite.usedAt).toBeNull();

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user.passwordHash).toBeNull();
    expect(user.isActive).toBe(false);
  });
});
