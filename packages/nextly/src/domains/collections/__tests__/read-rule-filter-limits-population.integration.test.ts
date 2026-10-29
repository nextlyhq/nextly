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
 * Asked as a visitor, judged by the Public role: its read of the target
 * first, which a site admin grants here since a rule answering a filter is
 * not one boot grants, then the target's read rule, whose filter population
 * applies to the related rows it reads.
 *
 * @module domains/collections/__tests__/read-rule-filter-limits-population.integration.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { grantPublic } from "../../../__tests__/helpers/public-role";
import { defineCollection, relationship, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { readExpansionCaches } from "../../../services/collections/related-row-read-context";
import { TRUSTS_EVERY_COLLECTION } from "../../../services/collections/trust-grant";

// Integration files share fixed system-table names, so this file keeps its
// own collection slugs.
const TEAMS = "rulefilter_pop_teams";
const REFS = "rulefilter_pop_refs";
// A target whose read rule's filter names a field it does not have.
const VANISHED = "rulefilter_pop_vanished";

/** A read rule answering `value`, which the rule type does not allow yet. */
const answering = (value: unknown) => () => value as boolean;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot({
  publicReads = true,
}: { publicReads?: boolean } = {}): Promise<TestNextly> {
  current = await createTestNextly({
    // The boot's seeding, which makes the Public role a visitor is judged by.
    seedPublic: true,
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
  // Granted as a site admin would: the targets' rules answer a filter, so
  // boot grants Public no read of them.
  if (publicReads)
    await grantPublic(current, [`read-${TEAMS}`, `read-${VANISHED}`]);
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

  it("withholds even a row the filter matches where the Public role holds no read", async () => {
    // The permission comes before the rule: without Public's read of the
    // target, the filter is never reached.
    const t = await boot({ publicReads: false });
    const open = await made(t, TEAMS, { name: "public" });
    expect((await fetchAsVisitor(t, TEAMS, open)).name).toBeNull();
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

  it("builds a target's filter once for every reference one expansion fetches", async () => {
    // A `hasMany` field fetched one reference at a time shares one
    // expansion's caches. The filter's match column, and the collection
    // metadata it is built from, is the same for every reference, so it is
    // built once for the three, not once for each.
    const t = await boot();
    const ids = [
      await made(t, TEAMS, { name: "public" }),
      await made(t, TEAMS, { name: "private" }),
      await made(t, TEAMS, { name: "public" }),
    ];
    const service = t.getService("relationshipService");
    const builds = vi.spyOn(
      service as unknown as { ruleMatch: (...args: unknown[]) => unknown },
      "ruleMatch"
    );
    // Fetched at once, as a `hasMany` field fetches its references, so the
    // build each fetch starts is still pending when the next asks for it.
    const caches = readExpansionCaches();
    await Promise.all(
      ids.map(id =>
        service.fetchRelatedEntry(TEAMS, id, {
          trusted: TRUSTS_EVERY_COLLECTION,
          enforceCollectionAccess: true,
          withheldByAccess: new Set<string>(),
          ...caches,
        })
      )
    );
    expect(builds).toHaveBeenCalledTimes(1);
    builds.mockRestore();
  });
});
