/**
 * Proves the `created_by` owner column is stamped end-to-end on the create
 * path against a real (in-memory SQLite) database: the creating user's id lands
 * in the column, and a system create (no user) leaves it null. This is what
 * makes owner-only access work zero-config — the stored rule compares
 * `created_by` to the caller.
 *
 * Uses overrideAccess to bypass the RBAC gate while still carrying the user, so
 * the test exercises the stamping without wiring per-user permissions.
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import type { CollectionsHandler } from "../../../services/collections-handler";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionService } from "../services/collection-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const TABLE = "dc_ownerdocs";

describe("created_by owner stamping (integration)", () => {
  it("stamps the creating user's id and leaves system creates null", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "ownerdocs",
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    // Create carrying a user (overrideAccess bypasses the access gate but the
    // owner stamp reads the user, not the access decision).
    await handler.createEntry(
      { collectionName: "ownerdocs", userId: "owner-1", overrideAccess: true },
      { title: "mine" }
    );

    // Create with no user (a system/seed write).
    await handler.createEntry(
      { collectionName: "ownerdocs", overrideAccess: true },
      { title: "system" }
    );

    const rows = await current.adapter.select<{
      title: string;
      created_by: string | null;
    }>(TABLE);
    const byTitle = new Map(rows.map(r => [r.title, r.created_by]));

    expect(byTitle.get("mine")).toBe("owner-1");
    expect(byTitle.get("system")).toBeNull();
  });

  it("stamps created_by through the bulk create transaction path", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "ownerdocs",
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const collectionService =
      current.getService<CollectionService>("collectionService");

    // Bulk create routes through createSingleEntryInTransaction; the owner must
    // be stamped there too (the tx path uses the snake_case column key).
    await collectionService.createMany(
      "ownerdocs",
      [{ title: "bulk-a" }, { title: "bulk-b" }],
      { user: { id: "owner-2" }, overrideAccess: true }
    );

    const rows = await current.adapter.select<{
      title: string;
      created_by: string | null;
    }>(TABLE);
    const byTitle = new Map(rows.map(r => [r.title, r.created_by]));

    expect(byTitle.get("bulk-a")).toBe("owner-2");
    expect(byTitle.get("bulk-b")).toBe("owner-2");
  });
});
