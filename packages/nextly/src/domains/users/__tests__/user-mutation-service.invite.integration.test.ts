/**
 * Creating a user in invite mode, end to end against a real database.
 *
 * The design: omitting a password creates the account without a credential and
 * mints a single-use set-password link in the SAME transaction as the user, so
 * the admin is never handed a user with no way in. This test proves that the
 * link and its hashed token row are written atomically, that a stored bad state
 * (a password) takes the other branch, and that the token minted here is the
 * one `AuthService.acceptInvite` consumes — the shared-hash invariant that lets
 * the two flows interoperate.
 */
import { createHash } from "crypto";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import { ServiceContainer } from "../../../services/index";
import { userInviteTokens } from "../../../schemas/auth-tokens/sqlite";
import { users } from "../../../schemas/users/sqlite";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { AuthService } from "../../auth/services/auth-service";

/** Minimal slice of the Drizzle instance these tests drive. */
interface TestDb {
  select: () => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<Record<string, unknown>[]>;
    } & Promise<Record<string, unknown>[]>;
  };
}

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function setup(): Promise<{
  container: ServiceContainer;
  auth: AuthService;
  db: TestDb;
}> {
  current = await createTestNextly();
  const container = new ServiceContainer(current.adapter);
  const auth = current.getService("authService") as unknown as AuthService;
  const db = current.adapter.getDrizzle() as unknown as TestDb;
  return { container, auth, db };
}

/** Pull the raw token out of an accept-invite link. */
function tokenFromLink(link: string): string {
  const token = new URL(link).searchParams.get("token");
  if (!token) throw new Error(`no token in link: ${link}`);
  return token;
}

describe("createLocalUser — invite mode", () => {
  it("mints a set-password link and its hashed token row when no password is given", async () => {
    const { container, db } = await setup();

    const created = await container.users.createLocalUser({
      email: "invitee@example.com",
      name: "Invitee",
    });

    // The link is the artifact the admin gets back.
    expect(created.invite).toBeDefined();
    expect(created.invite!.link).toContain("/admin/accept-invite?token=");

    // The link lasts seven days — assert the actual TTL, not just "in future",
    // so a wrong expiry window is caught. Wide tolerance absorbs CI slowness.
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const TOLERANCE_MS = 5 * 60 * 1000;
    const expectedExpiry = Date.now() + SEVEN_DAYS_MS;
    expect(created.invite!.expiresAt.getTime()).toBeGreaterThan(
      expectedExpiry - TOLERANCE_MS
    );
    expect(created.invite!.expiresAt.getTime()).toBeLessThanOrEqual(
      expectedExpiry + TOLERANCE_MS
    );

    // The account has no credential and an unproven address until acceptance.
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.email, "invitee@example.com"));
    expect(userRows).toHaveLength(1);
    expect(userRows[0].passwordHash).toBeNull();
    expect(userRows[0].emailVerified).toBeNull();

    // Exactly one invite row, storing the hash of the returned token — never
    // the raw value. This is the hash `acceptInvite` looks up.
    const token = tokenFromLink(created.invite!.link);
    const expectedHash = createHash("sha256").update(token).digest("hex");
    const tokenRows = await db.select().from(userInviteTokens);
    expect(tokenRows).toHaveLength(1);
    expect(tokenRows[0].tokenHash).toBe(expectedHash);
    // The persisted expiry is the same seven-day instant handed to the admin,
    // within the database's second-level timestamp precision.
    const persistedExpiry = new Date(
      tokenRows[0].expires as string | number
    ).getTime();
    expect(
      Math.abs(persistedExpiry - created.invite!.expiresAt.getTime())
    ).toBeLessThan(1000);
  });

  it("sets the password directly and mints no invite when a password is given", async () => {
    const { container, db } = await setup();

    const created = await container.users.createLocalUser({
      email: "direct@example.com",
      name: "Direct",
      password: "Str0ng!Passw0rd",
    });

    expect(created.invite).toBeUndefined();

    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.email, "direct@example.com"));
    expect(userRows[0].passwordHash).not.toBeNull();
    // An admin-set password vouches for the account: verified at creation.
    expect(userRows[0].emailVerified).not.toBeNull();

    const tokenRows = await db.select().from(userInviteTokens);
    expect(tokenRows).toHaveLength(0);
  });

  it("mints a token that AuthService.acceptInvite accepts, activating the account", async () => {
    const { container, auth, db } = await setup();

    const created = await container.users.createLocalUser({
      email: "handoff@example.com",
      name: "Handoff",
    });
    const token = tokenFromLink(created.invite!.link);

    // The person redeems the link: accept sets the password, proves the
    // address and activates the account in one step.
    await auth.acceptInvite(token, "Str0ng!Passw0rd");

    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.email, "handoff@example.com"));
    expect(userRows[0].passwordHash).not.toBeNull();
    expect(userRows[0].emailVerified).not.toBeNull();
    expect(userRows[0].isActive).toBeTruthy();
    const passwordHashAfterFirstUse = userRows[0].passwordHash;

    // The link is single-use: reusing it fails with the generic INVALID_INVITE
    // error (the same one an unknown or expired token returns, so a guessed
    // token learns nothing).
    await expect(
      auth.acceptInvite(token, "An0ther!Passw0rd")
    ).rejects.toSatisfy(
      (err: unknown) =>
        NextlyError.is(err) &&
        err.code === "VALIDATION_ERROR" &&
        Array.isArray(err.publicData?.errors) &&
        err.publicData.errors.some(
          (e: { code?: string }) => e.code === "INVALID_INVITE"
        )
    );

    // The rejected reuse changed nothing: the password is still the one set on
    // the first, successful acceptance — not the second attempt's.
    const afterReuse = await db
      .select()
      .from(users)
      .where(eq(users.email, "handoff@example.com"));
    expect(afterReuse[0].passwordHash).toBe(passwordHashAfterFirstUse);
  });
});
