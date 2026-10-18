/**
 * The first administrator the CLI command creates, against a real database on
 * every configured dialect: created on an empty install and able to sign in
 * at the login endpoint, refused once an administrator exists, and still
 * created over an install whose only account is a role-less self-registered
 * one.
 *
 * Driven through `firstAdminSetupFor` over the harness's adapter, the same
 * steps the command runs over its own connection.
 */

// The login handler signs with `env.NEXTLY_SECRET`; set before any module reads env.
process.env.NEXTLY_SECRET = "test-secret-must-be-at-least-32-characters-long!!";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it } from "vitest";

import { buildAuthRouterDeps } from "../../../auth/handlers/deps-bridge";
import { handleLogin } from "../../../auth/handlers/login";
import { getDialectTables } from "../../../database/index";
import { generateSqliteCoreTableStatements } from "../../../database/sqlite-core-tables";
import { superAdminRoleHeld } from "../../../domains/users/services/last-super-admin";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createFirstAdministrator, firstAdminSetupFor } from "../create-admin";

const ORIGIN = "http://localhost:3000";
const PASSWORD = "Correct-Horse-Battery-9";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** The narrow view of the query builder these assertions use. */
interface UsersDb {
  select(projection: Record<string, unknown>): {
    from(table: unknown): Promise<Array<{ email: string }>>;
  };
  insert(table: unknown): {
    values(row: Record<string, unknown>): Promise<unknown>;
  };
}

describe.each(getConfiguredTestDialects())(
  "nextly users:create-admin (%s)",
  (dialect: TestDialect) => {
    async function emptyInstall(): Promise<TestNextly> {
      current = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      if (dialect === "sqlite") {
        for (const statement of generateSqliteCoreTableStatements()) {
          await current.adapter.executeQuery(statement);
        }
      }
      return current;
    }

    function setupOf(t: TestNextly) {
      return firstAdminSetupFor(t.adapter as unknown as DrizzleAdapter);
    }

    function db(t: TestNextly): UsersDb {
      return t.adapter.getDrizzle() as unknown as UsersDb;
    }

    async function emails(t: TestNextly): Promise<string[]> {
      const rows = await db(t)
        .select({ email: getDialectTables().users.email })
        .from(getDialectTables().users);
      return rows.map(row => row.email).sort();
    }

    async function signIn(t: TestNextly, email: string): Promise<number> {
      const deps = buildAuthRouterDeps(
        t.getService as unknown as (name: string) => unknown
      );
      const res = await handleLogin(
        new Request(`${ORIGIN}/admin/api/auth/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: ORIGIN,
            cookie: "nextly_csrf=tok",
          },
          body: JSON.stringify({ csrfToken: "tok", email, password: PASSWORD }),
        }),
        deps
      );
      return res.status;
    }

    it("creates the first administrator on an empty install, who can then sign in", async () => {
      const t = await emptyInstall();
      const outcome = await createFirstAdministrator(setupOf(t), {
        email: "ada@example.com",
        name: "Ada",
        password: PASSWORD,
      });
      expect(outcome).toBe("created");
      expect(
        await superAdminRoleHeld(
          t.adapter.getDrizzle() as unknown as Parameters<
            typeof superAdminRoleHeld
          >[0],
          getDialectTables()
        )
      ).toBe(true);
      expect(await signIn(t, "ada@example.com")).toBe(200);
    });

    it("refuses, creating nothing, once the install has an administrator", async () => {
      const t = await emptyInstall();
      const setup = setupOf(t);
      await createFirstAdministrator(setup, {
        email: "ada@example.com",
        name: "Ada",
        password: PASSWORD,
      });
      const before = await emails(t);
      const outcome = await createFirstAdministrator(setup, {
        email: "eve@example.com",
        name: "Eve",
        password: PASSWORD,
      });
      expect(outcome).toBe("administrator-exists");
      expect(await emails(t)).toEqual(before);
    });

    it("still creates the first administrator over a role-less self-registered account", async () => {
      const t = await emptyInstall();
      // As a self-registration leaves it: an account, and no role.
      await db(t).insert(getDialectTables().users).values({
        id: "self-registered",
        email: "visitor@example.com",
        name: "Visitor",
        emailVerified: new Date(),
        isActive: true,
      });
      const outcome = await createFirstAdministrator(setupOf(t), {
        email: "ada@example.com",
        name: "Ada",
        password: PASSWORD,
      });
      expect(outcome).toBe("created");
      expect(await emails(t)).toEqual([
        "ada@example.com",
        "visitor@example.com",
      ]);
      expect(await signIn(t, "ada@example.com")).toBe(200);
    });
  }
);
