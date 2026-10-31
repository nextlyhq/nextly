/**
 * nextly's registration connects the tag expiry ledger on every dialect: once
 * it has booted, the expiry hand-off is the ledger's, and tags handed off from
 * outside a request reach the ledger's table; releasing nextly's services
 * restores the in-process hand-off.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  expiryHandoff,
  isPendingExpiryHandoff,
} from "../../../revalidation/expiry-handoff";
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
      current = await createTestNextly({ dialect });
    });
    afterAll(async () => {
      await current?.destroy();
    });

    it("hands off to the ledger once booted, and the tags reach its table", async () => {
      expect(expiryHandoff()).toBeInstanceOf(LedgerExpiryHandoff);

      await expiryHandoff().handOff(["wiring:posts"], "outside a request");

      expect(await rowsFor("wiring:posts")).toEqual([{ tag: "wiring:posts" }]);
    });

    it("restores the in-process hand-off when its services are released", async () => {
      await current?.destroy();
      current = undefined;
      expect(isPendingExpiryHandoff(expiryHandoff())).toBe(true);
    });
  }
);
