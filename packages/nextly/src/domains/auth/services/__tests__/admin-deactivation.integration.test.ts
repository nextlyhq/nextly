/**
 * An administrator's deactivation outlasts the account's own links.
 *
 * `is_active` is false both for an account an administrator switched off and
 * for one still waiting on its verification link, so the link alone could not
 * tell them apart and switched either on. `deactivated_at` records the
 * administrator's decision, and these tests hold every path that activates an
 * account to it.
 */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
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
  await current?.destroy();
  current = undefined;
});

const EMAIL = "pending@example.com";
const USER_ID = "pending-user-1";

/** A self-registered account still waiting on its verification link. */
async function setup(): Promise<{
  t: TestNextly;
  auth: AuthService;
  db: TestDb;
}> {
  current = await createTestNextly();
  const auth = current.getService("authService") as unknown as AuthService;
  const db = current.adapter.getDrizzle() as unknown as TestDb;
  await db.insert(users).values({
    id: USER_ID,
    email: EMAIL,
    name: "Pending",
    passwordHash: null,
    emailVerified: null,
    isActive: false,
  });
  return { t: current, auth, db };
}

async function row(db: TestDb): Promise<Record<string, unknown>> {
  const [user] = await db.select().from(users).where(eq(users.id, USER_ID));
  return user;
}

async function setActive(t: TestNextly, isActive: boolean): Promise<void> {
  await t.nextly.users.update({ id: USER_ID, data: { isActive } });
}

describe("a verification link", () => {
  it("activates an account waiting on it", async () => {
    // The control: the rule below must not stop an ordinary sign-up.
    const { auth, db } = await setup();
    const { token } = await auth.generateEmailVerificationToken(EMAIL, {
      disableEmail: true,
    });
    await auth.verifyEmail(token as string);

    expect((await row(db)).isActive).toBe(true);
  });

  it("verifies but does not activate an account an administrator deactivated", async () => {
    // The link was sent before the deactivation, so it is still valid.
    const { t, auth, db } = await setup();
    const { token } = await auth.generateEmailVerificationToken(EMAIL, {
      disableEmail: true,
    });
    await setActive(t, false);

    await auth.verifyEmail(token as string);

    const user = await row(db);
    expect(user.emailVerified).toBeTruthy();
    expect(user.isActive).toBe(false);
  });

  it("is not sent to an account an administrator deactivated", async () => {
    const { t, auth } = await setup();
    await setActive(t, false);

    const { token } = await auth.generateEmailVerificationToken(EMAIL, {
      disableEmail: true,
    });

    expect(token).toBeUndefined();
  });
});

describe("an administrator's update", () => {
  it("records a deactivation even when the account was already inactive", async () => {
    // A pending sign-up is already inactive; deactivating it is exactly
    // what must stop its link from switching it on.
    const { t, db } = await setup();
    await setActive(t, false);

    expect((await row(db)).deactivatedAt).toBeTruthy();
  });

  it("clears the record when the account is activated again", async () => {
    const { t, db } = await setup();
    await setActive(t, false);
    await setActive(t, true);

    const user = await row(db);
    expect(user.deactivatedAt).toBeNull();
    expect(user.isActive).toBe(true);
  });

  it("leaves both alone when the update does not name isActive", async () => {
    // The Direct API passes `isActive: undefined` when the caller left it
    // out; reading that as false would deactivate every account it updates.
    const { t, db } = await setup();
    await t.nextly.users.update({ id: USER_ID, data: { name: "Renamed" } });

    const user = await row(db);
    expect(user.deactivatedAt).toBeNull();
    expect(user.name).toBe("Renamed");
  });
});

describe("a password-reset link", () => {
  it("sets a password for an active account", async () => {
    // The control: the rule below must not stop an ordinary reset.
    const { t, auth, db } = await setup();
    await setActive(t, true);
    const { token } = await auth.generatePasswordResetToken(EMAIL, {
      disableEmail: true,
    });

    await auth.resetPasswordWithToken(token as string, "Str0ngPassw0rd!");

    const user = await row(db);
    expect(user.passwordHash).toBeTruthy();
    expect(user.mustChangePassword).toBe(false);
  });

  it("does not set a password for an account an administrator deactivated", async () => {
    // The link was minted before the deactivation, so it is still valid.
    // The refusal lands before the password write, so the admin-set
    // must-change flag a reset would clear is left alone too.
    const { t, auth, db } = await setup();
    await setActive(t, true);
    const { token } = await auth.generatePasswordResetToken(EMAIL, {
      disableEmail: true,
    });
    await setActive(t, false);

    await expect(
      auth.resetPasswordWithToken(token as string, "Str0ngPassw0rd!")
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const user = await row(db);
    expect(user.passwordHash).toBeNull();
  });
});
