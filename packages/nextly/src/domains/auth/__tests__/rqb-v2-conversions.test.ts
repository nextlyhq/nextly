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

import { getSQLiteDrizzleKit } from "../../../database/drizzle-kit-lazy";
import { getDialectTables } from "../../../database/index";
import { splitStatements } from "../../../domains/schema/pipeline/sql-statement-utils";
import { relations as sqliteRelations } from "../../../schemas/_dialect-bundles/sqlite.relations";

// The schema comes from the PRODUCTION sqlite table definitions, turned
// into DDL by drizzle-kit's generateMigration (never hand-copied CREATE
// TABLE — it drifts; see .claude/rules/integration-tests.md). Rows are
// inserted with explicit column lists because the production tables carry
// more columns than the fixtures use.
async function seed(sqlite: Database.Database) {
  const kit = await getSQLiteDrizzleKit();
  const statements = await kit.generateMigration(
    await kit.generateDrizzleJson({}),
    await kit.generateDrizzleJson(getDialectTables("sqlite"))
  );
  for (const raw of statements) {
    for (const stmt of splitStatements([raw])) sqlite.exec(stmt);
  }
  sqlite.exec(`
    INSERT INTO users (id, email, name, is_active, created_at, updated_at)
      VALUES ('u1', 'ada@example.com', 'Ada', 1, 1700000000, 1700000000);
    INSERT INTO roles (id, name, slug, level, created_at, updated_at) VALUES ('r1', 'Editor', 'editor', 10, 1700000000, 1700000000), ('r2', 'Admin', 'admin', 90, 1700000000, 1700000000);
    INSERT INTO permissions (id, name, slug, action, resource, created_at, updated_at) VALUES ('p1', 'Read posts', 'read-posts', 'read', 'posts', 1700000000, 1700000000), ('p2', 'Write posts', 'write-posts', 'write', 'posts', 1700000000, 1700000000);
    INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES ('rp1', 'r1', 'p1', 1700000000), ('rp2', 'r1', 'p2', 1700000000);
    INSERT INTO user_roles (id, user_id, role_id, created_at) VALUES ('ur1', 'u1', 'r1', 1700000000);
    INSERT INTO role_inherits (id, parent_role_id, child_role_id) VALUES ('ri1', 'r2', 'r1');
    INSERT INTO password_reset_tokens (id, token_hash, identifier, expires, created_at) VALUES (1, 'hash1', 'ada@example.com', 9999999999, 1700000000);
    INSERT INTO password_reset_tokens (id, token_hash, identifier, expires, used_at, created_at) VALUES (2, 'hash2', 'ada@example.com', 9999999999, 12345, 1700000000);
  `);
}

describe("RQB v2 conversion patterns (real sqlite + real bundle relations)", () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof makeDb>;

  function makeDb(client: Database.Database) {
    return drizzle({ client, relations: sqliteRelations });
  }

  beforeAll(async () => {
    sqlite = new Database(":memory:");
    await seed(sqlite);
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
    expect(token?.id).toBe(1);
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
