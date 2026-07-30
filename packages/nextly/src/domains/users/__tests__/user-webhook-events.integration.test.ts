/**
 * End-to-end proof that the user mutation service emits `user.created` and
 * `user.deleted` outbox events atomically with the account change, and that the
 * recorded payload is PII-safe (identity + roles, never the password hash).
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
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

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
  // Cast to any because this test only imports the sqlite adapter; the full
  // DrizzleAdapter type lives in @nextlyhq/adapter-drizzle and importing it here
  // would add a dev dep just for a variable annotation (mirrors the sibling
  // user-mutation transaction integration test).
  let adapter: any;
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

  it("records a PII-safe user.created event in the same transaction", async () => {
    setWebhookAuditEnabled(true);

    const created = await service.createLocalUser({
      email: "hook-create@test.local",
      name: "Hooked",
      password: "TestPassword123!",
      isActive: true,
    });

    const rows = await adapter.executeQuery<EventRow>(
      "SELECT type, resource_kind, resource_id, payload FROM nextly_events WHERE type = ? AND resource_id = ?",
      ["user.created", created.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].resource_kind).toBe("user");

    const envelope = JSON.parse(rows[0].payload);
    expect(envelope.data.email).toBe("hook-create@test.local");
    expect(envelope.data.name).toBe("Hooked");
    // The password hash and any token must never ride in the payload.
    expect(rows[0].payload).not.toMatch(/passwordHash|password_hash|token/i);
  });

  it("records user.deleted with the removed account's identity", async () => {
    setWebhookAuditEnabled(true);
    const created = await service.createLocalUser({
      email: "hook-delete@test.local",
      name: "ToDelete",
      password: "TestPassword123!",
      isActive: true,
    });

    await service.deleteUser(created.id);

    const rows = await adapter.executeQuery<EventRow>(
      "SELECT type, resource_kind, resource_id, payload FROM nextly_events WHERE type = ?",
      ["user.deleted"]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].resource_id).toBe(created.id);
    const envelope = JSON.parse(rows[0].payload);
    expect(envelope.data.email).toBe("hook-delete@test.local");
  });
});
