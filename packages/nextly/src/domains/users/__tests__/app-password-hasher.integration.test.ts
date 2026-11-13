/**
 * An app's `passwordHasher` is the one digester for account passwords.
 *
 * Before, only the users service's `authenticate` and `changePassword` used
 * it: every account was created, reset and invited with core's bcrypt, and
 * core sign-in verified bcrypt only, so which scheme a password was stored in
 * depended on which path wrote it, and a password one path wrote could not
 * sign in through another. Each case here writes a password through one path
 * and signs in through every one.
 */
import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { passwordCredentialDeps } from "../../../auth/credentials/credential-deps";
import { verifyCredentials } from "../../../auth/credentials/verify-credentials";
import {
  hashPassword,
  isPasswordHash,
  type PasswordHasher,
} from "../../../auth/password/index";
import { getDialectTables } from "../../../database/index";
import { generateSqliteCoreTableStatements } from "../../../database/sqlite-core-tables";
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

/** An app's own scheme: nothing like bcrypt, and it knows its own output. */
const PREFIX = "app-hasher$";
const digest = (password: string) =>
  `${PREFIX}${createHash("sha256").update(`salt:${password}`).digest("hex")}`;
const appHasher: PasswordHasher = {
  name: "app-hasher",
  reach: "unbounded",
  hash: password => Promise.resolve(digest(password)),
  verify: (password, stored) => Promise.resolve(stored === digest(password)),
  isHash: stored => stored.startsWith(PREFIX),
};

const FIRST = "Str0ng-P@ssw0rd!";
const SECOND = "Another-Str0ng-P@ss-2";

async function boot(
  dialect: TestDialect,
  hasher: PasswordHasher = appHasher
): Promise<TestNextly> {
  current = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    passwordHasher: hasher,
  });
  if (dialect === "sqlite") {
    // The SQLite runtime auto-sync does not create the core auth tables.
    for (const statement of generateSqliteCoreTableStatements()) {
      await current.adapter.executeQuery(statement);
    }
  }
  return current;
}

function auth(t: TestNextly): AuthService {
  return t.getService("authService") as unknown as AuthService;
}

function users(t: TestNextly): UserService {
  return t.getService("userService") as UserService;
}

/** The stored password columns, read back from the database. */
async function row(
  t: TestNextly,
  email: string
): Promise<{ passwordHash: unknown; passwordUpdatedAt: unknown }> {
  const db = t.adapter.getDrizzle() as unknown as {
    select: () => {
      from: (table: unknown) => {
        where: (cond: unknown) => Promise<Record<string, unknown>[]>;
      };
    };
  };
  const { users: table } = getDialectTables();
  const [found] = await db.select().from(table).where(eq(table.email, email));
  if (!found) throw new Error(`no account for ${email}`);
  return {
    passwordHash: found.passwordHash,
    passwordUpdatedAt: found.passwordUpdatedAt,
  };
}

async function setStoredHash(
  t: TestNextly,
  email: string,
  passwordHash: string
): Promise<void> {
  const db = t.adapter.getDrizzle() as unknown as {
    update: (table: unknown) => {
      set: (values: unknown) => { where: (cond: unknown) => Promise<unknown> };
    };
  };
  const { users: table } = getDialectTables();
  await db.update(table).set({ passwordHash }).where(eq(table.email, email));
}

/** Which sign-ins `password` passes for the account: core's, and the two services'. */
async function signIns(
  t: TestNextly,
  email: string,
  password: string
): Promise<{ core: boolean; authenticate: boolean; authService: boolean }> {
  const passes = async (attempt: () => Promise<unknown>) =>
    attempt().then(
      () => true,
      () => false
    );
  return {
    core: await passes(() =>
      verifyCredentials(
        { email, password },
        passwordCredentialDeps(() => t.adapter)
      )
    ),
    authenticate: await passes(() => users(t).authenticate(email, password)),
    authService: await passes(() => auth(t).verifyCredentials(email, password)),
  };
}

const EVERY = { core: true, authenticate: true, authService: true };
const NONE = { core: false, authenticate: false, authService: false };

/** An account, verified and active, so every sign-in may admit it. */
async function seed(t: TestNextly, email: string): Promise<string> {
  const created = await new ServiceContainer(t.adapter).users.createLocalUser({
    email,
    name: "Person",
    password: FIRST,
    isActive: true,
    emailVerification: "admin-vouched",
  });
  return String(created.id);
}

describe.each(getConfiguredTestDialects())(
  "an app's passwordHasher is the one digester (%s)",
  dialect => {
    it("creates an account with the app's hash, and every sign-in takes it", async () => {
      const t = await boot(dialect);
      await seed(t, "founder@example.com");
      expect((await row(t, "founder@example.com")).passwordHash).toBe(
        digest(FIRST)
      );
      expect(await signIns(t, "founder@example.com", FIRST)).toEqual(EVERY);
      expect(await signIns(t, "founder@example.com", SECOND)).toEqual(NONE);
    });

    it("stores the app's hash from a change, a reset, an invite and an administrator's set", async () => {
      const t = await boot(dialect);
      const id = await seed(t, "founder@example.com");

      await auth(t).changePassword(id, FIRST, SECOND);
      expect((await row(t, "founder@example.com")).passwordHash).toBe(
        digest(SECOND)
      );
      expect(await signIns(t, "founder@example.com", SECOND)).toEqual(EVERY);

      const { token } = await auth(t).generatePasswordResetToken(
        "founder@example.com",
        { disableEmail: true }
      );
      await auth(t).resetPasswordWithToken(token as string, FIRST);
      expect((await row(t, "founder@example.com")).passwordHash).toBe(
        digest(FIRST)
      );

      const invited = await new ServiceContainer(
        t.adapter
      ).users.createLocalUser({
        email: "invited@example.com",
        name: "Invited",
        emailVerification: "admin-vouched",
      });
      const inviteToken = new URL(
        invited.invite?.link as string
      ).searchParams.get("token");
      await auth(t).acceptInvite(inviteToken as string, SECOND);
      expect((await row(t, "invited@example.com")).passwordHash).toBe(
        digest(SECOND)
      );
      expect(await signIns(t, "invited@example.com", SECOND)).toEqual(EVERY);

      await new ServiceContainer(t.adapter).users.updateUser(id, {
        password: SECOND,
      });
      expect((await row(t, "founder@example.com")).passwordHash).toBe(
        digest(SECOND)
      );
      expect(await signIns(t, "founder@example.com", SECOND)).toEqual(EVERY);
    });

    it("signs in a password core stored with bcrypt before, and stores it again with the app's hasher", async () => {
      const t = await boot(dialect);
      await seed(t, "founder@example.com");
      await setStoredHash(t, "founder@example.com", await hashPassword(FIRST));
      const before = await row(t, "founder@example.com");
      expect(isPasswordHash(before.passwordHash)).toBe(true);

      await verifyCredentials(
        { email: "founder@example.com", password: FIRST },
        passwordCredentialDeps(() => t.adapter)
      );
      const after = await row(t, "founder@example.com");
      expect(after.passwordHash).toBe(digest(FIRST));
      // The same password, stored again: not a new one, so its time stands.
      expect(after.passwordUpdatedAt).toEqual(before.passwordUpdatedAt);
      expect(await signIns(t, "founder@example.com", FIRST)).toEqual(EVERY);
    });

    it("stores a bcrypt password again when the users service authenticates it", async () => {
      const t = await boot(dialect);
      await seed(t, "founder@example.com");
      await setStoredHash(t, "founder@example.com", await hashPassword(FIRST));

      await users(t).authenticate("founder@example.com", FIRST);
      expect((await row(t, "founder@example.com")).passwordHash).toBe(
        digest(FIRST)
      );
    });

    it("signs nobody in by a stored value that is neither the app's hash nor bcrypt", async () => {
      const t = await boot(dialect);
      await seed(t, "founder@example.com");
      // A password stored as given: never a working credential.
      await setStoredHash(t, "founder@example.com", FIRST);
      expect(await signIns(t, "founder@example.com", FIRST)).toEqual(NONE);
    });

    it("refuses, on create and on an administrator's set, a password longer than the hasher reads", async () => {
      // A hasher that reads 16 bytes: a longer password would be stored as its
      // first 16, which a different password sharing them would also match.
      const t = await boot(dialect, { ...appHasher, reach: 16 });
      const id = await seed(t, "founder@example.com");
      const long = "Str0ng-P@ssw0rd!-and-more";
      await expect(
        new ServiceContainer(t.adapter).users.createLocalUser({
          email: "long@example.com",
          name: "Long",
          password: long,
          isActive: true,
          emailVerification: "admin-vouched",
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(
        new ServiceContainer(t.adapter).users.updateUser(id, { password: long })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      // Nothing was written: the account keeps its password.
      expect((await row(t, "founder@example.com")).passwordHash).toBe(
        digest(FIRST)
      );
    });
  }
);
