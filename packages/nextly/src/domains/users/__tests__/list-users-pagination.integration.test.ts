/**
 * A page of `limit` users contains `limit` USERS, whatever roles they hold.
 *
 * `listUsers` used to apply LIMIT/OFFSET to a query that left-joined `user_roles`
 * and `roles`, then grouped the rows by user. A user holding three roles
 * therefore consumed three rows of the page, which has two consequences and the
 * second is the serious one:
 *
 * - the page returns FEWER than `limit` users, with nothing saying it did; and
 * - OFFSET advances over JOINED ROWS rather than users, so page 2 starts partway
 *   through the joined result and users are SKIPPED entirely. A caller walking
 *   pages to find an account can conclude it does not exist.
 *
 * Meanwhile `total` counts base users, so `totalPages` looks right the whole
 * time and nothing in the response indicates the gap.
 *
 * This is an integration test rather than a unit test on purpose: the defect is
 * row multiplication performed by the DATABASE. Against a mocked query builder
 * the canned rows are whatever the fixture says, so a mock cannot tell the two
 * implementations apart — `user-query-service.test.ts` passes under both.
 *
 * THE SEPARATING PROPERTY is a multi-role user positioned so the inflation
 * crosses a page boundary. A fixture where everyone holds exactly one role
 * returns identical results from the broken and the fixed code, so it would pass
 * either way and prove nothing.
 */

import { existsSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getSQLiteDrizzleKit } from "../../../database/drizzle-kit-lazy";
import {
  roles as rolesSqlite,
  userRoles as userRolesSqlite,
} from "../../../schemas/rbac/sqlite";
import {
  accounts as accountsSqlite,
  users as usersSqlite,
} from "../../../schemas/users/sqlite";
import { splitStatements } from "../../schema/pipeline/sql-statement-utils";
import { UserQueryService } from "../services/user-query-service";

const TEST_DB_DIR = join(
  tmpdir(),
  `nextly-list-users-pagination-${process.pid}-${Date.now()}`
);
const TEST_DB_PATH = join(TEST_DB_DIR, "test.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

process.env.DB_DIALECT = "sqlite";
process.env.DATABASE_URL = TEST_DB_URL;

async function ddl(): Promise<string[]> {
  const kit = await getSQLiteDrizzleKit();
  const statements = await kit.generateMigration(
    await kit.generateDrizzleJson({}),
    await kit.generateDrizzleJson({
      users: usersSqlite,
      accounts: accountsSqlite,
      roles: rolesSqlite,
      userRoles: userRolesSqlite,
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

/**
 * Nine users, named so that ordering by name is the same as this array's order:
 * `user-00` … `user-08`. Sorting is by name ascending throughout, so which user
 * lands on which page is fixed rather than left to the planner.
 */
const USER_COUNT = 9;
const PAGE_SIZE = 3;
const ROLE_NAMES = ["admin", "editor", "viewer"] as const;

/**
 * Users given every role. Both sit INSIDE a page rather than at its end, so the
 * extra joined rows spill across the boundary that follows — which is what makes
 * pages 2 and 3 wrong under the old implementation rather than merely short.
 */
const MULTI_ROLE_USERS = ["user-01", "user-04"];

describe("listUsers pagination over users with several roles (real SQLite)", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;
  let query: UserQueryService;

  beforeAll(async () => {
    if (!existsSync(TEST_DB_DIR)) mkdirSync(TEST_DB_DIR, { recursive: true });
    adapter = createSqliteAdapter({ url: TEST_DB_URL });
    await adapter.connect();
    for (const stmt of await ddl()) {
      await adapter.executeQuery(stmt);
    }

    const nowEpoch = Math.floor(Date.now() / 1000);

    for (const roleName of ROLE_NAMES) {
      await adapter.executeQuery(
        `INSERT INTO roles (id, name, slug, level, is_system, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [`role-${roleName}`, roleName, roleName, 0, 0, nowEpoch, nowEpoch]
      );
    }

    for (let i = 0; i < USER_COUNT; i++) {
      const id = `user-0${i}`;
      await adapter.executeQuery(
        `INSERT INTO users (id, email, name, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, `${id}@test.local`, id, 1, nowEpoch, nowEpoch]
      );

      // Everyone gets one role; the chosen few get all three. Giving every user
      // at least one role matters: it means the fixed and broken versions return
      // the same COUNT of joined rows for the single-role users, so any
      // difference the test finds comes from the multi-role ones.
      const assigned = MULTI_ROLE_USERS.includes(id)
        ? ROLE_NAMES
        : [ROLE_NAMES[i % ROLE_NAMES.length]];
      for (const roleName of assigned) {
        await adapter.executeQuery(
          `INSERT INTO user_roles (user_id, role_id, created_at) VALUES (?, ?, ?)`,
          [id, `role-${roleName}`, nowEpoch]
        );
      }
    }

    query = new UserQueryService(adapter, silentLogger as never);
  });

  afterAll(async () => {
    try {
      await adapter?.disconnect?.();
    } catch {
      // ignore teardown close errors
    }
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  // A control on the fixture, before anything is concluded from the pages. If
  // the multi-role assignment silently failed — a bad id, a swallowed insert —
  // every user would hold one role, the mechanism would never engage, and each
  // assertion below would pass against the BROKEN implementation too.
  it("the fixture actually contains multi-role users", async () => {
    const rows = await adapter.executeQuery<{ user_id: string; n: number }>(
      `SELECT user_id, COUNT(*) AS n FROM user_roles GROUP BY user_id HAVING COUNT(*) > 1`
    );
    expect(rows.map(r => r.user_id).sort()).toEqual(
      [...MULTI_ROLE_USERS].sort()
    );
    for (const row of rows) {
      expect(Number(row.n)).toBe(ROLE_NAMES.length);
    }
  });

  it("returns a full page of distinct users when one of them holds several roles", async () => {
    const page = await query.listUsers({
      page: 1,
      limit: PAGE_SIZE,
      sortBy: "name",
      sortOrder: "asc",
    });

    expect(page.data).toHaveLength(PAGE_SIZE);
    expect(new Set(page.data!.map(u => String(u.id))).size).toBe(PAGE_SIZE);
    expect(page.data!.map(u => String(u.id))).toEqual([
      "user-00",
      "user-01",
      "user-02",
    ]);
  });

  it("walking every page visits each user exactly once", async () => {
    const seen: string[] = [];
    for (let page = 1; page <= Math.ceil(USER_COUNT / PAGE_SIZE); page++) {
      const result = await query.listUsers({
        page,
        limit: PAGE_SIZE,
        sortBy: "name",
        sortOrder: "asc",
      });
      seen.push(...result.data!.map(u => String(u.id)));
    }

    // No user skipped and none returned twice — the property a caller walking
    // pages to find an account actually depends on.
    expect(seen).toHaveLength(USER_COUNT);
    expect(new Set(seen).size).toBe(USER_COUNT);
    expect([...seen].sort()).toEqual(
      Array.from({ length: USER_COUNT }, (_, i) => `user-0${i}`)
    );
  });

  it("still attaches every role a user holds", async () => {
    const page = await query.listUsers({
      page: 1,
      limit: PAGE_SIZE,
      sortBy: "name",
      sortOrder: "asc",
    });

    const multi = page.data!.find(
      u => String(u.id) === "user-01"
    ) as unknown as {
      roles: Array<{ id: string; name: string }>;
    };
    // Fixing the page count must not cost the roles themselves — the obvious
    // wrong fix is to drop the join and return users with no roles at all.
    expect(multi.roles.map(r => r.name)).toEqual([...ROLE_NAMES].sort());

    const single = page.data!.find(
      u => String(u.id) === "user-00"
    ) as unknown as {
      roles: Array<{ id: string; name: string }>;
    };
    expect(single.roles).toHaveLength(1);
  });

  it("reports a total counting users rather than joined rows", async () => {
    const page = await query.listUsers({ page: 1, limit: PAGE_SIZE });

    expect(page.meta.total).toBe(USER_COUNT);
    expect(page.meta.totalPages).toBe(Math.ceil(USER_COUNT / PAGE_SIZE));
  });
});
