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
import { userInviteTokens } from "../../../../schemas/auth-tokens/sqlite";
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
