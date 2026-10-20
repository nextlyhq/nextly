/**
 * An account's standing is read again once the change that ends its sessions
 * commits, however long that change's transaction stays open.
 *
 * The writer forgets the account's cached standing inside its transaction.
 * On PostgreSQL and MySQL a request on another connection before the commit
 * still reads the row as it was, and if the transaction is held open longer
 * than the cache's lifetime (waiting on a lock, say), that read must not be
 * kept: the instance that made the change refuses the account as soon as the
 * change commits. SQLite queues the read behind the transaction instead, so
 * the case cannot arise there and is not run.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { AsyncResource } from "node:async_hooks";

import { afterEach, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../database/index";
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
afterEach(async () => {
  resetSessionStandingForTests();
  await current?.destroy();
  current = undefined;
});

/**
 * Another request: a scope made here, outside the writer's transaction, so
 * what runs in it has that request's async context and not the writer's,
 * as a request arriving on another connection does.
 */
function anotherRequest() {
  const scope = new AsyncResource("another-request");
  return <T>(work: () => T): T => scope.runInAsyncScope(work);
}

/** The Drizzle handle's own transaction, as core's services open theirs. */
interface Transactor {
  transaction<T>(work: (tx: PasswordWriteTx) => Promise<T>): Promise<T>;
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
  "an account's standing after the change that ends its sessions commits (%s)",
  (dialect: TestDialect) => {
    it("refuses the account once a deactivation held open past the cache's lifetime commits", async () => {
      current = await createTestNextly({ dialect });
      const t = current;
      const direct = t.nextly as unknown as {
        users: {
          create(a: {
            email: string;
            password: string;
            data: Record<string, unknown>;
          }): Promise<{
            item: { id: string };
          }>;
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

      let offset = 0;
      resetSessionStandingForTests({
        now: () => performance.now() + offset,
      });
      // The answer every request served from memory until the change.
      expect(await accountIsActive(item.id)).toBe(true);

      const elsewhere = anotherRequest();
      const db = t.adapter.getDrizzle() as unknown as Transactor;
      await db.transaction(async tx => {
        await updateUserEndingSessions(tx, getDialectTables(dialect), dialect, {
          userId: item.id,
          set: { isActive: false, deactivatedAt: new Date() },
          adapter: t.adapter,
        });
        // The control: the writer's transaction is open in its own flow and
        // not in the other request's, so the read below is that request's.
        expect(t.adapter.transactionOpenInFlow()).toBe(true);
        expect(elsewhere(() => t.adapter.transactionOpenInFlow())).toBe(false);
        // Held open past the lifetime before it commits.
        offset += SESSION_STANDING_TTL_MS + 1_000;
        // The other request still reads the committed row: active.
        expect(await elsewhere(() => accountIsActive(item.id))).toBe(true);
      });

      expect(await elsewhere(() => accountIsActive(item.id))).toBe(false);
    });

    it("refuses the account once the change commits when no request had read it before", async () => {
      // The change is this process's first reason to look at the account, so
      // there is nothing cached to forget; the first read is the one made
      // while the change is still uncommitted.
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
      let offset = 0;
      resetSessionStandingForTests({
        now: () => performance.now() + offset,
      });

      const elsewhere = anotherRequest();
      const db = t.adapter.getDrizzle() as unknown as Transactor;
      await db.transaction(async tx => {
        await updateUserEndingSessions(tx, getDialectTables(dialect), dialect, {
          userId: item.id,
          set: { isActive: false, deactivatedAt: new Date() },
          adapter: t.adapter,
        });
        offset += SESSION_STANDING_TTL_MS + 1_000;
        expect(await elsewhere(() => accountIsActive(item.id))).toBe(true);
      });

      expect(await elsewhere(() => accountIsActive(item.id))).toBe(false);
    });
  }
);
