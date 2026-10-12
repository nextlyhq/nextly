/**
 * A user deletion erases from a retired `accounts` or `sessions` table only
 * when the operator has named it as Nextly's.
 *
 * Nextly keeps no record that it created either table, and the Auth.js
 * (NextAuth) SQL adapters' tables have the same names and columns. So a table
 * in Nextly's shape may be a host app's, and erasing from it by shape deleted
 * that app's sign-in links on every user deletion. Run on every configured
 * dialect, against a real database, because the erasure reads each dialect's
 * catalogue and runs inside the deletion's transaction.
 *
 * The tables are written by hand: their production definitions were removed so
 * nothing creates them again, and these stand in for an upgraded database, or
 * for a host app's own tables.
 */
import type { SqlParam } from "@nextlyhq/adapter-drizzle/types";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { getDialectTables } from "../../database/index";
import { UserMutationService } from "../../domains/users/services/user-mutation-service";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { ERASE_RETIRED_AUTH_TABLES_ENV } from "../retired-auth-tables";

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** The slice of the Drizzle handle these tests use. */
interface TestDb {
  select: (fields: Record<string, unknown>) => {
    from: (table: unknown) => {
      where: (condition: unknown) => Promise<Record<string, unknown>[]>;
    };
  };
  insert: (table: unknown) => { values: (row: unknown) => Promise<unknown> };
}

describe.each(getConfiguredTestDialects())(
  "erasing a deleted user from the retired auth tables (%s)",
  (dialect: TestDialect) => {
    let handle: TestNextly;
    let users: UserMutationService;
    const tables = getDialectTables(dialect);
    const db = () => handle.adapter.getDrizzle() as unknown as TestDb;
    /** The `n`th bound parameter of a hand-written statement. */
    const param = (n: number) => (dialect === "postgresql" ? `$${n}` : "?");
    /** MySQL cannot index an unbounded `TEXT` column. */
    const key = dialect === "mysql" ? "VARCHAR(191)" : "TEXT";

    async function run(sql: string, params: SqlParam[] = []) {
      return handle.adapter.executeQuery(sql, params);
    }

    /** `accounts` and `sessions` in the shape Nextly and Auth.js share. */
    async function createAuthShapedTables(): Promise<void> {
      await run(
        `CREATE TABLE accounts (id ${key} PRIMARY KEY, user_id ${key} NOT NULL,
           type TEXT, provider TEXT NOT NULL, provider_account_id TEXT NOT NULL,
           access_token TEXT)`
      );
      await run(
        `CREATE TABLE sessions (session_token ${key} PRIMARY KEY,
           user_id ${key} NOT NULL, expires BIGINT NOT NULL)`
      );
    }

    /** A user with a row in each table, as a sign-in once left them. */
    async function leavingWithRows(email: string): Promise<string> {
      const leaving = await users.createLocalUser({
        email,
        name: "Leaving",
        password: "TestPassword123!",
        isActive: true,
      });
      const id = String(leaving.id);
      await run(
        `INSERT INTO accounts VALUES (${[1, 2, 3, 4, 5, 6].map(param).join(", ")})`,
        [`a-${id}`, id, "oauth", "google", `g-${id}`, "tok"]
      );
      await run(
        `INSERT INTO sessions VALUES (${[1, 2, 3].map(param).join(", ")})`,
        [`s-${id}`, id, 0]
      );
      return id;
    }

    async function rowsFor(id: string) {
      return {
        accounts: await run(
          `SELECT id FROM accounts WHERE user_id = ${param(1)}`,
          [id]
        ),
        sessions: await run(
          `SELECT session_token FROM sessions WHERE user_id = ${param(1)}`,
          [id]
        ),
      };
    }

    async function accountExists(id: string): Promise<boolean> {
      const rows = await db()
        .select({ id: tables.users.id })
        .from(tables.users)
        .where(eq(tables.users.id, id));
      return rows.length > 0;
    }

    beforeAll(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      // A sentinel user, so createLocalUser never takes its first-user branch.
      const now = new Date();
      await db().insert(tables.users).values({
        id: "sentinel",
        email: "sentinel@test.local",
        name: "Sentinel",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      users = new UserMutationService(handle.adapter, silentLogger);
    });

    afterEach(async () => {
      delete process.env[ERASE_RETIRED_AUTH_TABLES_ENV];
      await run("DROP TABLE IF EXISTS accounts");
      await run("DROP TABLE IF EXISTS sessions");
    });

    afterAll(async () => {
      await handle?.destroy();
    });

    it("leaves an unnamed table of the shared shape alone, and still deletes", async () => {
      // An Auth.js host's tables: nothing records that Nextly made them, so
      // their rows are that app's, not this deletion's.
      await createAuthShapedTables();
      const id = await leavingWithRows("unnamed-leaving@test.local");

      await users.deleteUser(id);

      expect(await accountExists(id)).toBe(false);
      expect(await rowsFor(id)).toEqual({
        accounts: [{ id: `a-${id}` }],
        sessions: [{ session_token: `s-${id}` }],
      });
    });

    it("erases from the tables the operator named as Nextly's", async () => {
      // The control: an erasure that never ran would pass the case above.
      process.env[ERASE_RETIRED_AUTH_TABLES_ENV] = "accounts, sessions";
      await createAuthShapedTables();
      const id = await leavingWithRows("named-leaving@test.local");

      await users.deleteUser(id);

      expect(await accountExists(id)).toBe(false);
      expect(await rowsFor(id)).toEqual({ accounts: [], sessions: [] });
    });

    it("erases only from the table named", async () => {
      process.env[ERASE_RETIRED_AUTH_TABLES_ENV] = "sessions";
      await createAuthShapedTables();
      const id = await leavingWithRows("one-named-leaving@test.local");

      await users.deleteUser(id);

      expect(await rowsFor(id)).toEqual({
        accounts: [{ id: `a-${id}` }],
        sessions: [],
      });
    });

    it("leaves a named table of another shape alone, and still deletes", async () => {
      // A DELETE ... WHERE user_id against a table without the column would
      // fail, and take the deletion with it.
      process.env[ERASE_RETIRED_AUTH_TABLES_ENV] = "accounts";
      await run(
        `CREATE TABLE accounts (id ${key} PRIMARY KEY, owner_id TEXT, balance INTEGER)`
      );
      await run(
        `INSERT INTO accounts VALUES (${[1, 2, 3].map(param).join(", ")})`,
        ["host-1", "someone", 100]
      );
      const leaving = await users.createLocalUser({
        email: "other-shape-leaving@test.local",
        name: "Leaving",
        password: "TestPassword123!",
        isActive: true,
      });

      await users.deleteUser(leaving.id);

      expect(await accountExists(String(leaving.id))).toBe(false);
      expect(await run("SELECT id FROM accounts")).toEqual([{ id: "host-1" }]);
    });
  }
);
