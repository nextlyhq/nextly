/**
 * That `deleteUser` reaches the delivery log, including rows that appear after
 * its transaction commits.
 *
 * The unit suite drives `eraseRecipientDeliveries` directly. That proves the
 * helper works and proves nothing about whether the service calls it — a suite
 * built that way stays green when the production call is deleted, because the
 * subject it exercises is the one it constructed rather than the one that
 * ships. This drives the real `UserMutationService` against real SQLite so the
 * production path is what is under test.
 *
 * The second row is the point. `deleteUser` erases inside its transaction and
 * again after the commit, because a send already in flight can insert its row
 * after the in-transaction pass has chosen its matches. Here that row is
 * inserted deterministically at exactly that moment, by wrapping the adapter's
 * `transaction` so the insert lands after the callback resolves and before the
 * post-commit block runs. Delete the post-commit sweep and this row survives
 * with a live digest, which is the failure the sweep exists to prevent.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";

import { getSQLiteDrizzleKit } from "../../../database/drizzle-kit-lazy";
import { getDialectTables } from "../../../database/index";
import { SchemaRegistry } from "../../../database/schema-registry";
import { emailDeliveriesSqlite } from "../../../schemas/email-deliveries/sqlite";
import { emailProvidersSqlite } from "../../../schemas/email-providers/sqlite";
import {
  roles as rolesSqlite,
  userRoles as userRolesSqlite,
} from "../../../schemas/rbac/sqlite";
import {
  accounts as accountsSqlite,
  users as usersSqlite,
} from "../../../schemas/users/sqlite";
import { nextlyEvents as eventsSqlite } from "../../../schemas/webhooks/sqlite";
import { splitStatements } from "../../schema/pipeline/sql-statement-utils";
import { UserMutationService } from "../../users/services/user-mutation-service";
import { ERASED_RECIPIENT_HASH, recipientDigest } from "../delivery-record";

// `recipientDigest` reads the validated environment, which is checked lazily on
// first ACCESS and refuses a configuration with no `DATABASE_URL`. This suite
// drives SQLite through an explicit adapter URL and never needs one, so this
// exists only so the digest function can be called. Assigned rather than
// overwritten, matching how the shared setup supplies `NEXTLY_SECRET`.
process.env.DATABASE_URL ??= "postgres://unused@localhost:5432/unused";

const TEST_DB_DIR = ".test-dbs";
const TEST_DB_URL = `${TEST_DB_DIR}/delete-user-erases-deliveries.db`;

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

async function ddl(): Promise<string[]> {
  const kit = await getSQLiteDrizzleKit();
  const statements = await kit.generateMigration(
    await kit.generateDrizzleJson({}),
    await kit.generateDrizzleJson({
      users: usersSqlite,
      accounts: accountsSqlite,
      roles: rolesSqlite,
      userRoles: userRolesSqlite,
      // The mutation service records user.deleted to the outbox whenever
      // recording is active, and that gate is process-wide.
      nextlyEvents: eventsSqlite,
      // email_deliveries declares a provider reference, so its generated DDL
      // names email_providers. Creating one without the other leaves a foreign
      // key pointing at nothing, which SQLite reports on first use.
      emailProviders: emailProvidersSqlite,
      emailDeliveries: emailDeliveriesSqlite,
    })
  );
  return splitStatements(statements);
}

describe("deleteUser erases the delivery log (real SQLite)", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;
  let users: UserMutationService;

  async function insertDelivery(address: string): Promise<void> {
    await adapter.executeQuery(
      `INSERT INTO email_deliveries
         (id, provider_type, recipient_hash, recipient_kind, status,
          attempt_count, retention_class, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        "smtp",
        recipientDigest(address),
        "to",
        "sent",
        1,
        "operational",
        Math.floor(Date.now() / 1000),
      ]
    );
  }

  async function storedHashes(): Promise<string[]> {
    const rows = await adapter.executeQuery<{ recipient_hash: string }>(
      `SELECT recipient_hash FROM email_deliveries`
    );
    return rows.map(row => row.recipient_hash);
  }

  beforeAll(async () => {
    if (!existsSync(TEST_DB_DIR)) mkdirSync(TEST_DB_DIR, { recursive: true });
    rmSync(TEST_DB_URL, { force: true });
    adapter = createSqliteAdapter({ url: TEST_DB_URL });
    await adapter.connect();
    for (const stmt of await ddl()) {
      await adapter.executeQuery(stmt);
    }
    // A sentinel so createLocalUser never takes its "first user ever" branch,
    // which needs more of the RBAC wiring than this suite installs.
    const nowEpoch = Math.floor(Date.now() / 1000);
    await adapter.executeQuery(
      `INSERT INTO users (id, email, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["sentinel", "sentinel@test.local", "Sentinel", 1, nowEpoch, nowEpoch]
    );
    const registry = new SchemaRegistry("sqlite");
    registry.registerStaticSchemas(getDialectTables("sqlite"));
    adapter.setTableResolver(registry);

    users = new UserMutationService(adapter, silentLogger);
  }, 60_000);

  afterAll(async () => {
    try {
      await adapter?.disconnect?.();
    } catch {
      // ignore teardown close errors
    }
    rmSync(TEST_DB_URL, { force: true });
  });

  it("erases rows written before the deletion, and rows that land after its transaction commits", async () => {
    const address = `erase-${randomUUID()}@example.com`;
    const created = await users.createLocalUser({
      email: address,
      name: "Erase Me",
      password: "CorrectHorseBattery1!",
    });

    await insertDelivery(address);
    // The precondition. Without it a later "no live digest" assertion is
    // satisfied by a row that was never written, and the whole test passes on
    // an empty table.
    expect(await storedHashes()).toContain(recipientDigest(address));

    // Insert a second row at the moment a send already in flight would commit:
    // after the deletion transaction has closed, before the post-commit sweep.
    // The in-transaction erasure cannot have selected it, so only the sweep can
    // reach it.
    // Hooked at the COMMIT itself rather than at `adapter.transaction`, because
    // on SQLite `withTransaction` runs a manual BEGIN IMMEDIATE / COMMIT on the
    // drizzle handle and never calls the adapter method. Injecting immediately
    // after the commit resolves puts the row exactly where an in-flight send's
    // would land: too late for the in-transaction erasure, in time for nothing
    // but the post-commit sweep.
    // Hooked on `getDrizzle` rather than on a handle, because `BaseService.db`
    // is a getter that calls `adapter.getDrizzle()` afresh on every access — so
    // patching one returned instance never reaches the one the commit runs on.
    // `withTransaction` on SQLite issues a manual BEGIN IMMEDIATE / COMMIT, and
    // injecting right after that COMMIT resolves puts the row exactly where an
    // in-flight send's would land: too late for the in-transaction erasure, and
    // reachable by nothing but the post-commit sweep.
    const realGetDrizzle = adapter.getDrizzle.bind(adapter);
    let injected = false;
    const wrap = (handle: Record<string, unknown>) => {
      const realRun = (handle.run as (q: unknown) => Promise<unknown>).bind(
        handle
      );
      return new Proxy(handle, {
        get(target, prop, receiver) {
          if (prop !== "run") return Reflect.get(target, prop, receiver);
          return async (query: unknown) => {
            const result = await realRun(query);
            if (!injected && JSON.stringify(query).includes("COMMIT")) {
              injected = true;
              await insertDelivery(address);
            }
            return result;
          };
        },
      });
    };
    adapter.getDrizzle = ((relations?: unknown) =>
      wrap(
        realGetDrizzle(relations as never) as Record<string, unknown>
      )) as typeof adapter.getDrizzle;

    try {
      await users.deleteUser(created.id);
    } finally {
      adapter.getDrizzle = realGetDrizzle;
    }

    expect(injected).toBe(true);
    const after = await storedHashes();
    // Both rows survive as records and neither still names the person.
    expect(after.filter(h => h === ERASED_RECIPIENT_HASH)).toHaveLength(2);
    expect(after).not.toContain(recipientDigest(address));
  }, 60_000);
});
