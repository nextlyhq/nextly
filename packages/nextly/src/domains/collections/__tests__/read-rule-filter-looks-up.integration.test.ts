/**
 * A read rule that looks up who the caller is before it answers: it reads the
 * caller's team from another collection, and answers a filter on that team.
 *
 * The rule is written as a site would write it, typed by the collection's
 * fields, with no cast. The property that separates a correct answer from a
 * plausible broken one is that two callers asking the same rule are each
 * limited to their own team: a rule that ignored its lookup, or a read that
 * kept one caller's filter for the next, would show one of them the other's
 * entries.
 *
 * @module domains/collections/__tests__/read-rule-filter-looks-up.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { userWhoMay } from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Integration files share fixed system-table names, so this file keeps its
// own collection slugs.
const NOTES = "rulefilter_lookup_notes";
const MEMBERS = "rulefilter_lookup_members";
const RED_READER = "rulefilter-lookup-red";
const BLUE_READER = "rulefilter-lookup-blue";
// A reader who holds the permission and belongs to no team.
const LONE_READER = "rulefilter-lookup-lone";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** The team `userId` belongs to, read from the members collection. */
async function teamOf(userId: string): Promise<string | undefined> {
  const found = await current?.nextly.find({
    collection: MEMBERS,
    where: { member: { equals: userId } },
    limit: 1,
  });
  const team = (found?.items[0] as { team?: unknown } | undefined)?.team;
  return typeof team === "string" ? team : undefined;
}

async function boot(): Promise<TestNextly> {
  const t = await createTestNextly({
    collections: [
      defineCollection({
        slug: MEMBERS,
        fields: [text({ name: "member" }), text({ name: "team" })],
      }),
      defineCollection({
        slug: NOTES,
        fields: [text({ name: "title" }), text({ name: "team" })],
        access: {
          read: async ({ user }) => {
            if (!user) return false;
            const team = await teamOf(String(user.id));
            return team === undefined ? false : { team: { equals: team } };
          },
        },
      }),
    ],
  });
  current = t;
  // The rule narrows the read permission, so each reader holds it.
  for (const reader of [RED_READER, BLUE_READER, LONE_READER]) {
    await userWhoMay(t, reader, "read", [NOTES]);
  }
  for (const [member, team] of [
    [RED_READER, "red"],
    [BLUE_READER, "blue"],
  ]) {
    await t.nextly.create({ collection: MEMBERS, data: { member, team } });
  }
  for (const [title, team] of [
    ["red-1", "red"],
    ["red-2", "red"],
    ["blue-1", "blue"],
  ]) {
    await t.nextly.create({ collection: NOTES, data: { title, team } });
  }
  return t;
}

/** What `reader`'s checked list of the notes returns: its titles and total. */
async function listedFor(
  t: TestNextly,
  reader: string
): Promise<{ titles: unknown[]; total: number }> {
  const page = await t.nextly.find({
    collection: NOTES,
    overrideAccess: false,
    user: { id: reader },
  });
  return {
    titles: page.items.map(item => (item as { title?: unknown }).title).sort(),
    total: page.meta.total,
  };
}

describe("a read rule that looks up the caller's team", () => {
  it("limits each caller to the entries of their own team", async () => {
    const t = await boot();
    expect(await listedFor(t, RED_READER)).toEqual({
      titles: ["red-1", "red-2"],
      total: 2,
    });
    expect(await listedFor(t, BLUE_READER)).toEqual({
      titles: ["blue-1"],
      total: 1,
    });
  });

  it("refuses a caller its lookup finds no team for", async () => {
    const t = await boot();
    await expect(listedFor(t, LONE_READER)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
