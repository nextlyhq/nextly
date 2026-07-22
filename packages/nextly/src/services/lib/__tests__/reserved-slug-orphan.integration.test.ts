/**
 * Proof that a reserved (system-resource) slug is rejected BEFORE any DDL runs
 * on the two Schema-Builder create paths, so a rejected create never leaves an
 * orphan table with no registry row.
 *
 * The collision is real: permission identity is `action-resource`, so a content
 * type named after a system resource (`settings`, `media`, `webhooks`, ...)
 * seeds the same `read-<name>`/`update-<name>` rows that resource's routes
 * check. The reservation lives at the validation/artifact step of each create
 * path; these tests exercise the real paths against a live adapter and assert
 * the physical table is absent afterward:
 *
 *   - Collection: `CollectionMetadataService.createCollection` (via the
 *     `collectionsHandler`) validates the name inside `generateCollection`
 *     before `saveMigration`/`runMigration`, so no `dc_<name>` table appears.
 *   - Single: the `createSingle` dispatcher rejects at the top of `execute`,
 *     before `generateMigrationSQL`/`executeMigrationStatements`, so no
 *     `single_<name>` table appears.
 *
 * `settings` and `media` are the load-bearing cases: neither is in the legacy
 * curated `RESERVED_COLLECTION_NAMES` list, so only the system-resource
 * reservation rejects them.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Reserved names that collide only via the system-resource reservation (not the
// legacy curated collection-name list), so they prove the new guard is the one
// doing the work.
const RESERVED_NAMES = ["settings", "media"] as const;

let current: TestNextly | undefined;

// The collection UI-create path only runs the generated migration in
// development; force dev so a table WOULD be created if the guard did not fire
// first, making the "no orphan table" assertion meaningful.
let prevNodeEnv: string | undefined;
beforeEach(() => {
  prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
});

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  process.env.NODE_ENV = prevNodeEnv;
});

/** True if a physical table with this exact name exists (sqlite). */
async function tableExists(t: TestNextly, table: string): Promise<boolean> {
  const adapter = t.adapter as unknown as {
    executeQuery: (sql: string) => Promise<Record<string, unknown>[]>;
  };
  const rows = await adapter.executeQuery(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`
  );
  return rows.length > 0;
}

function collectionsHandlerOf(t: TestNextly) {
  return t.getService("collectionsHandler") as unknown as {
    createCollection: (data: Record<string, unknown>) => Promise<{
      success: boolean;
      statusCode: number;
    }>;
  };
}

describe("reserved slug rejection leaves no orphan table (integration)", () => {
  it("collection create rejects a reserved name before building its table", async () => {
    current = await createTestNextly({ collections: [] });

    for (const name of RESERVED_NAMES) {
      const result = await collectionsHandlerOf(current).createCollection({
        name,
        label: name,
        fields: [{ name: "body", type: "text" }],
      });

      // createCollection maps validation failures to a { success: false }
      // result (see CollectionMetadataService.errorToMetadataResult).
      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(400);

      // The reserved name was rejected inside generateCollection, before the
      // migration was saved or run, so no `dc_<name>` table exists.
      expect(await tableExists(current, `dc_${name}`)).toBe(false);
    }
  });

  it("single create rejects a reserved slug before building its table", async () => {
    current = await createTestNextly({ collections: [] });

    for (const name of RESERVED_NAMES) {
      // The createSingle dispatcher throws NextlyError.validation at the top of
      // execute, before any DDL; dispatchSingles does not catch it.
      await expect(
        dispatchSingles(
          "createSingle",
          {},
          {
            slug: name,
            label: name,
            fields: [{ name: "body", type: "text" }],
          }
        )
      ).rejects.toThrow(NextlyError);

      // The rejection happened before generateMigrationSQL/executeMigration
      // Statements, so no `single_<name>` table exists.
      expect(await tableExists(current, `single_${name}`)).toBe(false);
    }
  });
});
