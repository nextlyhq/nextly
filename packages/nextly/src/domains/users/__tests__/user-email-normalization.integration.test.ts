/**
 * Every path that writes or reads a user email must agree on one spelling.
 *
 * Login looks an address up as `trim().toLowerCase()` (auth handlers'
 * findUserByEmail), so a row stored with any uppercase letter or surrounding
 * whitespace is unreachable at sign-in: the lookup misses, the response is
 * the generic invalid-credentials error, and no amount of retrying fixes it.
 * These tests pin the agreement: createLocalUser stores the normalized
 * spelling, the duplicate check is case-insensitive, and findByEmail matches
 * case-insensitively.
 *
 * The findByEmail case seeds its row directly in lowercase so the query-side
 * property is isolated from the create-side one: the lookup input differs in
 * case from the stored value, which is exactly the situation a mixed-case
 * history leaves behind.
 *
 * Runs against real SQLite (in a temp file) so the case sensitivity under
 * test is the database's `=` comparison, not a mock's. Follows the DDL and
 * setup pattern of `user-delete-audit-erasure.integration.test.ts`.
 */

import { existsSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../database/index";
import { getSQLiteDrizzleKit } from "../../../database/drizzle-kit-lazy";
import { SchemaRegistry } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors";
import { splitStatements } from "../../../domains/schema/pipeline/sql-statement-utils";
import {
  passwordResetTokens as passwordResetTokensSqlite,
  userInviteTokens as userInviteTokensSqlite,
  emailVerificationTokens as emailVerificationTokensSqlite,
  refreshTokens as refreshTokensSqlite,
} from "../../../schemas/auth-tokens/sqlite";
import { users as usersSqlite } from "../../../schemas/users/sqlite";
import { nextlyEvents as eventsSqlite } from "../../../schemas/webhooks/sqlite";
import { AuthService } from "../../auth/services/auth-service";
import { UserMutationService } from "../services/user-mutation-service";
import { UserQueryService } from "../services/user-query-service";

const TEST_DB_DIR = join(
  tmpdir(),
  `nextly-user-email-normalization-${process.pid}-${Date.now()}`
);
const TEST_DB_PATH = join(TEST_DB_DIR, "test.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

process.env.DB_DIALECT = "sqlite";
process.env.DATABASE_URL = TEST_DB_URL;

// Production DDL from the sqlite table definitions, never hand-copied — the
// unique index on email is part of what the duplicate test leans on.
async function ddl(): Promise<string[]> {
  const kit = await getSQLiteDrizzleKit();
  const statements = await kit.generateMigration(
    await kit.generateDrizzleJson({}),
    await kit.generateDrizzleJson({
      users: usersSqlite,
      userInviteTokens: userInviteTokensSqlite,
      passwordResetTokens: passwordResetTokensSqlite,
      emailVerificationTokens: emailVerificationTokensSqlite,
      refreshTokens: refreshTokensSqlite,
      // The mutation service records user.created to the outbox whenever
      // recording is active, and that gate is process-wide.
      nextlyEvents: eventsSqlite,
    })
  );
  return splitStatements(statements);
}

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const PASSWORD = "Str0ng-Passw0rd!";

describe("user email normalization across create, duplicate check and lookup", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;
  let mutations: UserMutationService;
  let queries: UserQueryService;

  beforeAll(async () => {
    if (!existsSync(TEST_DB_DIR)) mkdirSync(TEST_DB_DIR, { recursive: true });
    adapter = createSqliteAdapter({ url: TEST_DB_URL });
    await adapter.connect();
    for (const stmt of await ddl()) {
      await adapter.executeQuery(stmt);
    }
    // A sentinel user so createLocalUser's "first user ever" branch (which
    // needs more of the RBAC wiring) is never taken.
    const nowEpoch = Math.floor(Date.now() / 1000);
    await adapter.executeQuery(
      `INSERT INTO users (id, email, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["sentinel", "sentinel@test.local", "Sentinel", 1, nowEpoch, nowEpoch]
    );
    // The adapter resolves a table name through a SchemaRegistry, which boot
    // normally installs; the mutation service writes the user.created event
    // by name inside its transaction.
    const registry = new SchemaRegistry("sqlite");
    registry.registerStaticSchemas(getDialectTables("sqlite"));
    adapter.setTableResolver(registry);

    mutations = new UserMutationService(adapter, silentLogger);
    queries = new UserQueryService(adapter, silentLogger);
  });

  afterAll(async () => {
    try {
      await adapter?.disconnect?.();
    } catch {
      // ignore teardown close errors
    }
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  async function storedEmail(userId: string): Promise<string | null> {
    const rows = await adapter.executeQuery<{ email: string }>(
      "SELECT email FROM users WHERE id = ?",
      [userId]
    );
    return rows[0]?.email ?? null;
  }

  it("stores the email lowercased", async () => {
    const created = await mutations.createLocalUser({
      email: "MixedCase@Example.COM",
      name: "Mixed Case",
      password: PASSWORD,
    });

    expect(created.email).toBe("mixedcase@example.com");
    expect(await storedEmail(String(created.id))).toBe("mixedcase@example.com");
  });

  it("treats a case variant of an existing email as a duplicate", async () => {
    await mutations.createLocalUser({
      email: "CaseVariant@X.com",
      name: "First",
      password: PASSWORD,
    });

    let secondError: unknown;
    try {
      await mutations.createLocalUser({
        email: "CASEVARIANT@x.COM",
        name: "Second",
        password: PASSWORD,
      });
    } catch (err) {
      secondError = err;
    }

    expect(NextlyError.is(secondError)).toBe(true);
    expect((secondError as { statusCode?: number }).statusCode).toBe(409);

    const rows = await adapter.executeQuery<{ n: number }>(
      "SELECT COUNT(*) as n FROM users WHERE email LIKE 'casevariant@x.com' COLLATE NOCASE"
    );
    expect(Number(rows[0]?.n ?? 0)).toBe(1);
  });

  it("rejects a create that repeats a legacy mixed-case row's address", async () => {
    // Seeded directly with the OLD write path's spelling, so this exercises
    // the upgrade state: a row that predates normalization. The duplicate
    // probe must also try the caller's exact spelling, or the case-sensitive
    // unique index admits a second, lowercased account for the same logical
    // email.
    const nowEpoch = Math.floor(Date.now() / 1000);
    await adapter.executeQuery(
      `INSERT INTO users (id, email, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["legacy-a", "Legacy@X.com", "Legacy A", 1, nowEpoch, nowEpoch]
    );

    await expect(
      mutations.createLocalUser({
        email: "Legacy@X.com",
        name: "Shadow A",
        password: PASSWORD,
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("findByEmail returns the exact-spelling account when case twins exist", async () => {
    // A database upgraded from the old write path can hold both rows: the
    // unique index is case-sensitive, so this pair was insertable before
    // normalization. The lookup must return the account the caller's
    // spelling names, never pick one of the twins arbitrarily.
    const nowEpoch = Math.floor(Date.now() / 1000);
    await adapter.executeQuery(
      `INSERT INTO users (id, email, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["twin-lower", "twin@x.com", "Twin Lower", 1, nowEpoch, nowEpoch]
    );
    await adapter.executeQuery(
      `INSERT INTO users (id, email, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["twin-upper", "Twin@X.com", "Twin Upper", 1, nowEpoch, nowEpoch]
    );

    const byMixed = await queries.findByEmail("Twin@X.com");
    expect(String(byMixed?.id)).toBe("twin-upper");

    const byLower = await queries.findByEmail("twin@x.com");
    expect(String(byLower?.id)).toBe("twin-lower");
  });

  it("findByEmail matches regardless of the case it is called with", async () => {
    // Seeded directly and lowercase so this isolates the lookup side: the
    // query input's case differs from the stored value on purpose.
    const nowEpoch = Math.floor(Date.now() / 1000);
    await adapter.executeQuery(
      `INSERT INTO users (id, email, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["probe", "probe@test.local", "Probe", 1, nowEpoch, nowEpoch]
    );

    const byUppercase = await queries.findByEmail("PROBE@TEST.LOCAL");
    expect(byUppercase).not.toBeNull();
    expect(String(byUppercase?.id)).toBe("probe");

    // Positive control: the exact stored spelling still matches.
    const byExact = await queries.findByEmail("probe@test.local");
    expect(String(byExact?.id)).toBe("probe");
  });

  it("verification tokens issued for a legacy row verify that row", async () => {
    // The token is keyed to the matched account's stored spelling: for a
    // legacy mixed-case row, verifyEmail updates users by an exact
    // email = identifier match, so a normalized identifier would verify
    // zero rows while still reporting success.
    const nowEpoch = Math.floor(Date.now() / 1000);
    await adapter.executeQuery(
      `INSERT INTO users (id, email, name, is_active, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        "legacy-token",
        "Tokenizer@X.com",
        "Legacy Token",
        1,
        null,
        nowEpoch,
        nowEpoch,
      ]
    );

    const auth = new AuthService(adapter, silentLogger);
    const { token } = await auth.generateEmailVerificationToken(
      "Tokenizer@X.com",
      { disableEmail: true }
    );
    expect(token).toBeTruthy();

    await auth.verifyEmail(token as string);

    const rows = await adapter.executeQuery<{
      email_verified: number | null;
    }>("SELECT email_verified FROM users WHERE id = ?", ["legacy-token"]);
    expect(rows[0]?.email_verified).not.toBeNull();
  });

  it("a resend for the exact legacy twin verifies that twin, not its double", async () => {
    // With both spellings on the database, the token must activate the
    // account the caller actually addressed: probing the canonical spelling
    // first would key the token to the lowercase twin and verify it instead.
    const nowEpoch = Math.floor(Date.now() / 1000);
    await adapter.executeQuery(
      `INSERT INTO users (id, email, name, is_active, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        "twin-token-lower",
        "resend@x.com",
        "Resend Lower",
        1,
        null,
        nowEpoch,
        nowEpoch,
      ]
    );
    await adapter.executeQuery(
      `INSERT INTO users (id, email, name, is_active, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        "twin-token-upper",
        "Resend@X.com",
        "Resend Upper",
        1,
        null,
        nowEpoch,
        nowEpoch,
      ]
    );

    const auth = new AuthService(adapter, silentLogger);
    const { token } = await auth.generateEmailVerificationToken(
      "Resend@X.com",
      { disableEmail: true }
    );
    expect(token).toBeTruthy();

    await auth.verifyEmail(token as string);

    const rows = await adapter.executeQuery<{
      id: string;
      email_verified: number | null;
    }>("SELECT id, email_verified FROM users WHERE id IN (?, ?)", [
      "twin-token-lower",
      "twin-token-upper",
    ]);
    const verified = Object.fromEntries(
      rows.map(r => [r.id, r.email_verified !== null])
    );
    expect(verified["twin-token-upper"]).toBe(true);
    expect(verified["twin-token-lower"]).toBe(false);
  });
});
