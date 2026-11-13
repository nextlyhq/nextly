/**
 * A `where` filter on a has-many relationship matches by membership, on every configured dialect,
 * through the Direct API and REST: `in` and `equals` find an entry holding any of the ids,
 * `not_in` and `not_equals` one holding none of them (an entry with no related entries
 * included), and `contains`, `search` and `like` are refused with a 400 naming the operator to
 * use, before any query runs.
 *
 * The related ids are `a`, `ab` and `b`, so a match on part of an id (`a` inside `ab`) would show.
 * An entry's id is a UUID wherever it is created, so the lists are written into the posts' column
 * directly, and the reads take `depth: 0`: the filter reads the stored list alone.
 *
 * @module domains/collections/__tests__/has-many-filter-membership.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, relationship, text } from "../../../config";
import { ServiceDispatcher } from "../../../dispatcher";
import { NextlyError } from "../../../errors/nextly-error";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

const TAGS = "hmftags";
const POSTS = "hmfposts";

// Readable by anyone, so the REST reads below, made with no signed-in user, are judged as a
// visitor's and allowed.
const tags = defineCollection({
  slug: TAGS,
  fields: [text({ name: "name" })],
  access: { read: () => true },
});
const posts = defineCollection({
  slug: POSTS,
  fields: [
    text({ name: "title" }),
    relationship({ name: "tags", relationTo: TAGS, hasMany: true }),
  ],
  access: { read: () => true },
});

/** Each post's title, and the tags it holds. */
const POSTS_HOLDING: Record<string, string[]> = {
  pa: ["a"],
  pab: ["ab"],
  pb: ["b"],
  pboth: ["a", "b"],
  pnone: [],
};

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<void> {
  current = await createTestNextly({
    dialect,
    collections: [tags, posts],
    // The Public role, granted the reads whose rule answers `true`.
    seedPublic: true,
  });
  const { nextly, adapter } = current;
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  for (const [title, held] of Object.entries(POSTS_HOLDING)) {
    await nextly.create({ collection: POSTS, data: { title } });
    // The stored list, as a write keeps it: a JSON list of ids, NULL for none.
    const list = held.length === 0 ? "NULL" : `'${JSON.stringify(held)}'`;
    await adapter.executeQuery(
      `UPDATE ${q(`dc_${POSTS}`)} SET ${q("tags")} = ${list} WHERE ${q("title")} = '${title}'`
    );
  }
}

type Where = Record<string, Record<string, unknown>>;

/** The titles a Direct API read with `where` finds, sorted. */
async function direct(where: Where): Promise<string[]> {
  const found = await current!.nextly.find({
    collection: POSTS,
    where,
    limit: 50,
    depth: 0,
  });
  return found.items.map(item => String(item.title)).sort();
}

/** A REST list read with `where`, through the dispatcher the route handler calls. */
async function restResult(where: Where) {
  return new ServiceDispatcher().dispatch({
    service: "collections",
    operation: "single",
    method: "listEntries",
    params: {
      collectionName: POSTS,
      where: JSON.stringify(where),
      limit: "50",
      depth: "0",
    },
  });
}

/** The titles a REST read with `where` finds, sorted. */
async function rest(where: Where): Promise<string[]> {
  const result = await restResult(where);
  expect(result.success, JSON.stringify(result.error)).toBe(true);
  const body = (await (result.data as Response).json()) as {
    items: { title: string }[];
  };
  return body.items.map(item => item.title).sort();
}

/** Both doors answer `where` with the same titles. */
async function bothFind(where: Where): Promise<string[]> {
  const viaDirect = await direct(where);
  expect(await rest(where)).toEqual(viaDirect);
  return viaDirect;
}

describe.each(getConfiguredTestDialects())(
  "filtering a has-many relationship on %s",
  dialect => {
    it("finds an entry holding any of the ids with in and equals", async () => {
      await boot(dialect);
      expect(await bothFind({ tags: { in: ["a"] } })).toEqual(["pa", "pboth"]);
      expect(await bothFind({ tags: { equals: "a" } })).toEqual([
        "pa",
        "pboth",
      ]);
      expect(await bothFind({ tags: { in: ["a", "b"] } })).toEqual([
        "pa",
        "pb",
        "pboth",
      ]);
    });

    it("finds an entry holding none of the ids with not_in and not_equals, one with none included", async () => {
      await boot(dialect);
      expect(await bothFind({ tags: { not_in: ["a"] } })).toEqual([
        "pab",
        "pb",
        "pnone",
      ]);
      expect(await bothFind({ tags: { not_equals: "a" } })).toEqual([
        "pab",
        "pb",
        "pnone",
      ]);
      expect(await bothFind({ tags: { not_in: ["a", "b"] } })).toEqual([
        "pab",
        "pnone",
      ]);
    });

    it.each(["contains", "search", "like"])(
      "refuses %s with a 400 that names the operator to use",
      async operator => {
        await boot(dialect);
        const where = { tags: { [operator]: "a" } };

        const refused = await direct(where).then(
          () => undefined,
          (error: unknown) => error
        );
        expect(NextlyError.isValidation(refused)).toBe(true);
        const [problem] =
          (refused as { publicData?: { errors?: { message: string }[] } })
            .publicData?.errors ?? [];
        expect(problem?.message).toContain('"in"');

        const result = await restResult(where);
        expect(result.success).toBe(false);
        expect(result.error?.statusCode).toBe(400);
      }
    );
  }
);
