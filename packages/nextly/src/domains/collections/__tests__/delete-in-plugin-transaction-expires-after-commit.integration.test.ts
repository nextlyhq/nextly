/**
 * A collection a plugin deletes inside its `ctx.db.transaction` expires its
 * cached reads once that transaction commits, and not at all if it rolls
 * back.
 *
 * On SQLite the delete joins the plugin's transaction, so the registry delete
 * commits only as a savepoint the plugin can still roll back: expiring when
 * the delete returned would expire a collection that still exists, or expire
 * before the delete is visible to readers. PostgreSQL and MySQL commit the
 * delete on a connection of its own, so the rollback half does not apply there.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAdapter } from "../../../database/factory";
import { container } from "../../../di/container";
import type { PluginContext } from "../../../plugins/plugin-context";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type {
  CacheRevalidator,
  RevalidationIntent,
} from "../../../revalidation/types";
import type { CollectionsHandler } from "../../../services/collections-handler";

/** Records every intent flushed to it. */
class RecordingRevalidator implements CacheRevalidator {
  readonly flushed: RevalidationIntent[] = [];
  flush(intents: RevalidationIntent[]): void {
    this.flushed.push(...intents);
  }
  get tags(): string[] {
    return this.flushed.flatMap(intent => intent.tags);
  }
}

describe("a collection deleted inside a plugin's transaction (sqlite)", () => {
  let handle: TestNextly | undefined;
  let spy: RecordingRevalidator;
  let ctx: PluginContext | undefined;

  beforeEach(async () => {
    spy = new RecordingRevalidator();
    // Registered before boot, so registerServices keeps it rather than the no-op.
    container.registerSingleton<CacheRevalidator>(
      "cacheRevalidator",
      () => spy
    );
    process.env.DB_DIALECT = "sqlite";
    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);
    handle = await createTestNextly({
      adapter,
      collections: [],
      plugins: [
        definePlugin({
          name: "@test/cleanup",
          version: "1.0.0",
          nextly: ">=0.0.0",
          init(context) {
            ctx = context;
          },
        }),
      ],
    });
    const collections: CollectionsHandler =
      handle.getService("collectionsHandler");
    const created = await collections.createCollection({
      name: "notes",
      label: "Note",
      fields: [{ name: "title", type: "text" }],
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    spy.flushed.length = 0;
  });

  afterEach(async () => {
    await handle?.destroy();
    handle = undefined;
    ctx = undefined;
  });

  it("expires nothing when the transaction rolls back", async () => {
    await expect(
      ctx!.db.transaction(async () => {
        await ctx!.services.collections.deleteCollection("notes");
        throw new Error("rolled back on purpose");
      })
    ).rejects.toThrow("rolled back on purpose");

    expect(spy.tags).not.toContain("nextly:notes");
  });

  it("expires once the transaction commits, not before", async () => {
    let duringTransaction: string[] = [];
    await ctx!.db.transaction(async () => {
      await ctx!.services.collections.deleteCollection("notes");
      duringTransaction = [...spy.tags];
    });

    expect(duringTransaction).not.toContain("nextly:notes");
    expect(spy.tags.filter(tag => tag === "nextly:notes")).toHaveLength(1);
  });
});
