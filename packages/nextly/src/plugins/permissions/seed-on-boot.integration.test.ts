/**
 * Custom permissions are seeded at boot via seedPermissionsAndRolePresets, which
 * both boot paths run before they serve.
 *
 * The harness boots a real Nextly on in-memory SQLite but does not auto-create
 * the core RBAC tables; we bootstrap them with `generateSqliteCoreTableStatements`
 * (same helper the auth integration tests use) so seeding writes to live tables.
 */
import { afterEach, describe, expect, it } from "vitest";

import { generateSqliteCoreTableStatements } from "../../database/sqlite-core-tables";
import { seedPermissionsAndRolePresets } from "../../init/seed-permissions";
import { definePlugin } from "../../plugins";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("custom permission seeding on boot", () => {
  it("seeds a plugin's custom permission via the boot's seeding", async () => {
    const seoPlugin = definePlugin({
      name: "@acme/seo",
      version: "1.0.0",
      nextly: ">=0.0.1",
      contributes: {
        permissions: [
          { action: "manage", resource: "seo", label: "Manage SEO" },
        ],
      },
    });

    current = await createTestNextly({ plugins: [seoPlugin] });
    for (const statement of generateSqliteCoreTableStatements()) {
      await current.adapter.executeQuery(statement);
    }

    await seedPermissionsAndRolePresets(); // idempotent; deterministically drives seeding

    const rows = await current.adapter.executeQuery<{ slug: string }>(
      "SELECT slug FROM permissions WHERE slug = 'manage-seo'"
    );
    expect(rows).toHaveLength(1);
  });
});
