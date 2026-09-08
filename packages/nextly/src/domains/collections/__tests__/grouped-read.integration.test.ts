/**
 * A grouped read answers over exactly the rows a count would have counted, and
 * refuses the keys that would turn buckets into a disclosure.
 *
 * Buckets are a stronger oracle than a `where`. A filter yields one hidden
 * value per probe; a GROUP BY hands back the whole distinct set at once, and
 * redaction never sees it because the value arrives as a bucket label rather
 * than as a column in a row.
 *
 * Against a real (in-memory SQLite) database, because every claim here is about
 * the SQL that runs. A mocked query builder would only restate the call the
 * test itself made.
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

type Handler = {
  countEntries: (p: Record<string, unknown>) => Promise<{
    success: boolean;
    data: { totalDocs: number } | null;
  }>;
  groupEntries: (p: Record<string, unknown>) => Promise<{
    success: boolean;
    statusCode: number;
    message: string;
    data: {
      buckets: { value: string | null; count: number }[];
      truncated: boolean;
    } | null;
  }>;
  createEntry: (
    p: Record<string, unknown>,
    data: Record<string, unknown>
  ) => Promise<{ success: boolean }>;
};

const ORDERS = "orders";

async function boot(
  rows: { region: string; secret: string }[]
): Promise<Handler> {
  const t = await createTestNextly({
    collections: [
      defineCollection({
        slug: ORDERS,
        access: { read: () => true, create: () => true, update: () => true },
        fields: [
          text({ name: "region" }),
          // Readable rows, one unreadable column -- the shape a field rule
          // exists for, and the shape a group key must not defeat.
          text({ name: "secret", access: { read: () => false } }),
        ],
      }),
    ],
  });
  current = t;
  const h = t.getService("collectionsHandler") as unknown as Handler;
  for (const row of rows) {
    await h.createEntry({ collectionName: ORDERS, overrideAccess: true }, row);
  }
  return h;
}

describe("a grouped read", () => {
  it("returns one bucket per distinct value, largest first", async () => {
    const h = await boot([
      { region: "emea", secret: "a" },
      { region: "emea", secret: "b" },
      { region: "emea", secret: "c" },
      { region: "apac", secret: "d" },
    ]);

    const res = await h.groupEntries({
      collectionName: ORDERS,
      groupBy: "region",
    });

    expect(res.success).toBe(true);
    expect(res.data?.buckets).toEqual([
      { value: "emea", count: 3 },
      { value: "apac", count: 1 },
    ]);
    expect(res.data?.truncated).toBe(false);
  });

  it("describes the same rows a count of the same query describes", async () => {
    // The claim the shared pipeline exists to make: an aggregate cannot report
    // over a wider row set than a count of the same request. Asserted against
    // the count rather than against a number written here, so a filter added
    // to one read and not the other fails this.
    const h = await boot([
      { region: "emea", secret: "a" },
      { region: "emea", secret: "b" },
      { region: "apac", secret: "c" },
    ]);
    const where = { region: { equals: "emea" } };

    const counted = await h.countEntries({ collectionName: ORDERS, where });
    const grouped = await h.groupEntries({
      collectionName: ORDERS,
      groupBy: "region",
      where,
    });

    const summed = (grouped.data?.buckets ?? []).reduce(
      (total, bucket) => total + bucket.count,
      0
    );
    expect(summed).toBe(counted.data?.totalDocs);
    expect(summed).toBe(2);
  });

  it("refuses a group key naming a field the caller may not read", async () => {
    // The disclosure this closes: grouping by `secret` returns its distinct
    // values as bucket labels, which no redaction step ever inspects.
    const h = await boot([
      { region: "emea", secret: "alpha" },
      { region: "apac", secret: "beta" },
    ]);

    const res = await h.groupEntries({
      collectionName: ORDERS,
      groupBy: "secret",
      user: { id: "u1", email: "u1@example.com" },
    });

    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res)).toContain("FIELD_NOT_GROUPABLE");
    expect(JSON.stringify(res)).not.toContain("alpha");
  });

  it("refuses grouping rows by who created them", async () => {
    const h = await boot([{ region: "emea", secret: "a" }]);

    const res = await h.groupEntries({
      collectionName: ORDERS,
      groupBy: "createdBy",
    });

    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).toContain("FIELD_NOT_GROUPABLE");
  });

  it("refuses a group key that is not a column, rather than dropping it", async () => {
    // Dropping it would collapse every bucket into one row and answer with a
    // single total that reads exactly like a real one.
    const h = await boot([
      { region: "emea", secret: "a" },
      { region: "apac", secret: "b" },
    ]);

    const res = await h.groupEntries({
      collectionName: ORDERS,
      groupBy: "notAColumn",
    });

    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).toContain("FIELD_NOT_GROUPABLE");
    expect(res.data).toBeNull();
  });

  it("says so when it returned fewer buckets than exist", async () => {
    const h = await boot(
      Array.from({ length: 5 }, (_, i) => ({
        region: `r${i}`,
        secret: `s${i}`,
      }))
    );

    const res = await h.groupEntries({
      collectionName: ORDERS,
      groupBy: "region",
      bucketLimit: 2,
    });

    expect(res.data?.buckets).toHaveLength(2);
    expect(res.data?.truncated).toBe(true);
  });
});
