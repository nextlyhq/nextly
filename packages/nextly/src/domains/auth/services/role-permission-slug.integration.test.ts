/**
 * `addPermissionToRole` decides a permission's identity when it creates one.
 *
 * The method looks its permission up by `(action, resource)` and only composes
 * a slug on the branch where no row exists yet — so the composition is
 * invisible to this method and load-bearing for every other one. Everything
 * that authorizes reads the slug: `hasPermission("read-users")`, the route
 * middleware, the guards. A row written as `users-read` is therefore not a
 * cosmetic difference; it is a permission nothing can find.
 *
 * The failure is quiet in both directions. Composing backwards denies rather
 * than escalates, so no request misbehaves — the grant simply never applies,
 * while the admin panel lists it as assigned. And the two in-tree callers pass
 * an explicit slug, so the reversed branch was only reachable from the REST
 * dispatcher, which supplies neither a name nor a slug.
 *
 * Run against a real adapter rather than the in-memory fixture because the
 * branch under test creates its row inside a transaction.
 */
import { afterEach, describe, expect, it } from "vitest";

import { generateSqliteCoreTableStatements } from "../../../database/sqlite-core-tables";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { Logger } from "../../../services/shared";

import { RolePermissionService } from "./role-permission-service";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function bootWithCoreTables(): Promise<TestNextly> {
  const handle = await createTestNextly({});
  for (const statement of generateSqliteCoreTableStatements()) {
    await handle.adapter.executeQuery(statement);
  }
  return handle;
}

/** The permission row for a pair, read straight out of the database. */
async function readPermission(
  handle: TestNextly,
  action: string,
  resource: string
): Promise<{ slug: string; name: string } | undefined> {
  const rows = (await handle.adapter.executeQuery(
    `SELECT slug, name FROM permissions WHERE action = '${action}' AND resource = '${resource}'`
  )) as unknown as Array<{ slug: string; name: string }>;
  const row = rows[0];
  return row ? { slug: String(row.slug), name: String(row.name) } : undefined;
}

async function seedRole(handle: TestNextly, id: string, slug: string) {
  await handle.adapter.executeQuery(
    `INSERT INTO roles (id, name, slug, level, is_system, created_at, updated_at) VALUES ('${id}', '${slug}', '${slug}', 10, 0, 0, 0)`
  );
}

function serviceFor(handle: TestNextly): RolePermissionService {
  return new RolePermissionService(
    handle.adapter,
    console as unknown as Logger
  );
}

describe("addPermissionToRole, creating the permission", () => {
  it("writes the slug every authorization check looks up", async () => {
    current = await bootWithCoreTables();
    await seedRole(current, "role-read", "editor");

    await serviceFor(current).addPermissionToRole("role-read", {
      action: "read",
      resource: "users",
    });

    // The literal, not a re-derivation. Comparing against a composed string
    // would pass just as happily if both sides were reversed together.
    expect((await readPermission(current, "read", "users"))?.slug).toBe(
      "read-users"
    );
  });

  it("keeps a hyphenated resource whole", async () => {
    // Reversed, `api-keys-delete` reads back as action `api` — the parser
    // splits on the FIRST hyphen — so the resource is corrupted as well as
    // misordered.
    current = await bootWithCoreTables();
    await seedRole(current, "role-ops", "ops");

    await serviceFor(current).addPermissionToRole("role-ops", {
      action: "delete",
      resource: "api-keys",
    });

    const created = await readPermission(current, "delete", "api-keys");
    expect(created?.slug).toBe("delete-api-keys");
    expect(created?.name).toBe("Delete Api Keys");
  });

  it("repairs a row an older version wrote backwards", async () => {
    // Identity is `(action, resource)`, so create-if-missing never reaches a
    // row that already exists — an upgraded install would keep the unreachable
    // slug the bug wrote, and the fix would only ever help new databases.
    current = await bootWithCoreTables();
    await seedRole(current, "role-legacy-slug", "legacy");
    await current.adapter.executeQuery(
      `INSERT INTO permissions (id, name, slug, action, resource, created_at, updated_at) VALUES ('perm-legacy', 'Export Reports', 'reports-export', 'export', 'reports', 0, 0)`
    );

    await serviceFor(current).addPermissionToRole("role-legacy-slug", {
      action: "export",
      resource: "reports",
    });

    expect((await readPermission(current, "export", "reports"))?.slug).toBe(
      "export-reports"
    );
  });

  it("leaves a deliberately custom slug alone", async () => {
    // Only the exactly-reversed form is repaired. A slug its declarer chose —
    // here one that does not follow the convention at all — is not this bug's
    // doing, and renaming it would break whoever declared it.
    current = await bootWithCoreTables();
    await seedRole(current, "role-custom", "custom");
    await current.adapter.executeQuery(
      `INSERT INTO permissions (id, name, slug, action, resource, created_at, updated_at) VALUES ('perm-custom', 'Manage Api Keys', 'manage-api-keys', 'update', 'api-keys', 0, 0)`
    );

    await serviceFor(current).addPermissionToRole("role-custom", {
      action: "update",
      resource: "api-keys",
    });

    expect((await readPermission(current, "update", "api-keys"))?.slug).toBe(
      "manage-api-keys"
    );
  });

  it("does not repair a row when the caller states a slug", async () => {
    // Repair is something this method does only while composing the slug
    // itself. A caller that states one owns it, and second-guessing that would
    // rename a row out from under whoever declared it.
    current = await bootWithCoreTables();
    await seedRole(current, "role-stated", "stated");
    await current.adapter.executeQuery(
      `INSERT INTO permissions (id, name, slug, action, resource, created_at, updated_at) VALUES ('perm-stated', 'Export Logs', 'logs-export', 'export', 'logs', 0, 0)`
    );

    await serviceFor(current).addPermissionToRole("role-stated", {
      action: "export",
      resource: "logs",
      slug: "logs-export",
    });

    expect((await readPermission(current, "export", "logs"))?.slug).toBe(
      "logs-export"
    );
  });

  it("prefers an explicit slug over the composed one", async () => {
    current = await bootWithCoreTables();
    await seedRole(current, "role-legacy", "legacy");

    await serviceFor(current).addPermissionToRole("role-legacy", {
      action: "publish",
      resource: "posts",
      slug: "publish-posts-legacy",
    });

    expect((await readPermission(current, "publish", "posts"))?.slug).toBe(
      "publish-posts-legacy"
    );
  });
});
