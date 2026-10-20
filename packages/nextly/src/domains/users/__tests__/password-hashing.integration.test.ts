/**
 * Every raw password is stored hashed, whatever it looks like.
 *
 * Account creation decided whether a password was already hashed from its
 * shape: one of 32 characters or more containing a colon was stored as given.
 * A long passphrase with a colon in it, typed at self-registration or by an
 * administrator, was kept in plain text. Each case below gives such a password
 * to one path that creates an account or sets a password, then reads back
 * what was stored and signs in with it.
 */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_DIGESTER_REACH_BYTES,
  hashPassword,
  isPasswordHash,
  verifyPassword,
} from "../../../auth/password/index";
import { getDialectTables } from "../../../database/index";
import { seedPermissions } from "../../../database/seeders/permissions";
import { seedSuperAdmin } from "../../../database/seeders/super-admin";
import { generateSqliteCoreTableStatements } from "../../../database/sqlite-core-tables";
import { dispatchUser } from "../../../dispatcher/handlers/user-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ServiceContainer } from "../../../services/index";
import type { UserService } from "../../../services/users/user-service";
import type { AuthService } from "../../auth/services/auth-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Forty characters with colons, and strong enough for every schema. */
const PASSPHRASE = "Correct-Horse:Battery-Staple:2026-Phrase";
const OTHER = "Str0ng-P@ssw0rd!";

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
  if (dialect === "sqlite") {
    // The SQLite runtime auto-sync does not create the core auth tables.
    for (const statement of generateSqliteCoreTableStatements()) {
      await current.adapter.executeQuery(statement);
    }
  }
  return current;
}

function services(t: TestNextly) {
  return new ServiceContainer(t.adapter);
}

function auth(t: TestNextly): AuthService {
  return t.getService("authService") as unknown as AuthService;
}

/** The stored password column, read back from the database. */
async function stored(t: TestNextly, email: string): Promise<unknown> {
  const db = t.adapter.getDrizzle() as unknown as {
    select: () => {
      from: (table: unknown) => {
        where: (cond: unknown) => Promise<Record<string, unknown>[]>;
      };
    };
  };
  const { users } = getDialectTables();
  const [row] = await db.select().from(users).where(eq(users.email, email));
  if (!row) throw new Error(`no account for ${email}`);
  return row.passwordHash;
}

/** Whether `password` signs in to the account. */
async function signsIn(
  t: TestNextly,
  email: string,
  password: string
): Promise<boolean> {
  try {
    await auth(t).verifyCredentials(email, password);
    return true;
  } catch {
    return false;
  }
}

/** Stored as a hash rather than as given, and the password still signs in. */
async function expectHashed(
  t: TestNextly,
  email: string,
  password: string
): Promise<void> {
  const value = await stored(t, email);
  expect(value).not.toBe(password);
  expect(isPasswordHash(value)).toBe(true);
  expect(await signsIn(t, email, password)).toBe(true);
}

/** An existing account, so the install is not empty; its id is returned. */
async function seedFounder(t: TestNextly): Promise<string> {
  const founder = await services(t).users.createLocalUser({
    email: "founder@example.com",
    name: "Founder",
    password: OTHER,
    isActive: true,
    emailVerification: "admin-vouched",
  });
  return String(founder.id);
}

describe.each(getConfiguredTestDialects())(
  "a raw password is stored hashed, whatever it looks like (%s)",
  (dialect: TestDialect) => {
    it("uses a passphrase the old shape test would have kept as given", () => {
      // The premise of every case below.
      expect(PASSPHRASE.length).toBe(40);
      expect(PASSPHRASE).toContain(":");
    });

    it("hashes it at self-registration", async () => {
      const t = await boot(dialect);
      await seedFounder(t);
      await auth(t).registerUser({
        email: "self@example.com",
        name: "Self",
        password: PASSPHRASE,
      });
      await expectHashed(t, "self@example.com", PASSPHRASE);
    });

    it("hashes it when core creates an account", async () => {
      const t = await boot(dialect);
      await seedFounder(t);
      await services(t).users.createLocalUser({
        email: "core@example.com",
        name: "Core",
        password: PASSPHRASE,
        isActive: true,
        emailVerification: "admin-vouched",
      });
      await expectHashed(t, "core@example.com", PASSPHRASE);
    });

    it("hashes it when the Direct API creates an account", async () => {
      const t = await boot(dialect);
      await seedFounder(t);
      await (t.getService("userService") as UserService).create(
        { email: "direct@example.com", name: "Direct", password: PASSPHRASE },
        {}
      );
      await expectHashed(t, "direct@example.com", PASSPHRASE);
    });

    it("hashes it when a plugin creates an account", async () => {
      // The view `ctx.services.users` hands a plugin, which writes as the
      // plugin caller: a path of its own through account creation.
      const t = await boot(dialect);
      await seedFounder(t);
      await (t.getService("userService") as UserService)
        .forPlugins()
        .create(
          { email: "plugin@example.com", name: "Plugin", password: PASSPHRASE },
          {}
        );
      await expectHashed(t, "plugin@example.com", PASSPHRASE);
    });

    it("hashes it when an administrator creates an account through the admin route", async () => {
      const t = await boot(dialect);
      const adminId = await seedFounder(t);
      await dispatchUser(
        services(t),
        "createLocalUser",
        { _authenticatedActorType: "user", _authenticatedActorId: adminId },
        { email: "routed@example.com", name: "Routed", password: PASSPHRASE }
      );
      await expectHashed(t, "routed@example.com", PASSPHRASE);
    });

    it("hashes it when setup seeds the first administrator", async () => {
      const t = await boot(dialect);
      await seedPermissions(t.adapter, { silent: true });
      const result = await seedSuperAdmin(t.adapter, {
        email: "owner@example.com",
        password: PASSPHRASE,
        name: "Owner",
        silent: true,
      });
      expect(result.success).toBe(true);
      await expectHashed(t, "owner@example.com", PASSPHRASE);
    });

    it("hashes a password shaped exactly like a hash", async () => {
      // A shape test that recognised bcrypt instead would keep this one as
      // given; whatever a password looks like, it is the password. The value
      // only needs a hash's shape, so it is made at bcrypt's lowest cost and
      // the case pays for one full-cost hash and two comparisons, not five.
      const t = await boot(dialect);
      const hashShaped = await hashPassword("something else entirely", 4);
      await services(t).users.createLocalUser({
        email: "shaped@example.com",
        name: "Shaped",
        password: hashShaped,
        isActive: true,
        emailVerification: "admin-vouched",
      });
      await expectHashed(t, "shaped@example.com", hashShaped);
      // The control: the value it was derived from is not the password.
      expect(
        await signsIn(t, "shaped@example.com", "something else entirely")
      ).toBe(false);
    });

    it("hashes it when an administrator sets a password", async () => {
      const t = await boot(dialect);
      const id = await seedFounder(t);
      await services(t).users.updateUser(id, { password: PASSPHRASE });
      await expectHashed(t, "founder@example.com", PASSPHRASE);
    });

    it("hashes it when an invite is accepted", async () => {
      const t = await boot(dialect);
      await seedFounder(t);
      const created = await services(t).users.createLocalUser({
        email: "invited@example.com",
        name: "Invited",
        emailVerification: "admin-vouched",
      });
      const token = new URL(created.invite?.link as string).searchParams.get(
        "token"
      );
      await auth(t).acceptInvite(token as string, PASSPHRASE);
      await expectHashed(t, "invited@example.com", PASSPHRASE);
    });

    it("takes a hash only through the write that is for one, and refuses a raw password there", async () => {
      // `updatePasswordHash` (`PATCH /users/:id/password`) is the one write
      // that takes a hash from its caller. Handed a raw password, it refuses
      // and stores nothing, rather than keeping the password as given.
      const t = await boot(dialect);
      const id = await seedFounder(t);
      const before = await stored(t, "founder@example.com");

      await expect(
        services(t).users.updatePasswordHash(id, PASSPHRASE)
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(await stored(t, "founder@example.com")).toBe(before);
      expect(await signsIn(t, "founder@example.com", OTHER)).toBe(true);

      // The control: a real hash is stored as the hash it is. At bcrypt's
      // lowest cost, since what is under test is the write, not the cost.
      const hash = await hashPassword(PASSPHRASE, 4);
      await services(t).users.updatePasswordHash(id, hash);
      expect(await stored(t, "founder@example.com")).toBe(hash);
      expect(await signsIn(t, "founder@example.com", PASSPHRASE)).toBe(true);
    });

    it("refuses a sign-in to an account whose stored value is the password itself", async () => {
      // A row an earlier release wrote, holding a password as given. Signing
      // in by comparing text would make it a working credential.
      const t = await boot(dialect);
      await seedFounder(t);
      // The account signs in before its stored value is replaced, so the
      // refusal below is about that value, not an account that never could.
      expect(await signsIn(t, "founder@example.com", OTHER)).toBe(true);
      const db = t.adapter.getDrizzle() as unknown as {
        update: (table: unknown) => {
          set: (v: unknown) => { where: (c: unknown) => Promise<unknown> };
        };
      };
      const { users } = getDialectTables();
      await db
        .update(users)
        .set({ passwordHash: PASSPHRASE })
        .where(eq(users.email, "founder@example.com"));
      // The row now holds the password itself, as such a row would.
      expect(await stored(t, "founder@example.com")).toBe(PASSPHRASE);

      expect(await signsIn(t, "founder@example.com", PASSPHRASE)).toBe(false);
    });
  }
);

/**
 * Spaces at either end count as the symbol a password needs, and its trimmed
 * form passes the rule as well, so a path that trimmed before hashing would
 * store a different password without saying so.
 */
const EDGED = " Passw0rd-Edge ";

/** Signs in with exactly what was typed, and not with the trimmed form. */
async function expectStoredAsTyped(t: TestNextly, email: string) {
  expect(await signsIn(t, email, EDGED)).toBe(true);
  expect(await signsIn(t, email, EDGED.trim())).toBe(false);
}

describe.each(getConfiguredTestDialects())(
  "a password is stored as typed, spaces at its ends included (%s)",
  (dialect: TestDialect) => {
    it("keeps it at self-registration", async () => {
      const t = await boot(dialect);
      await seedFounder(t);
      await auth(t).registerUser({
        email: "self@example.com",
        name: "Self",
        password: EDGED,
      });
      await expectStoredAsTyped(t, "self@example.com");
    });

    it("keeps it when an administrator creates an account", async () => {
      const t = await boot(dialect);
      const adminId = await seedFounder(t);
      await dispatchUser(
        services(t),
        "createLocalUser",
        { _authenticatedActorType: "user", _authenticatedActorId: adminId },
        { email: "routed@example.com", name: "Routed", password: EDGED }
      );
      await expectStoredAsTyped(t, "routed@example.com");
    });

    it("keeps it when an administrator sets a password", async () => {
      const t = await boot(dialect);
      const id = await seedFounder(t);
      await services(t).users.updateUser(id, { password: EDGED });
      await expectStoredAsTyped(t, "founder@example.com");
    });

    it("keeps it when the Direct API sets a password", async () => {
      const t = await boot(dialect);
      const id = await seedFounder(t);
      await (t.getService("userService") as UserService).update(
        id,
        { password: EDGED },
        {}
      );
      await expectStoredAsTyped(t, "founder@example.com");
    });

    it("keeps it when a person changes their own password", async () => {
      const t = await boot(dialect);
      const id = await seedFounder(t);
      await auth(t).changePassword(id, OTHER, EDGED);
      await expectStoredAsTyped(t, "founder@example.com");
    });

    it("keeps it when the Direct API changes a person's own password", async () => {
      // This write hashes with the app's configured hasher, so the instance
      // is given one: core's own, which sign-in verifies. The declared reach
      // is core's own too — the contract the boot requires of every digester.
      current = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        passwordHasher: {
          hash: hashPassword,
          verify: verifyPassword,
          reach: DEFAULT_DIGESTER_REACH_BYTES,
        },
      });
      const t = current;
      if (dialect === "sqlite") {
        for (const statement of generateSqliteCoreTableStatements()) {
          await t.adapter.executeQuery(statement);
        }
      }
      const id = await seedFounder(t);
      await (t.getService("userService") as UserService).changePassword(
        id,
        OTHER,
        EDGED
      );
      await expectStoredAsTyped(t, "founder@example.com");
    });

    it("keeps it when a password is reset with a token", async () => {
      const t = await boot(dialect);
      await seedFounder(t);
      const { token } = await auth(t).generatePasswordResetToken(
        "founder@example.com",
        { disableEmail: true }
      );
      await auth(t).resetPasswordWithToken(token as string, EDGED);
      await expectStoredAsTyped(t, "founder@example.com");
    });

    it("keeps it when an invite is accepted", async () => {
      const t = await boot(dialect);
      await seedFounder(t);
      const created = await services(t).users.createLocalUser({
        email: "invited@example.com",
        name: "Invited",
        emailVerification: "admin-vouched",
      });
      const token = new URL(created.invite?.link as string).searchParams.get(
        "token"
      );
      await auth(t).acceptInvite(token as string, EDGED);
      await expectStoredAsTyped(t, "invited@example.com");
    });

    it("keeps it when a person replaces an admin-set password at first sign-in", async () => {
      const t = await boot(dialect);
      await seedFounder(t);
      const created = await services(t).users.createLocalUser({
        email: "flagged@example.com",
        name: "Flagged",
        password: OTHER,
        isActive: true,
        emailVerification: "admin-vouched",
        mustChangePassword: true,
      });
      await auth(t).setInitialPassword(String(created.id), EDGED);
      await expectStoredAsTyped(t, "flagged@example.com");
    });
  }
);
