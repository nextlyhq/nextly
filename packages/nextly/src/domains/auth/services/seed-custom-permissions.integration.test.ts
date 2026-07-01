/**
 * PermissionSeedService.seedCustomPermissions (D36).
 *
 * The harness (`createTestNextly`) boots a real Nextly on in-memory SQLite but
 * only creates code-first collection tables — the core RBAC tables (permissions,
 * roles, role_permissions, …) are not auto-synced on SQLite. We bootstrap them
 * with the shared `generateSqliteCoreTableStatements` DDL (the same helper the
 * auth-events integration test uses) so the seeder runs against live tables.
 */
import { afterEach, describe, expect, it } from "vitest";

import { generateSqliteCoreTableStatements } from "../../../database/sqlite-core-tables";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

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

describe("seedCustomPermissions", () => {
  it("seeds a new custom permission and is idempotent", async () => {
    current = await bootWithCoreTables();
    const seed = current.getService("permissionSeedService");

    const first = await seed.seedCustomPermissions([
      {
        action: "export",
        resource: "submissions",
        slug: "export-submissions",
        name: "Export Submissions",
        owner: "@acme/x",
      },
    ]);
    expect(first).toMatchObject({ created: 1, skipped: 0 });
    expect(first.newPermissionIds).toHaveLength(1);

    const second = await seed.seedCustomPermissions([
      {
        action: "export",
        resource: "submissions",
        slug: "export-submissions",
        name: "Export Submissions",
        owner: "@acme/x",
      },
    ]);
    expect(second).toMatchObject({ created: 0, skipped: 1 });
  });
});
