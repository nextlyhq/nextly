/**
 * Inside a transaction, a collection's registry row is read from the database
 * once and then answered from that transaction's own memo, on every dialect:
 * one entry update with a relationship reads each collection's row at most
 * once, where it used to read `dynamic_collections` again for each lookup.
 *
 * The memo stays as correct as the uncached read it replaces. A registry
 * write inside the transaction is seen by the next read in it; a part rolled
 * back to its savepoint takes the rows it read with it; and another
 * transaction never sees what this one has not committed.
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  recordStatements,
  type RecordedStatement,
} from "../../../../__tests__/helpers/record-statements";
import { defineCollection, relationship, text } from "../../../../config";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import type { Logger } from "../../../../shared/types";
import { runReadsInTransaction } from "../../../../shared/lib/read-transaction-scope";
import { writeRegistryRows } from "../../../schema/schema-version";
import { DynamicCollectionRegistryService } from "../dynamic-collection-registry-service";

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

/** The statements of `calls` that read a row of the collection registry. */
const registryReads = (calls: readonly RecordedStatement[]) =>
  calls.filter(
    call =>
      /^\s*select\b/i.test(call.text) &&
      /\bfrom\s+["`]?dynamic_collections["`]?/i.test(call.text)
  );

/** How many of `reads` asked for each slug, by the slug among their values. */
function readsPerSlug(
  reads: readonly RecordedStatement[],
  slugs: readonly string[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const slug of slugs) {
    counts[slug] = reads.filter(read => read.values.includes(slug)).length;
  }
  return counts;
}

/** A promise and the function that settles it, for ordering two flows. */
function signal(): { promise: Promise<void>; fire: () => void } {
  let fire = (): void => undefined;
  const promise = new Promise<void>(resolve => {
    fire = resolve;
  });
  return { promise, fire };
}

describeEachDialect("registry rows read inside a transaction", dialect => {
  let current: TestNextly;
  let registry: DynamicCollectionRegistryService;

  beforeEach(async () => {
    current = await createTestNextly({
      dialect,
      collections: [
        defineCollection({
          slug: "authors",
          fields: [text({ name: "name" })],
        }),
        defineCollection({
          slug: "posts",
          status: true,
          versions: true,
          fields: [
            text({ name: "title" }),
            relationship({ name: "author", relationTo: "authors" }),
          ],
        }),
      ],
    });
    registry = new DynamicCollectionRegistryService(current.adapter, logger);
  });

  afterEach(async () => {
    await current.destroy();
  });

  /** The registry row's description as `executor` reads it. */
  async function descriptionOn(executor: unknown): Promise<unknown> {
    const row = (await registry.getCollection("posts", executor)) as {
      description?: unknown;
    };
    return row.description ?? null;
  }

  /** Change the `posts` registry row's description the way a schema write does. */
  async function describePosts(description: string): Promise<void> {
    await writeRegistryRows(current.adapter, () =>
      registry.updateCollectionMetadata("posts", { description })
    );
  }

  it("an entry update and a read of what it wrote read each collection's row at most once", async () => {
    const handler = current.getService(
      "collectionsHandler"
    ) as CollectionsHandler;
    const service = handler.getEntryService();
    const as = { overrideAccess: true };
    const authorId = async (name: string): Promise<string> => {
      const created = await handler.createEntry(
        { collectionName: "authors", ...as },
        { name }
      );
      return (created.data as { id: string }).id;
    };
    const first = await authorId("Ana");
    const second = await authorId("Ben");
    const post = await handler.createEntry(
      { collectionName: "posts", ...as },
      { title: "a", author: first }
    );
    const postId = (post.data as { id: string }).id;

    const recorder = await recordStatements(current.adapter, dialect);
    let author: unknown;
    try {
      await current.adapter.transaction(async tx => {
        const result = await service.updateEntryInTransaction(
          tx as never,
          { collectionName: "posts", entryId: postId, ...as },
          { title: "b", author: second, _overwrite: true }
        );
        expect(result).toMatchObject({ success: true });
        // Read back on the same transaction with its relationship expanded,
        // as a plugin's work inside a write does.
        const read = await runReadsInTransaction(tx, () =>
          handler.getEntry({
            collectionName: "posts",
            entryId: postId,
            depth: 1,
            ...as,
          })
        );
        author = (read.data as { author?: { id?: unknown } }).author?.id;
      });
    } finally {
      recorder.uninstall();
    }
    expect(author).toBe(second);

    const reads = registryReads(recorder.calls);
    // The update looks its collections up inside the transaction, so at least
    // one read reaches the database: none would mean the count proves nothing.
    expect(reads.length).toBeGreaterThan(0);
    expect(readsPerSlug(reads, ["posts", "authors"])).toEqual({
      posts: 1,
      authors: expect.any(Number),
    });
    expect(reads.length).toBeLessThanOrEqual(2);
  });

  it("sees a registry write made earlier in the same transaction", async () => {
    await current.adapter.transaction(async (tx: TransactionContext) => {
      const executor = tx.getDrizzle();
      expect(await descriptionOn(executor)).toBeNull();
      // Read twice, so the row is held by the transaction before the write.
      expect(await descriptionOn(executor)).toBeNull();

      await describePosts("changed in this transaction");

      expect(await descriptionOn(executor)).toBe("changed in this transaction");
    });
  });

  // MySQL joins a part flat, with no savepoint: a part that fails fails the
  // whole transaction, and nothing it wrote is undone while it runs on.
  it.skipIf(dialect === "mysql")(
    "forgets what a part rolled back to its savepoint read",
    async () => {
      await current.adapter.transaction(async (tx: TransactionContext) => {
        const executor = tx.getDrizzle();
        expect(await descriptionOn(executor)).toBeNull();

        await expect(
          current.adapter.transaction(async (part: TransactionContext) => {
            await describePosts("undone with the savepoint");
            expect(await descriptionOn(part.getDrizzle())).toBe(
              "undone with the savepoint"
            );
            throw new Error("roll this part back");
          })
        ).rejects.toThrow();

        expect(await descriptionOn(executor)).toBeNull();
      });
    }
  );

  // SQLite has one connection, and a second transaction waits for the first
  // to end, so there is no other transaction to read while this one is open.
  it.skipIf(dialect === "sqlite")(
    "another transaction does not see a write this one has not committed",
    async () => {
      const written = signal();
      const read = signal();
      let seenElsewhere: unknown = "not read";

      // Each flow starts at the top, so neither is inside the other's
      // transaction and each opens one of its own.
      await Promise.all([
        current.adapter
          .transaction(async (tx: TransactionContext) => {
            expect(await descriptionOn(tx.getDrizzle())).toBeNull();
            await describePosts("not committed");
            expect(await descriptionOn(tx.getDrizzle())).toBe("not committed");
            written.fire();
            await read.promise;
            throw new Error("roll the writer back");
          })
          .catch(() => undefined),
        (async () => {
          await written.promise;
          try {
            await current.adapter.transaction(
              async (tx: TransactionContext) => {
                seenElsewhere = await descriptionOn(tx.getDrizzle());
              }
            );
          } finally {
            read.fire();
          }
        })(),
      ]);

      expect(seenElsewhere).toBeNull();
      expect(await descriptionOn(undefined)).toBeNull();
    }
  );
});
