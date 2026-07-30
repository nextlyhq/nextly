/**
 * End-to-end proof that the user mutation service emits `user.created` and
 * `user.deleted` outbox events atomically with the account change, that the
 * recorded payload is PII-safe (identity only, never the password hash, tokens,
 * or role assignments), that the caller is attributed, and that the shared
 * fast-path drain is kicked after commit.
 *
 * Uses SQLite (cheapest live DB, no container) driving the real Drizzle
 * `withTransaction` path — the same path production takes — so the new
 * `recordEventInTx` bridge is exercised, not mocked. The audit seam is enabled
 * so the recording gate is open without wiring an endpoint. Follows the DDL and
 * setup pattern of `user-mutation-service.transaction.integration.test.ts`.
 */

import { existsSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getSQLiteDrizzleKit } from "../../../database/drizzle-kit-lazy";
import {
  resetWebhookActivation,
  setWebhookAuditEnabled,
} from "../../../domains/webhooks/recording-activation";
import { splitStatements } from "../../../domains/schema/pipeline/sql-statement-utils";
import {
  roles as rolesSqlite,
  userRoles as userRolesSqlite,
} from "../../../schemas/rbac/sqlite";
import {
  accounts as accountsSqlite,
  users as usersSqlite,
} from "../../../schemas/users/sqlite";
import { nextlyEvents as eventsSqlite } from "../../../schemas/webhooks/sqlite";
import { UserMutationService } from "../services/user-mutation-service";

const TEST_DB_DIR = join(
  tmpdir(),
  `nextly-user-webhook-events-${process.pid}-${Date.now()}`
);
const TEST_DB_PATH = join(TEST_DB_DIR, "test.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

process.env.DB_DIALECT = "sqlite";
process.env.DATABASE_URL = TEST_DB_URL;

// Production DDL from the sqlite table definitions (never hand-copied), for both
// the users table the service writes and the nextly_events outbox it records to.
async function ddl(): Promise<string[]> {
  const kit = await getSQLiteDrizzleKit();
  const statements = await kit.generateMigration(
    await kit.generateDrizzleJson({}),
    await kit.generateDrizzleJson({
      users: usersSqlite,
      accounts: accountsSqlite,
      roles: rolesSqlite,
      userRoles: userRolesSqlite,
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

interface EventRow {
  type: string;
  resource_kind: string;
  resource_id: string | null;
  payload: string;
}

describe("user mutation webhook events (real SQLite)", () => {
  // Inferred from the imported factory rather than importing the full
  // DrizzleAdapter type from @nextlyhq/adapter-drizzle (a dependency this suite
  // does not otherwise need), so every adapter call stays type-checked.
  let adapter: ReturnType<typeof createSqliteAdapter>;
  let service: UserMutationService;

  beforeAll(async () => {
    if (!existsSync(TEST_DB_DIR)) mkdirSync(TEST_DB_DIR, { recursive: true });
    adapter = createSqliteAdapter({ url: TEST_DB_URL });
    await adapter.connect();
    for (const stmt of await ddl()) {
      await adapter.executeQuery(stmt);
    }
    // A sentinel user so createLocalUser's "first user ever" branch (which needs
    // the RBAC tables) is never taken.
    const nowEpoch = Math.floor(Date.now() / 1000);
    await adapter.executeQuery(
      `INSERT INTO users (id, email, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["sentinel", "sentinel@test.local", "Sentinel", 1, nowEpoch, nowEpoch]
    );
    service = new UserMutationService(adapter, silentLogger);
  });

  afterEach(() => {
    resetWebhookActivation();
  });

  afterAll(async () => {
    try {
      await adapter?.disconnect?.();
    } catch {
      // ignore teardown close errors
    }
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it("records a PII-safe, attributed user.created event in the same transaction", async () => {
    setWebhookAuditEnabled(true);

    const created = await service.createLocalUser(
      {
        email: "hook-create@test.local",
        name: "Hooked",
        password: "TestPassword123!",
        isActive: true,
      },
      { type: "user", id: "admin-actor-1" }
    );

    const rows = await adapter.executeQuery<EventRow>(
      "SELECT type, resource_kind, resource_id, payload FROM nextly_events WHERE type = ? AND resource_id = ?",
      ["user.created", created.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].resource_kind).toBe("user");

    const envelope = JSON.parse(rows[0].payload);
    expect(envelope.data.email).toBe("hook-create@test.local");
    expect(envelope.data.name).toBe("Hooked");
    // The write is attributed to the authenticated caller, not anonymous.
    expect(envelope.actor).toEqual({ type: "user", id: "admin-actor-1" });
    // Roles are assigned after this transaction commits, so the creation event
    // makes no role claim — the payload carries no `roles` field at all.
    expect(envelope.data.roles).toBeUndefined();
    // The password hash and any token must never ride in the payload.
    expect(rows[0].payload).not.toMatch(/passwordHash|password_hash|token/i);
  });

  it("records an attributed user.deleted with the removed account's identity", async () => {
    setWebhookAuditEnabled(true);
    const created = await service.createLocalUser({
      email: "hook-delete@test.local",
      name: "ToDelete",
      password: "TestPassword123!",
      isActive: true,
    });

    await service.deleteUser(created.id, { type: "user", id: "admin-actor-2" });

    const rows = await adapter.executeQuery<EventRow>(
      "SELECT type, resource_kind, resource_id, payload FROM nextly_events WHERE type = ? AND resource_id = ?",
      ["user.deleted", created.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].resource_id).toBe(created.id);
    const envelope = JSON.parse(rows[0].payload);
    expect(envelope.data.email).toBe("hook-delete@test.local");
    expect(envelope.actor).toEqual({ type: "user", id: "admin-actor-2" });
  });

  it("offers the fast-path drain and retention pass after committing user events", async () => {
    setWebhookAuditEnabled(true);
    const offer = vi.fn();
    const maybeRun = vi.fn().mockResolvedValue(undefined);
    // The mutation service depends only on `offer()` and `maybeRun()`, so plain
    // spies satisfy the injected drain and retention runner without
    // reconstructing the real ones.
    const drained = new UserMutationService(
      adapter,
      silentLogger,
      undefined,
      undefined,
      undefined,
      { offer },
      { maybeRun }
    );

    const created = await drained.createLocalUser({
      email: "hook-drain@test.local",
      name: "Drained",
      password: "TestPassword123!",
      isActive: true,
    });
    // A recorded create kicks the drain and offers a retention pass, after commit.
    expect(offer).toHaveBeenCalledTimes(1);
    expect(maybeRun).toHaveBeenCalledTimes(1);

    await drained.deleteUser(created.id);
    // A recorded delete kicks both again.
    expect(offer).toHaveBeenCalledTimes(2);
    expect(maybeRun).toHaveBeenCalledTimes(2);
  });

  it("records user.deleted with the account's current stored identity", async () => {
    setWebhookAuditEnabled(true);
    const created = await service.createLocalUser({
      email: "hook-preimage@test.local",
      name: "Original",
      password: "TestPassword123!",
      isActive: true,
    });

    // Change the account after creation but before the delete. Because the
    // delete event's identity is read inside the delete transaction rather than
    // from a snapshot taken earlier, the event must carry the updated values.
    await adapter.executeQuery(
      "UPDATE users SET name = ?, email = ? WHERE id = ?",
      ["Renamed", "renamed@test.local", created.id]
    );

    await service.deleteUser(created.id);

    const rows = await adapter.executeQuery<EventRow>(
      "SELECT type, resource_kind, resource_id, payload FROM nextly_events WHERE type = ? AND resource_id = ?",
      ["user.deleted", created.id]
    );
    expect(rows).toHaveLength(1);
    const envelope = JSON.parse(rows[0].payload);
    expect(envelope.data.name).toBe("Renamed");
    expect(envelope.data.email).toBe("renamed@test.local");
  });
});
