/**
 * A plugin's `ctx.db.contributed` write expires the cached reads of the entry
 * it changed, on a real boot: the compiled schema's record of which
 * collection `dc_posts` stores, the registry's `revalidate` setting, and the
 * revalidator the app registered.
 */
import { afterEach, beforeEach, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { container } from "../../../di/container";
import { col } from "../../../domains/schema/extension/dsl";
import type {
  CacheRevalidator,
  RevalidationIntent,
} from "../../../revalidation/types";
import { describeEachDialect } from "../../__tests__/helpers/dialect-matrix";
import type { PluginContext } from "../../plugin-context";
import { definePlugin } from "../../plugin-context";
import { createTestNextly, type TestNextly } from "../../test-nextly";

const flagColumns = { reviewFlag: col.text({ nullable: true }) };

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

let current: TestNextly | undefined;
let spy: RecordingRevalidator;

beforeEach(() => {
  spy = new RecordingRevalidator();
  // Registered before boot, so registerServices keeps it rather than the no-op.
  container.registerSingleton<CacheRevalidator>("cacheRevalidator", () => spy);
});

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Boots `posts` with a plugin that contributed `review_flag` to its table. */
async function boot(
  dialect: NonNullable<Parameters<typeof createTestNextly>[0]>["dialect"],
  revalidate?: { disable: true }
): Promise<{ db: PluginContext["db"]; id: string }> {
  let db: PluginContext["db"] | undefined;
  const contributor = definePlugin({
    name: "@test/review-flags",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      schema: {
        extend: [
          ({ schema }) => {
            schema.extendTable("dc_posts", { columns: flagColumns });
          },
        ],
      },
    },
    init(ctx) {
      db = ctx.db;
    },
  });
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "posts",
        fields: [text({ name: "title" })],
        ...(revalidate ? { revalidate } : {}),
      }),
    ],
    plugins: [contributor],
  });
  const created = await current.nextly.create({
    collection: "posts",
    data: { title: "Hello" },
    overrideAccess: true,
  });
  const id = created.item.id;
  if (typeof id !== "string" || db === undefined) {
    throw new Error(`the boot gave no plugin db or string id: ${String(id)}`);
  }
  // The create flushed its own tags; only the plugin's write is asserted.
  spy.flushed.length = 0;
  return { db, id };
}

describeEachDialect("a contributed write expires its entry", dialect => {
  it("expires the entry's cached reads", async () => {
    const { db, id } = await boot(dialect);
    await expect(
      db.contributed("dc_posts", flagColumns).set(id, { reviewFlag: "on" })
    ).resolves.toBe(1);
    expect(spy.tags).toEqual(
      expect.arrayContaining(["nextly:posts", `nextly:posts:id:${id}`])
    );
  });

  it("expires nothing for a collection that opts out", async () => {
    const { db, id } = await boot(dialect, { disable: true });
    await db.contributed("dc_posts", flagColumns).set(id, { reviewFlag: "on" });
    expect(spy.flushed).toEqual([]);
  });

  it("expires once a transaction commits, and not on a rollback", async () => {
    const { db, id } = await boot(dialect);
    await expect(
      db.transaction(async tx => {
        await tx
          .contributed("dc_posts", flagColumns)
          .set(id, { reviewFlag: "on" });
        throw new Error("rolled back on purpose");
      })
    ).rejects.toThrow("rolled back on purpose");
    expect(spy.flushed).toEqual([]);

    await db.transaction(async tx => {
      await tx
        .contributed("dc_posts", flagColumns)
        .set(id, { reviewFlag: "on" });
      expect(spy.flushed).toEqual([]);
    });
    expect(spy.tags).toContain(`nextly:posts:id:${id}`);
  });
});
