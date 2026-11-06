/**
 * nextly's registration connects the tag expiry ledger on every dialect: once
 * it has booted, the expiry hand-off is the ledger's, a write made outside
 * Next.js (here, through the Direct API with no Next.js route set up, as the
 * CLI or a script makes it) reaches the ledger's table, and releasing nextly's
 * services restores the in-process hand-off.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../../config";

import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  expiryHandoff,
  isPendingExpiryHandoff,
} from "../../../revalidation/expiry-handoff";
import { collectionTag } from "../../../revalidation/compute-tags";
import { cacheTagExpiriesTables } from "../../../schemas/cache-tag-expiries";
import { LedgerExpiryHandoff } from "../ledger-wiring";
import { tagExpiryId } from "../tag-expiry-ledger";

describeEachDialect(
  "the tag expiry ledger, connected at registration",
  dialect => {
    let current: TestNextly | undefined;

    const table = () => cacheTagExpiriesTables(dialect).nextlyCacheTagExpiries;
    const rowsFor = async (tag: string) =>
      current!.adapter
        .getDrizzle<{
          select(fields: Record<string, unknown>): {
            from(table: unknown): {
              where(condition: unknown): PromiseLike<Array<{ tag: string }>>;
            };
          };
        }>()
        .select({ tag: table().tag })
        .from(table())
        .where(eq(table().id, tagExpiryId(tag)));

    beforeAll(async () => {
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "wiring_posts",
            fields: [text({ name: "title" })],
          }),
        ],
      });
    });
    afterAll(async () => {
      await current?.destroy();
    });

    it("hands off to the ledger once booted, and the tags reach its table", async () => {
      expect(expiryHandoff()).toBeInstanceOf(LedgerExpiryHandoff);

      await expiryHandoff().handOff(["wiring:posts"], "outside a request");

      expect(await rowsFor("wiring:posts")).toEqual([{ tag: "wiring:posts" }]);
    });

    it("records a write made outside Next.js in the ledger, for every instance", async () => {
      await current!.nextly.create({
        collection: "wiring_posts",
        data: { title: "hello" },
      } as never);

      await vi.waitFor(async () => {
        expect(await rowsFor(collectionTag("wiring_posts"))).toEqual([
          { tag: collectionTag("wiring_posts") },
        ]);
      });
    });

    it("restores the in-process hand-off when its services are released", async () => {
      await current?.destroy();
      current = undefined;
      expect(isPendingExpiryHandoff(expiryHandoff())).toBe(true);
    });
  }
);
