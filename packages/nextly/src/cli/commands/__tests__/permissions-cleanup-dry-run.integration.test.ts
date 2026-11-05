/**
 * `nextly permissions:cleanup --dry-run` names each permission a real cleanup
 * deletes, with its grants, and deletes nothing, on every dialect. The same
 * cleanup run for real then deletes exactly those, which shows the fixture
 * reaches the deletion the dry run skips.
 */
import { afterEach, describe, expect, it } from "vitest";

import { generateSqliteCoreTableStatements } from "../../../database/sqlite-core-tables";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createLogger } from "../../utils/logger";
import { runPermissionsCleanup } from "../permissions-cleanup";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/**
 * A collection the registry does not hold, as one deleted leaves its
 * permissions behind: no collection, Single or component names their
 * resource, so they are orphaned. `ORPHAN` is one of them.
 */
const GONE = "gone_things";
const ORPHAN = { slug: `read-${GONE}` };

/** Slugs in the permissions table. */
async function slugs(handle: TestNextly): Promise<string[]> {
  const rows = (await handle.adapter.executeQuery(
    "SELECT slug FROM permissions ORDER BY slug"
  )) as unknown as Array<{ slug: string }>;
  return rows.map(row => String(row.slug));
}

describe.each(getConfiguredTestDialects())(
  "permissions:cleanup --dry-run (%s)",
  dialect => {
    it("names the orphaned permission, deletes nothing; a real run deletes it", async () => {
      current = await createTestNextly({ dialect });
      // The harness makes the collection tables only; SQLite's core tables
      // come from the shared DDL, as the service's own tests make them.
      if (!(await current.adapter.listTables()).includes("permissions")) {
        for (const statement of generateSqliteCoreTableStatements()) {
          await current.adapter.executeQuery(statement);
        }
      }
      await current
        .getService("permissionSeedService")
        .seedCollectionPermissions(GONE);
      const before = await slugs(current);
      expect(before).toContain(ORPHAN.slug);
      const lines: string[] = [];
      const logger = createLogger({ quiet: true });
      logger.info = (message: string) => void lines.push(message);

      await runPermissionsCleanup(current.adapter, logger, { dryRun: true });

      expect(lines).toContain(
        `Would remove permission ${ORPHAN.slug} and its grants`
      );
      expect(lines.at(-1)).toBe("Dry run: nothing was changed.");
      expect(await slugs(current)).toEqual(before);

      await runPermissionsCleanup(current.adapter, logger, { dryRun: false });
      expect(await slugs(current)).not.toContain(ORPHAN.slug);
    });
  }
);
