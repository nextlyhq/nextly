/**
 * Populating a relationship under the target collection's read rule that
 * answers a filter: a related row the filter matches is populated, and one it
 * does not match is withheld and recorded as withheld.
 *
 * The record is what separates a correct expansion from a plausible broken
 * one. A caller checking its expansion for completeness has to tell a row
 * withheld on purpose from a reference that points at nothing: the first is
 * recorded, the second is not. So each case asks both what came back and
 * what was recorded.
 *
 * Asked as a visitor, so no stored role is needed: a visitor's read of a
 * related row is judged by the target's read rule alone.
 *
 * @module domains/collections/__tests__/read-rule-filter-limits-population.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, relationship, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { TRUSTS_EVERY_COLLECTION } from "../../../services/collections/trust-grant";

// Integration files share fixed system-table names, so this file keeps its
// own collection slugs.
const TEAMS = "rulefilter_pop_teams";
const REFS = "rulefilter_pop_refs";
// A target whose read rule's filter names a field it does not have.
const VANISHED = "rulefilter_pop_vanished";

/** A read rule answering `value`, unchecked by the filter type, as untyped code may. */
const answering = (value: unknown) => () => value as boolean;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: TEAMS,
        access: { read: answering({ name: { equals: "public" } }) },
        fields: [text({ name: "name" })],
      }),
      defineCollection({
        slug: VANISHED,
        access: { read: answering({ vanished: { equals: "x" } }) },
        fields: [text({ name: "name" })],
      }),
      defineCollection({
        slug: REFS,
        access: { read: () => true },
        fields: [
          text({ name: "label" }),
          relationship({ name: "open", relationTo: TEAMS }),
          relationship({ name: "closed", relationTo: TEAMS }),
        ],
      }),
    ],
  });
  return current;
}

/** An entry, made trusted, and its id. */
async function made(
  t: TestNextly,
  collection: string,
  data: Record<string, unknown>
): Promise<string> {
  const created = await t.nextly.create({ collection, data });
  return String((created.item as { id: string | number }).id);
}

/** A visitor's fetch of one related row, and what it recorded as withheld. */
async function fetchAsVisitor(t: TestNextly, target: string, id: string) {
  const withheld = new Set<string>();
  const service = t.getService("relationshipService");
  const row = await service.fetchRelatedEntry(target, id, {
    // Trust applies only to a read that overrides access, which this does not.
    trusted: TRUSTS_EVERY_COLLECTION,
    enforceCollectionAccess: true,
    withheldByAccess: withheld,
  });
  return {
    name: (row as { name?: unknown } | null)?.name ?? null,
    withheld: [...withheld].some(key => key.includes(id)),
  };
}

describe("populating a relationship under a read rule that answers a filter", () => {
  it("populates a related row the filter matches, recording nothing", async () => {
    const t = await boot();
    const open = await made(t, TEAMS, { name: "public" });
    expect(await fetchAsVisitor(t, TEAMS, open)).toEqual({
      name: "public",
      withheld: false,
    });
  });

  it("withholds a related row the filter does not match, and records it as withheld", async () => {
    const t = await boot();
    const closed = await made(t, TEAMS, { name: "private" });
    expect(await fetchAsVisitor(t, TEAMS, closed)).toEqual({
      name: null,
      withheld: true,
    });
  });

  it("does not record a reference that points at nothing", async () => {
    const t = await boot();
    const gone = await made(t, TEAMS, { name: "public" });
    await t.nextly.delete({ collection: TEAMS, id: gone });
    expect(await fetchAsVisitor(t, TEAMS, gone)).toEqual({
      name: null,
      withheld: false,
    });
  });

  it("populates only the matching relation of a parent read", async () => {
    const t = await boot();
    const open = await made(t, TEAMS, { name: "public" });
    const closed = await made(t, TEAMS, { name: "private" });
    const ref = await made(t, REFS, { label: "ref", open, closed });
    const read = (await t.nextly.findByID({
      collection: REFS,
      id: ref,
      depth: 1,
      overrideAccess: false,
    })) as Record<string, unknown>;
    expect((read.open as { name?: unknown } | null)?.name).toBe("public");
    // Withheld as a row the caller may not read is: the stored id, not the row.
    expect(read.closed).toBe(closed);
  });

  it("withholds every row where the target's filter cannot be built", async () => {
    const t = await boot();
    const row = await made(t, VANISHED, { name: "any" });
    expect(await fetchAsVisitor(t, VANISHED, row)).toEqual({
      name: null,
      withheld: true,
    });
  });
});
