/**
 * Clearing passwords an earlier release stored as given.
 *
 * The fixture holds every kind of stored password side by side: a hash, a
 * short plain value, a long one containing colons (what account creation used
 * to keep as typed), and none at all. Each account holds a live refresh token,
 * so what the clean-up ends, and what it leaves, can both be seen.
 */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { hashPassword } from "../../../auth/password/index";
import { getDialectTables } from "../../../database/index";
import { generateSqliteCoreTableStatements } from "../../../database/sqlite-core-tables";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { consoleLogger } from "../../../services/shared";
import type { AuthService } from "../../auth/services/auth-service";
import { PlainTextPasswordCleanup } from "../services/plaintext-password-cleanup";

/**
 * Work to run once an account's clearing has begun, before its write: what
 * another request could commit in that gap. `beforeClear` runs first, given
 * the account's id; `failSessionEnd` names an account whose sessions cannot be
 * ended, so the write that clears its value is followed by a failure.
 */
const between = vi.hoisted(() => ({
  beforeClear: undefined as ((userId: string) => Promise<void>) | undefined,
  failSessionEnd: undefined as string | undefined,
}));

vi.mock("../services/password-write", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../services/password-write")>();
  return {
    ...actual,
    updateUserEndingSessions: async (
      ...[tx, tables, dialect, args]: Parameters<
        typeof actual.updateUserEndingSessions
      >
    ) => {
      await between.beforeClear?.(String(args.userId));
      if (between.failSessionEnd !== String(args.userId)) {
        return actual.updateUserEndingSessions(tx, tables, dialect, args);
      }
      // The same transaction, whose session delete fails after the update.
      const failing = new Proxy(tx, {
        get(target, prop) {
          if (prop === "delete") {
            return () => {
              throw new Error("the sessions could not be ended");
            };
          }
          const value: unknown = Reflect.get(target, prop);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      return actual.updateUserEndingSessions(failing, tables, dialect, args);
    },
  };
});

let current: TestNextly | undefined;
afterEach(async () => {
  between.beforeClear = undefined;
  between.failSessionEnd = undefined;
  await current?.destroy();
  current = undefined;
});

const SHORT_PLAIN = "hunter2-as-typed";
const COLON_PLAIN = "Correct-Horse:Battery-Staple:2026-Phrase";
const NEW_PASSWORD = "Str0ng-P@ssw0rd!";
// What other password hashers write: an app's own `passwordHasher`, or a hash
// made elsewhere that account creation once accepted. Neither is plain text.
const MODULAR_CRYPT = {
  argon2:
    "$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaA",
  scrypt:
    "$scrypt$ln=16,r=8,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaA",
  pbkdf2: "$pbkdf2-sha256$29000$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNo",
};
const HEX_SALT_AND_DIGEST = `${"a1".repeat(16)}:${"9f".repeat(64)}`;

interface TestDb {
  select: () => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<Record<string, unknown>[]>;
    };
  };
  insert: (table: unknown) => { values: (v: unknown) => Promise<unknown> };
  update: (table: unknown) => {
    set: (v: unknown) => { where: (cond: unknown) => Promise<unknown> };
  };
}

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

function db(t: TestNextly): TestDb {
  return t.adapter.getDrizzle() as unknown as TestDb;
}

/** One account per kind of stored password, each signed in once. */
async function seed(t: TestNextly): Promise<Record<string, string | null>> {
  const { users, refreshTokens } = getDialectTables();
  const stored: Record<string, string | null> = {
    hashed: await hashPassword(NEW_PASSWORD),
    short: SHORT_PLAIN,
    colon: COLON_PLAIN,
    ...MODULAR_CRYPT,
    hexpair: HEX_SALT_AND_DIGEST,
    none: null,
    // No password either: there is nothing to clear, and its sessions stay.
    empty: "",
  };
  for (const [kind, passwordHash] of Object.entries(stored)) {
    // Written directly: no path today stores a password as given, which is
    // the state these rows stand for.
    await db(t)
      .insert(users)
      .values({
        id: `user-${kind}`,
        email: `${kind}@example.com`,
        name: kind,
        passwordHash,
        isActive: true,
        emailVerified: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    await db(t)
      .insert(refreshTokens)
      .values({
        id: `rt-${kind}`,
        userId: `user-${kind}`,
        tokenHash: `hash-${kind}`,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      });
  }
  return stored;
}

async function account(
  t: TestNextly,
  kind: string
): Promise<{ passwordHash: unknown; sessions: number }> {
  const { users, refreshTokens } = getDialectTables();
  const [row] = await db(t)
    .select()
    .from(users)
    .where(eq(users.id, `user-${kind}`));
  const sessions = await db(t)
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.userId, `user-${kind}`));
  return { passwordHash: row?.passwordHash, sessions: sessions.length };
}

function cleanup(t: TestNextly): PlainTextPasswordCleanup {
  return new PlainTextPasswordCleanup(t.adapter, consoleLogger);
}

function auth(t: TestNextly): AuthService {
  return t.getService("authService") as unknown as AuthService;
}

/** The error a sign-in answers with, or `null` when it is admitted. */
async function signInError(
  t: TestNextly,
  email: string,
  password: string
): Promise<unknown> {
  try {
    await auth(t).verifyCredentials(email, password);
    return null;
  } catch (error) {
    return error;
  }
}

describe.each(getConfiguredTestDialects())(
  "clearing passwords stored as given (%s)",
  (dialect: TestDialect) => {
    it("finds only the accounts whose stored password is plain text, by id", async () => {
      const t = await boot(dialect);
      await seed(t);

      const found = await cleanup(t).find();

      // Not core's hash, nor in another hasher's format. The colon value is
      // the one account creation kept as given, and is found.
      expect([...found].sort()).toEqual(["user-colon", "user-short"]);
      // Ids only: no stored value comes back from the read.
      const output = JSON.stringify(found);
      expect(output).not.toContain(SHORT_PLAIN);
      expect(output).not.toContain(COLON_PLAIN);
    });

    it("clears those values and ends their sessions, leaving every other account as it was", async () => {
      const t = await boot(dialect);
      const stored = await seed(t);

      expect(await cleanup(t).clear()).toBe(2);

      for (const kind of ["short", "colon"]) {
        expect(await account(t, kind)).toEqual({
          passwordHash: null,
          sessions: 0,
        });
      }
      // The controls: a hash, another hasher's hashes and an account with no
      // password are untouched, and keep their sessions.
      for (const kind of ["hashed", "argon2", "scrypt", "pbkdf2", "hexpair"]) {
        expect(await account(t, kind)).toEqual({
          passwordHash: stored[kind],
          sessions: 1,
        });
      }
      expect(await account(t, "none")).toEqual({
        passwordHash: null,
        sessions: 1,
      });
      expect(await account(t, "empty")).toEqual({
        passwordHash: "",
        sessions: 1,
      });
    });

    it("leaves an account whose value was replaced after it was found", async () => {
      // A reset lands between the clean-up finding the account and clearing
      // it. The new value is a hash someone just chose, and stays, as do the
      // sessions it came with.
      const t = await boot(dialect);
      await seed(t);
      const replacement = await hashPassword(NEW_PASSWORD);
      const { users } = getDialectTables();
      between.beforeClear = async userId => {
        if (userId !== "user-short") return;
        await db(t)
          .update(users)
          .set({ passwordHash: replacement })
          .where(eq(users.id, "user-short"));
      };

      expect(await cleanup(t).clear()).toBe(1);

      expect(await account(t, "short")).toEqual({
        passwordHash: replacement,
        sessions: 1,
      });
      // The control: the other plain-text account is cleared as usual.
      expect(await account(t, "colon")).toEqual({
        passwordHash: null,
        sessions: 0,
      });
    });

    it("keeps an account's value when its sessions cannot be ended", async () => {
      // The value and the sessions go together or not at all: an account
      // left signed in with its value gone, or signed out with it kept, is
      // neither of the states the clean-up promises. On SQLite one connection
      // serves every query, so only PostgreSQL and MySQL can tell a write made
      // outside the account's transaction from one made inside it.
      const t = await boot(dialect);
      await seed(t);
      between.failSessionEnd = "user-short";

      await expect(cleanup(t).clear()).rejects.toThrow(
        "the sessions could not be ended"
      );

      expect(await account(t, "short")).toEqual({
        passwordHash: SHORT_PLAIN,
        sessions: 1,
      });
    });

    it("writes no stored value to any output while finding and clearing", async () => {
      const t = await boot(dialect);
      await seed(t);
      const sinks = [
        vi.spyOn(console, "log"),
        vi.spyOn(console, "info"),
        vi.spyOn(console, "warn"),
        vi.spyOn(console, "error"),
        vi.spyOn(console, "debug"),
        vi.spyOn(process.stdout, "write"),
        vi.spyOn(process.stderr, "write"),
      ];
      try {
        await cleanup(t).find();
        await cleanup(t).clear();
        // The control: whatever is written here is captured.
        console.info("output-is-captured");
        const written = sinks
          .flatMap(sink => sink.mock.calls)
          .map(call => JSON.stringify(call))
          .join("\n");
        expect(written).toContain("output-is-captured");
        expect(written).not.toContain(SHORT_PLAIN);
        expect(written).not.toContain(COLON_PLAIN);
      } finally {
        for (const sink of sinks) sink.mockRestore();
      }
    });

    it("changes nothing on a second run", async () => {
      const t = await boot(dialect);
      const stored = await seed(t);
      await cleanup(t).clear();

      expect(await cleanup(t).clear()).toBe(0);
      expect(await cleanup(t).find()).toEqual([]);
      expect(await account(t, "hashed")).toEqual({
        passwordHash: stored.hashed,
        sessions: 1,
      });
    });

    it("refuses a cleared account's sign-in as it refuses a wrong password, and a reset gives it one", async () => {
      const t = await boot(dialect);
      await seed(t);
      await cleanup(t).clear();

      // The old value, and any other, answer exactly as a wrong password on
      // an ordinary account does.
      const wrong = await signInError(t, "hashed@example.com", "not-it");
      expect(wrong).toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
      for (const attempt of [COLON_PLAIN, "anything-else"]) {
        const refused = await signInError(t, "colon@example.com", attempt);
        expect(refused).toMatchObject({
          code: (wrong as { code: string }).code,
          publicMessage: (wrong as { publicMessage: string }).publicMessage,
        });
      }

      const { token } = await auth(t).generatePasswordResetToken(
        "colon@example.com",
        { disableEmail: true }
      );
      await auth(t).resetPasswordWithToken(token as string, NEW_PASSWORD);
      expect(
        await signInError(t, "colon@example.com", NEW_PASSWORD)
      ).toBeNull();
    });
  }
);
