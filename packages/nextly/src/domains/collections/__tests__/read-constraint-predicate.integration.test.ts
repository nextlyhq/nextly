/**
 * Proves a stored read rule's query constraint is applied IN FULL, against a
 * real (in-memory SQLite) database.
 *
 * A read rule can return a filter predicate rather than a yes/no. That
 * predicate used to be reduced to the first field's `equals` value:
 *
 *   const field = Object.keys(constraint)[0];
 *   const value = (constraint[field] as { equals?: unknown })?.equals;
 *   if (field && value) push(eq(schema[field], value));
 *
 * Three ways that returns rows the rule excludes, all of them over-permissive:
 * a second field is never applied; any operator other than `equals` leaves
 * `value` undefined so NOTHING is applied; and a legitimately falsy `equals`
 * (`0`, `false`, `""`) fails the truthiness guard, so nothing is applied there
 * either. Owner-only escaped all three by accident — one field, one non-empty
 * string id — which is why it went unnoticed.
 *
 * These run against a real schema on purpose. The unit harness fakes columns
 * with `Symbol`s, which Drizzle cannot build a condition from, so it can only
 * ever exercise the fail-closed branch.
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, number, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const RULE_PATH = new URL("./_fixtures/tenant-read-rule.ts", import.meta.url)
  .pathname;

type Row = { title: string };

/**
 * Boot a collection, attach the stored `custom` read rule, and seed rows.
 *
 * The rule is written onto the collection row rather than declared in
 * `defineCollection`, because `getAccessRules()` reads the STORED shape
 * (`accessRules`) while the code-first surface exposes `access` (functions).
 * A Builder-created collection carries it exactly this way.
 */
async function bootWithStoredRule(): Promise<CollectionsHandler> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: "docs",
        fields: [
          text({ name: "title" }),
          text({ name: "tenant" }),
          text({ name: "region" }),
          number({ name: "price" }),
        ],
      }),
    ],
  });

  await current.adapter.update(
    "dynamic_collections",
    { access_rules: { read: { type: "custom", functionPath: RULE_PATH } } },
    { and: [{ column: "slug", op: "=", value: "docs" }] }
  );

  const handler = current.getService<CollectionsHandler>("collectionsHandler");

  const seed = [
    { title: "acme-eu-free", tenant: "acme", region: "eu", price: 0 },
    { title: "acme-us-paid", tenant: "acme", region: "us", price: 10 },
    { title: "other-eu-paid", tenant: "other", region: "eu", price: 10 },
  ];
  for (const data of seed) {
    await handler.createEntry(
      { collectionName: "docs", overrideAccess: true },
      data
    );
  }
  return handler;
}

async function titlesFor(
  handler: CollectionsHandler,
  userId: string
): Promise<string[]> {
  const result = await handler.listEntries({
    collectionName: "docs",
    user: { id: userId },
    routeAuthorized: true,
  });
  expect(result.success).toBe(true);
  return (result.data!.docs as Row[]).map(r => r.title).sort();
}

describe("stored read constraints are applied in full (integration)", () => {
  it("binds every field of a multi-field constraint", async () => {
    const handler = await bootWithStoredRule();

    // Only the acme+eu row satisfies both fields. Applying `tenant` alone would
    // also return acme-us-paid.
    expect(await titlesFor(handler, "multi-field")).toEqual(["acme-eu-free"]);
  });

  it("applies a constraint whose value is falsy", async () => {
    const handler = await bootWithStoredRule();

    // `price: { equals: 0 }` is a real predicate. Skipping it on truthiness
    // returned the paid rows too.
    expect(await titlesFor(handler, "falsy-value")).toEqual(["acme-eu-free"]);
  });

  it("applies a constraint using an operator other than equals", async () => {
    const handler = await bootWithStoredRule();

    // `region: { in: [...] }` has no `equals`, so the old path applied no
    // predicate at all and returned every row including the us one.
    expect(await titlesFor(handler, "in-operator")).toEqual([
      "acme-eu-free",
      "other-eu-paid",
    ]);
  });

  it("refuses a constraint whose members are only partly translatable", async () => {
    // A geo predicate beside a normal one: the translators drop the geo member
    // and keep `tenant`, so the read would run under a weaker predicate than the
    // rule requires and return rows outside the permitted area. Non-empty is not
    // the same as complete, so the constraint is refused instead.
    const handler = await bootWithStoredRule();

    const result = await handler.listEntries({
      collectionName: "docs",
      user: { id: "partial-geo" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(false);
    // An authorization decision, not a server fault.
    expect(result.statusCode).toBe(403);
  });

  it("refuses a constraint naming a column the table does not have", async () => {
    const handler = await bootWithStoredRule();

    const result = await handler.listEntries({
      collectionName: "docs",
      user: { id: "partial-unknown-field" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("refuses the matching count too", async () => {
    const handler = await bootWithStoredRule();

    const counted = await handler.countEntries({
      collectionName: "docs",
      user: { id: "partial-geo" },
      routeAuthorized: true,
    });

    // A count that succeeded where the list refused would disclose the size of
    // a result set the caller may not read.
    expect(counted.success).toBe(false);
    expect(counted.statusCode).toBe(403);
  });

  it("refuses an empty IN list rather than dropping it", async () => {
    // A rule computing "the ids you may see" can legitimately come back empty,
    // which must match no rows. Dropped, the sibling predicate runs alone and
    // returns everything it allows.
    const handler = await bootWithStoredRule();

    const result = await handler.listEntries({
      collectionName: "docs",
      user: { id: "empty-in" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("refuses an inherited property posing as an operator", async () => {
    // `toString` answers true to an `in`-keyword operator check while mapping to
    // nothing, so it would be dropped and its sibling would still run.
    const handler = await bootWithStoredRule();

    const result = await handler.listEntries({
      collectionName: "docs",
      user: { id: "inherited-operator" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("counts the same rows it lists", async () => {
    const handler = await bootWithStoredRule();

    // The count path carried an identical extraction, so a total could describe
    // rows the list correctly withheld.
    const listed = await titlesFor(handler, "multi-field");
    const counted = await handler.countEntries({
      collectionName: "docs",
      user: { id: "multi-field" },
      routeAuthorized: true,
    });

    expect(counted.success).toBe(true);
    expect(counted.data!.totalDocs).toBe(listed.length);
  });
});
