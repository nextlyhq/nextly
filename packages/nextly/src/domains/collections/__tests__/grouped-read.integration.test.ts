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

import { defineCollection, group, json, password, text } from "../../../config";
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
          // Declared in SNAKE case on purpose. The guard converted a name to
          // camel only, and the camel form of an already-camel string is
          // itself, so a camel-spelled probe missed a snake-declared field
          // while the column resolver found it under either spelling.
          text({ name: "secret_answer", access: { read: () => false } }),
          // Its guarantee comes from its TYPE, not from an access rule, so the
          // field-rule guard never sees it.
          password({ name: "vaultKey" }),
          // A structure, not a value: two rows carrying the same content with
          // their keys ordered differently are one bucket under jsonb and two
          // under SQLite.
          json({ name: "payload" }),
          // A readable top-level column that SHARES a name with a password
          // nested inside a group. The nested name is scoped to its container,
          // so this one must stay groupable.
          text({ name: "code" }),
          group({
            name: "vault",
            fields: [password({ name: "code" })],
          }),
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

describe("a group key that resolves by an alias", () => {
  it("refuses a camel-spelled probe at a snake-declared protected field", async () => {
    const h = await boot([
      { region: "emea", secret: "a" },
      { region: "apac", secret: "b" },
    ]);

    const res = await h.groupEntries({
      collectionName: ORDERS,
      groupBy: "secretAnswer",
      user: { id: "u1", email: "u1@example.com" },
    });

    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).toContain("FIELD_NOT_GROUPABLE");
  });

  it("still refuses the snake spelling it always refused", async () => {
    // The control for the direction that already worked, so a change swapping
    // one alias for the other cannot pass as a fix.
    const h = await boot([{ region: "emea", secret: "a" }]);

    const res = await h.groupEntries({
      collectionName: ORDERS,
      groupBy: "secret_answer",
      user: { id: "u1", email: "u1@example.com" },
    });

    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).toContain("FIELD_NOT_GROUPABLE");
  });

  it("refuses a protected group key even on a framework-built read", async () => {
    // `frameworkFilter` attests that the WHERE was built by the framework from
    // a route it was asked to render. It says nothing about a grouping key, so
    // forwarding it would let that exemption publish the distinct values of a
    // field the caller may not read.
    const h = await boot([{ region: "emea", secret: "alpha" }]);

    const res = await h.groupEntries({
      collectionName: ORDERS,
      groupBy: "secret",
      frameworkFilter: true,
      user: { id: "u1", email: "u1@example.com" },
    });

    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).toContain("FIELD_NOT_GROUPABLE");
    expect(JSON.stringify(res)).not.toContain("alpha");
  });
});

describe("a group key whose value never leaves the server", () => {
  it("refuses a password field, which carries no read rule to be caught by", async () => {
    // `stripPasswordFieldValues` protects ROWS. An aggregate returns none, so
    // a grouped read selecting the column directly would hand the stored
    // hashes back as bucket labels with nothing on that path to clear them.
    const h = await boot([{ region: "emea", secret: "a" }]);

    const res = await h.groupEntries({
      collectionName: ORDERS,
      groupBy: "vaultKey",
    });

    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).toContain("FIELD_NOT_GROUPABLE");
  });

  it("refuses it under its column spelling too", async () => {
    const h = await boot([{ region: "emea", secret: "a" }]);

    const res = await h.groupEntries({
      collectionName: ORDERS,
      groupBy: "vault_key",
    });

    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).toContain("FIELD_NOT_GROUPABLE");
  });
});

describe("bucket labels", () => {
  it("bounds the buckets by the limit the caller asked for", async () => {
    const h = await boot(
      Array.from({ length: 6 }, (_, i) => ({ region: `r${i}`, secret: "s" }))
    );

    const res = await h.groupEntries({
      collectionName: ORDERS,
      groupBy: "region",
      bucketLimit: 3,
    });

    expect(res.data?.buckets).toHaveLength(3);
    expect(res.data?.truncated).toBe(true);
  });

  it("falls back to the server bound when the limit is not a number", async () => {
    // `Math.trunc`, `Math.max` and `Math.min` all preserve `NaN`, so an
    // unguarded clamp reaches the query builder as `.limit(NaN)` and fails the
    // read instead of applying the documented bound.
    const h = await boot([
      { region: "emea", secret: "a" },
      { region: "apac", secret: "b" },
    ]);

    const res = await h.groupEntries({
      collectionName: ORDERS,
      groupBy: "region",
      bucketLimit: Number.NaN,
    });

    expect(res.success).toBe(true);
    expect(res.data?.buckets).toHaveLength(2);
  });
});

describe("a group key that is not a scalar column of this table", () => {
  it("refuses a structured field rather than labelling it", async () => {
    // Refused rather than serialised: the grouping already happened in the
    // database, where PostgreSQL's jsonb normalises key order and SQLite
    // compares the stored text -- so the same content answers a different
    // count per adapter and no label chosen here can reconcile them.
    const h = await boot([{ region: "emea", secret: "a" }]);

    const res = await h.groupEntries({
      collectionName: ORDERS,
      groupBy: "payload",
    });

    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).toContain("FIELD_NOT_GROUPABLE");
  });

  it("refuses an inherited name instead of failing in the query builder", async () => {
    // `schema` is an ordinary object, so `toString` resolves to a prototype
    // method rather than `undefined`. Read as a column it reached Drizzle and
    // answered a 500 where the contract promises a named refusal.
    const h = await boot([{ region: "emea", secret: "a" }]);

    const res = await h.groupEntries({
      collectionName: ORDERS,
      groupBy: "toString",
    });

    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res)).toContain("FIELD_NOT_GROUPABLE");
  });

  it("still groups a readable field that a NESTED password happens to share a name with", async () => {
    // The false positive: descending into containers marked the top-level
    // `code` column as a password because an unrelated `vault.code` is one.
    // A nested name is scoped to its container and has no column here.
    const h = await boot([{ region: "emea", secret: "a" }]);

    const res = await h.groupEntries({
      collectionName: ORDERS,
      groupBy: "code",
    });

    expect(res.success).toBe(true);
    expect(res.data?.buckets).toHaveLength(1);
  });
});
