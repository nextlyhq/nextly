/**
 * What an entry delete's before hooks are handed, on the two roads that run them: a delete of its
 * own, and one inside a transaction its caller opened.
 *
 * What separates the right hand-over from a plausible wrong one: in a caller's transaction each
 * hook is handed that transaction's own connection (`executor`), without which a hook that reads
 * would wait for another one while the transaction holds its own; a delete of its own hands none,
 * since nothing holds one. On both, the hooks run in one order, over one context, told of the
 * entry as it is.
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { superAdminUser } from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../../config";
import { StoredHookExecutor } from "../../../hooks/stored-hook-executor";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";

const SLUG = "dbh_notes";
const DELETER = "dbh-deleter";

let instance: TestNextly | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await instance?.destroy();
  instance = undefined;
});

/** What one before hook was handed. */
interface Handed {
  hook: string;
  collection: unknown;
  operation: unknown;
  /** The entry the hook was told of: its id, and its title where it is handed the entry. */
  id: unknown;
  title: unknown;
  userId: unknown;
  context: unknown;
  executor: unknown;
}

describe.each(getConfiguredTestDialects())(
  "what an entry delete's before hooks are handed (%s)",
  dialect => {
    /** The app with one entry, and what its before hooks are handed from now on. */
    async function boot(): Promise<{
      t: TestNextly;
      id: string;
      handed: Handed[];
    }> {
      const t = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: SLUG,
            fields: [text({ name: "title", localized: false })],
          }),
        ],
      });
      instance = t;
      await superAdminUser(t, DELETER);
      const made = (await t.nextly.create({
        collection: SLUG,
        data: { title: "doomed" },
      } as never)) as unknown as { item: { id: unknown } };

      const handed: Handed[] = [];
      t.hooks.registerBeforeOperation(SLUG, context => {
        handed.push({
          hook: "beforeOperation",
          collection: context.collection,
          operation: context.operation,
          id: (context.args as { id?: unknown }).id,
          title: undefined,
          userId: context.user?.id,
          context: context.context,
          executor: context.executor,
        });
        return undefined;
      });
      t.hooks.register("beforeDelete", SLUG, context => {
        const entry = context.data as { id?: unknown; title?: unknown };
        handed.push({
          hook: "beforeDelete",
          collection: context.collection,
          operation: context.operation,
          id: entry.id,
          title: entry.title,
          userId: context.user?.id,
          context: context.context,
          executor: context.executor,
        });
        return undefined;
      });
      // The stored hooks, whose collection has none: what they would be handed.
      const real = StoredHookExecutor.prototype.execute;
      vi.spyOn(StoredHookExecutor.prototype, "execute").mockImplementation(
        async function (this: StoredHookExecutor, type, hooks, context) {
          if (type === "beforeDelete") {
            const entry = context.data as { id?: unknown; title?: unknown };
            handed.push({
              hook: "stored beforeDelete",
              collection: context.collection,
              operation: context.operation,
              id: entry.id,
              title: entry.title,
              userId: context.user?.id,
              context: context.context,
              executor: context.executor,
            });
          }
          return real.call(this, type, hooks, context) as never;
        }
      );
      return { t, id: String(made.item.id), handed };
    }

    /** What each hook is handed on both roads, but for its executor. */
    function expectHanded(
      handed: readonly Handed[],
      id: string,
      sent: Record<string, unknown>
    ) {
      const common = { collection: SLUG, operation: "delete", userId: DELETER };
      expect(handed).toMatchObject([
        { hook: "beforeOperation", id, ...common },
        { hook: "beforeDelete", id, title: "doomed", ...common },
        { hook: "stored beforeDelete", id, title: "doomed", ...common },
      ]);
      // One context over the three, holding what the caller sent.
      expect(handed[0]?.context).toEqual(sent);
      for (const { context } of handed) {
        expect(context).toBe(handed[0]?.context);
      }
    }

    it("runs them in order over one context, with no executor, for a delete of its own", async () => {
      const { t, id, handed } = await boot();
      const entries = (
        t.getService("collectionsHandler") as unknown as CollectionsHandler
      ).getEntryService() as CollectionEntryService;

      const result = await entries.deleteEntry({
        collectionName: SLUG,
        entryId: id,
        user: { id: DELETER },
        context: { source: "test" },
      });

      expect(result.success, result.message).toBe(true);
      expectHanded(handed, id, { source: "test" });
      expect(handed.map(({ executor }) => executor)).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
    }, 60_000);

    it.each([
      {
        road: "one entry",
        sent: { source: "test" },
        remove: async (
          entries: CollectionEntryService,
          tx: TransactionContext,
          id: string
        ) =>
          (
            await entries.deleteEntryInTransaction(tx, {
              collectionName: SLUG,
              entryId: id,
              user: { id: DELETER },
              context: { source: "test" },
            })
          ).success,
      },
      {
        road: "a batch",
        sent: {},
        remove: async (
          entries: CollectionEntryService,
          tx: TransactionContext,
          id: string
        ) =>
          (
            await entries.deleteEntriesInTransaction(
              tx,
              { collectionName: SLUG, user: { id: DELETER } },
              [id]
            )
          ).successful === 1,
      },
    ])(
      "runs them in the same order, each handed the transaction's own connection, for a delete of $road in a caller's transaction",
      async ({ sent, remove }) => {
        const { t, id, handed } = await boot();
        const entries = (
          t.getService("collectionsHandler") as unknown as CollectionsHandler
        ).getEntryService() as CollectionEntryService;

        let ofTheTransaction: unknown;
        const deleted = await t.adapter.transaction(async tx => {
          ofTheTransaction = tx.getDrizzle();
          return remove(entries, tx, id);
        });

        expect(deleted).toBe(true);
        expectHanded(handed, id, sent);
        expect(ofTheTransaction).toBeDefined();
        for (const { executor } of handed) {
          expect(executor).toBe(ofTheTransaction);
        }
      },
      60_000
    );
  }
);
