// Integration validation for the drizzle v1 RQB v2 conversions in the
// auth/users services (object filters + `with:` traversal).
//
// Why this suite exists: the legacy auth unit suites mock service
// internals in ways that pre-date the current BaseService and fail on
// main independently of the migration — they cannot validate the
// converted query shapes. This suite runs the exact converted patterns
// against a real in-memory SQLite database wired with the REAL sqlite
// bundle relations (the same config production uses via the schema
// registry), so every pattern the services rely on is proven end to end.

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { relations as sqliteRelations } from "../../../schemas/_dialect-bundles/sqlite.relations";

function seed(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE users (id text PRIMARY KEY NOT NULL, email text NOT NULL, name text);
    CREATE TABLE roles (id text PRIMARY KEY NOT NULL, name text NOT NULL, slug text NOT NULL);
    CREATE TABLE permissions (id text PRIMARY KEY NOT NULL, action text NOT NULL, resource text NOT NULL);
    CREATE TABLE role_permissions (id text PRIMARY KEY NOT NULL, role_id text NOT NULL, permission_id text NOT NULL, created_at integer);
    CREATE TABLE user_roles (id text PRIMARY KEY NOT NULL, user_id text NOT NULL, role_id text NOT NULL, created_at integer, expires_at integer);
    CREATE TABLE role_inherits (id text PRIMARY KEY NOT NULL, parent_role_id text NOT NULL, child_role_id text NOT NULL);
    CREATE TABLE password_reset_tokens (id text PRIMARY KEY NOT NULL, token_hash text NOT NULL, identifier text NOT NULL, expires integer NOT NULL, used_at integer, created_at integer);

    INSERT INTO users VALUES ('u1', 'ada@example.com', 'Ada');
    INSERT INTO roles VALUES ('r1', 'Editor', 'editor'), ('r2', 'Admin', 'admin');
    INSERT INTO permissions VALUES ('p1', 'read', 'posts'), ('p2', 'write', 'posts');
    INSERT INTO role_permissions VALUES ('rp1', 'r1', 'p1', NULL), ('rp2', 'r1', 'p2', NULL);
    INSERT INTO user_roles VALUES ('ur1', 'u1', 'r1', NULL, NULL);
    INSERT INTO role_inherits VALUES ('ri1', 'r2', 'r1');
    INSERT INTO password_reset_tokens VALUES ('t1', 'hash1', 'ada@example.com', 9999999999, NULL, NULL);
    INSERT INTO password_reset_tokens VALUES ('t2', 'hash2', 'ada@example.com', 9999999999, 12345, NULL);
  `);
}

describe("RQB v2 conversion patterns (real sqlite + real bundle relations)", () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof makeDb>;

  function makeDb(client: Database.Database) {
    return drizzle({ client, relations: sqliteRelations });
  }

  beforeAll(() => {
    sqlite = new Database(":memory:");
    seed(sqlite);
    db = makeDb(sqlite);
  });

  afterAll(() => sqlite.close());

  it("plain equality object filter (auth-service email lookup)", async () => {
    const user = await db.query.users.findFirst({
      where: { email: "ada@example.com" },
      columns: { id: true, email: true },
    });
    expect(user).toEqual({ id: "u1", email: "ada@example.com" });
  });

  it("flattened and() pair (user-role-service duplicate check)", async () => {
    const existing = await db.query.userRoles.findFirst({
      where: { userId: "u1", roleId: "r1" },
      columns: { id: true },
    });
    expect(existing?.id).toBe("ur1");
  });

  it("and(eq, isNull) shape (auth-service reset-token lookup)", async () => {
    const token = await db.query.passwordResetTokens.findFirst({
      where: { tokenHash: "hash1", usedAt: { isNull: true } },
      columns: { id: true, identifier: true },
    });
    expect(token?.id).toBe("t1");
    const used = await db.query.passwordResetTokens.findFirst({
      where: { tokenHash: "hash2", usedAt: { isNull: true } },
    });
    expect(used).toBeUndefined();
  });

  it("inArray → { in: [...] } (role-inheritance batch descent)", async () => {
    const rows = await db.query.roleInherits.findMany({
      where: { childRoleId: { in: ["r1", "r2"] } },
      columns: { parentRoleId: true },
    });
    expect(rows).toEqual([{ parentRoleId: "r2" }]);
  });

  it("`with:` traversal (role-permission-service permission expansion)", async () => {
    const rps = await db.query.rolePermissions.findMany({
      where: { roleId: "r1" },
      with: {
        permission: { columns: { id: true, action: true, resource: true } },
      },
    });
    expect(rps).toHaveLength(2);
    expect(rps.map(rp => rp.permission?.action).sort()).toEqual([
      "read",
      "write",
    ]);
  });

  it("`with:` traversal (user-role-service role names)", async () => {
    const urs = await db.query.userRoles.findMany({
      where: { userId: "u1" },
      with: { role: { columns: { name: true } } },
    });
    expect(urs.map(ur => ur.role?.name)).toEqual(["Editor"]);
  });
});
