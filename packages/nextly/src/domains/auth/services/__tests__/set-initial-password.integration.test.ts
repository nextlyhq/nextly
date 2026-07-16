/**
 * Forced first-sign-in password change, end to end against a real database.
 *
 * When an admin creates an account with a password they chose, the account is
 * flagged must-change (ASVS 6.4.1). `setInitialPassword` replaces that password
 * and clears the flag in one conditional write, so it works exactly once and
 * only for an account that is actually in the must-change state; a self-set
 * password is never flagged.
 */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors";
import { users } from "../../../../schemas/users/sqlite";
import { ServiceContainer } from "../../../../services/index";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { AuthService } from "../auth-service";

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

const STRONG = "Str0ng!Passw0rd";
const STRONG_2 = "An0ther!Passw0rd";

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

async function readUser(db: TestDb, email: string) {
  const rows = await db.select().from(users).where(eq(users.email, email));
  return rows[0];
}

describe("must-change-password / setInitialPassword", () => {
  it("flags an admin-set password and setInitialPassword clears it, changing the hash", async () => {
    const { container, auth, db } = await setup();

    const created = await container.users.createLocalUser({
      email: "flagged@example.com",
      name: "Flagged",
      password: STRONG,
      mustChangePassword: true,
    });

    const before = await readUser(db, "flagged@example.com");
    expect(before.mustChangePassword).toBeTruthy();
    const originalHash = before.passwordHash;

    await auth.setInitialPassword(created.id, STRONG_2);

    const after = await readUser(db, "flagged@example.com");
    expect(after.mustChangePassword).toBeFalsy();
    // The password was actually replaced.
    expect(after.passwordHash).not.toBe(originalHash);
  });

  it("works exactly once — a second call rejects and leaves the account unchanged", async () => {
    const { container, auth, db } = await setup();

    const created = await container.users.createLocalUser({
      email: "once@example.com",
      name: "Once",
      password: STRONG,
      mustChangePassword: true,
    });
    await auth.setInitialPassword(created.id, STRONG_2);
    const afterFirst = await readUser(db, "once@example.com");

    // The flag is cleared, so a replay is no longer in the must-change state.
    await expect(auth.setInitialPassword(created.id, STRONG)).rejects.toSatisfy(
      (err: unknown) => NextlyError.is(err) && err.code === "INVALID_INPUT"
    );

    const afterSecond = await readUser(db, "once@example.com");
    expect(afterSecond.passwordHash).toBe(afterFirst.passwordHash);
  });

  it("rejects a weak password with a validation error, without changing anything", async () => {
    const { container, auth, db } = await setup();

    const created = await container.users.createLocalUser({
      email: "weak@example.com",
      name: "Weak",
      password: STRONG,
      mustChangePassword: true,
    });
    const before = await readUser(db, "weak@example.com");

    await expect(auth.setInitialPassword(created.id, "weak")).rejects.toSatisfy(
      (err: unknown) => NextlyError.is(err) && err.code === "VALIDATION_ERROR"
    );

    const after = await readUser(db, "weak@example.com");
    expect(after.mustChangePassword).toBeTruthy();
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it("does not flag a self-set password (no mustChangePassword input)", async () => {
    const { container, db } = await setup();

    await container.users.createLocalUser({
      email: "selfset@example.com",
      name: "Self Set",
      password: STRONG,
    });

    const row = await readUser(db, "selfset@example.com");
    expect(row.mustChangePassword).toBeFalsy();
  });
});
