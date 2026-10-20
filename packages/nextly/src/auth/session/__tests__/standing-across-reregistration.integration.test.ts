/**
 * An account's standing is read again once the change that ends its sessions
 * commits, even when Nextly's services are registered again, with a new
 * adapter, while that change's transaction is open.
 *
 * Registering services again (a configuration change, a reload in
 * development) replaces the adapter the standing cache reads through. Two
 * moments matter. If it happens before the change forgets the account, the
 * transaction is open on an adapter the cache may never have served, and only
 * that adapter can say whether it has committed. If it happens after, the
 * cache the change marked is replaced by a new one. Either way no read begun
 * while the change is uncommitted may be kept.
 *
 * PostgreSQL and MySQL only: SQLite queues the read behind the open
 * transaction, so the case cannot arise there.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { AsyncResource } from "node:async_hooks";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it } from "vitest";

import { createAdapter } from "../../../database/factory";
import { getDialectTables } from "../../../database/index";
import { container } from "../../../di/container";
import {
  updateUserEndingSessions,
  type PasswordWriteTx,
} from "../../../domains/users/services/password-write";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  SESSION_STANDING_TTL_MS,
  accountIsActive,
  resetSessionStandingForTests,
} from "../session-standing";

let current: TestNextly | undefined;
let second: DrizzleAdapter | undefined;
afterEach(async () => {
  resetSessionStandingForTests();
  await second?.disconnect();
  second = undefined;
  await current?.destroy();
  current = undefined;
});

/**
 * Another request: a scope made here, outside the writer's transaction, so
 * what runs in it has that request's async context and not the writer's.
 */
function anotherRequest() {
  const scope = new AsyncResource("another-request");
  return <T>(work: () => T): T => scope.runInAsyncScope(work);
}

/** The Drizzle handle's own transaction, as core's services open theirs. */
interface Transactor {
  transaction<T>(work: (tx: PasswordWriteTx) => Promise<T>): Promise<T>;
}

/** Register the services' adapter again, as a re-registration does. */
function registerAdapter(adapter: DrizzleAdapter): void {
  // `register`, not `registerSingleton`: a singleton factory would keep
  // handing out the instance it built first.
  container.register("adapter", () => adapter);
}

const pooled = getConfiguredTestDialects().filter(
  dialect => dialect !== "sqlite"
);

// Shown as skipped, rather than as a file with no tests, on a run that has
// neither pooled dialect configured.
if (pooled.length === 0) {
  it.skip("runs on PostgreSQL and MySQL only", () => {});
}

describe.each(pooled)(
  "an account's standing across services registered again mid-change (%s)",
  (dialect: TestDialect) => {
    /** A booted instance, a person to deactivate, and a test clock. */
    async function setUp() {
      current = await createTestNextly({ dialect });
      const t = current;
      const direct = t.nextly as unknown as {
        users: {
          create(a: {
            email: string;
            password: string;
            data: Record<string, unknown>;
          }): Promise<{ item: { id: string } }>;
        };
      };
      // The install's first account holds super-admin and may not be
      // deactivated while it is the only one, so the subject is another.
      await direct.users.create({
        email: "owner@example.com",
        password: "Str0ng-P@ssw0rd!",
        data: { name: "Owner", isActive: true },
      });
      const { item } = await direct.users.create({
        email: "subject@example.com",
        password: "Str0ng-P@ssw0rd!",
        data: { name: "Subject", isActive: true },
      });
      const clock = { offset: 0 };
      resetSessionStandingForTests({
        now: () => performance.now() + clock.offset,
      });
      const writer = container.get<DrizzleAdapter>("adapter");
      // The adapter the services are registered with next: a second one, on
      // the same database.
      second = await createAdapter({
        type: dialect,
        url: process.env.DATABASE_URL!,
      });
      return { t, userId: item.id, clock, writer, replacement: second };
    }

    function deactivate(
      tx: PasswordWriteTx,
      userId: string,
      writer: DrizzleAdapter
    ) {
      return updateUserEndingSessions(tx, getDialectTables(dialect), dialect, {
        userId,
        set: { isActive: false, deactivatedAt: new Date() },
        adapter: writer,
      });
    }

    it("refuses the account once the change commits, when the writer's adapter was never read through", async () => {
      const { t, userId, clock, writer, replacement } = await setUp();
      const elsewhere = anotherRequest();

      const db = t.adapter.getDrizzle() as unknown as Transactor;
      await db.transaction(async tx => {
        // Registered again before the change forgets the account: the
        // cache has never read through the writer's adapter.
        registerAdapter(replacement);
        await deactivate(tx, userId, writer);
        clock.offset += SESSION_STANDING_TTL_MS + 1_000;
        // Another request still reads the committed row: active.
        expect(await elsewhere(() => accountIsActive(userId))).toBe(true);
      });

      expect(await elsewhere(() => accountIsActive(userId))).toBe(false);
      registerAdapter(writer);
    });

    it("refuses the account once the change commits, when services are registered again after it forgot", async () => {
      const { t, userId, clock, writer, replacement } = await setUp();
      const elsewhere = anotherRequest();

      const db = t.adapter.getDrizzle() as unknown as Transactor;
      await db.transaction(async tx => {
        await deactivate(tx, userId, writer);
        // Registered again after the change marked the cache: the first
        // read through the new adapter replaces that cache.
        registerAdapter(replacement);
        clock.offset += SESSION_STANDING_TTL_MS + 1_000;
        expect(await elsewhere(() => accountIsActive(userId))).toBe(true);
      });

      expect(await elsewhere(() => accountIsActive(userId))).toBe(false);
      registerAdapter(writer);
    });
  }
);
