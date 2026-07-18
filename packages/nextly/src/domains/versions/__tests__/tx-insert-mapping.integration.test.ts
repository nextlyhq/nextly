import { describe, it, expect } from "vitest";

import { createTestNextly } from "../../../plugins/test-nextly";

// The adapter transaction context must translate Drizzle property names
// (camelCase) to SQL column names when inserting, so a camelCase core table
// like nextly_versions can be written inside a transaction. Regression guard
// for the tx-insert column-mapping fix.
describe("transaction context insert column mapping (integration)", () => {
  it("maps camelCase keys to snake_case columns for nextly_versions", async () => {
    const handle = await createTestNextly();
    try {
      // created_at/updated_at are NOT NULL with no SQL-level default (their
      // Drizzle $defaultFn only applies through the query builder, not this
      // raw-SQL transaction path), so the test supplies them explicitly.
      // Both are still camelCase properties, so they exercise the same
      // property-to-column mapping this test guards.
      const now = new Date();
      const inserted = await handle.adapter.transaction(async tx =>
        tx.insert(
          "nextly_versions",
          {
            id: "v-tx-1",
            scopeKind: "collection",
            scopeSlug: "posts",
            entryId: "e-tx-1",
            versionNo: 1,
            status: "published",
            isAutosave: false,
            snapshot: { title: "hello" },
            createdBy: "user-1",
            createdAt: now,
            updatedAt: now,
          },
          { returning: "*" }
        )
      );
      expect(inserted).toBeTruthy();

      const rows = await handle.adapter.select<{
        scopeKind: string;
        entryId: string;
        snapshot: unknown;
      }>("nextly_versions", {
        where: { and: [{ column: "entryId", op: "=", value: "e-tx-1" }] },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].scopeKind).toBe("collection");
      expect(rows[0].snapshot).toEqual({ title: "hello" });
    } finally {
      await handle.destroy();
    }
  });

  it("maps camelCase RETURNING columns to their sql column names", async () => {
    const handle = await createTestNextly();
    try {
      const now = new Date();
      // `returning` uses camelCase property names; without mapping the RETURNING
      // clause would reference `versionNo`/`scopeKind`, which do not exist as
      // SQL columns, and the insert would fail.
      const inserted = await handle.adapter.transaction(async tx =>
        tx.insert(
          "nextly_versions",
          {
            id: "v-ret-1",
            scopeKind: "collection",
            scopeSlug: "posts",
            entryId: "e-ret-1",
            versionNo: 7,
            status: "published",
            isAutosave: false,
            snapshot: {},
            createdBy: "u",
            createdAt: now,
            updatedAt: now,
          },
          { returning: ["versionNo", "scopeKind"] }
        )
      );
      expect(inserted).toBeTruthy();

      const rows = await handle.adapter.select("nextly_versions", {
        where: { and: [{ column: "entryId", op: "=", value: "e-ret-1" }] },
      });
      expect(rows).toHaveLength(1);
    } finally {
      await handle.destroy();
    }
  });

  it("resolves both snake_case and camelCase names in a select projection", async () => {
    const handle = await createTestNextly();
    try {
      const now = new Date();
      await handle.adapter.transaction(async tx =>
        tx.insert(
          "nextly_versions",
          {
            id: "v-proj-1",
            scopeKind: "collection",
            scopeSlug: "posts",
            entryId: "e-proj-1",
            versionNo: 1,
            status: "published",
            isAutosave: false,
            snapshot: {},
            createdBy: "u",
            createdAt: now,
            updatedAt: now,
          },
          { returning: "*" }
        )
      );

      // Mixed casing: `scopeKind` (property name) and `entry_id` (SQL name)
      // both resolve, the projected rows are keyed by the property name, and
      // the unrequested `snapshot` column is absent.
      const rows = await handle.adapter.select<{
        scopeKind?: string;
        entryId?: string;
        snapshot?: unknown;
      }>("nextly_versions", {
        columns: ["scopeKind", "entry_id"],
        where: { and: [{ column: "entryId", op: "=", value: "e-proj-1" }] },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].scopeKind).toBe("collection");
      expect(rows[0].entryId).toBe("e-proj-1");
      expect(rows[0].snapshot).toBeUndefined();
    } finally {
      await handle.destroy();
    }
  });
});
