/**
 * A Direct API read refuses a filter that is not well formed, on every
 * configured dialect.
 *
 * Each filter below used to have its bad part dropped before the query ran,
 * so the read returned every entry instead of the one asked for. The fixture
 * holds three entries and each malformed filter targets one of them, so a
 * dropped filter is visible as three rows; the refusal is asserted as the
 * typed error the caller receives. The control proves the same read works
 * with the well-formed spelling, so a guard refusing everything fails it.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, relationship, text } from "../../config";
import { NextlyError } from "../../errors/nextly-error";
import type { WhereFilter } from "../../services/collections/query-operators";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "people",
        access: { read: () => true },
        fields: [text({ name: "name" })],
      }),
      defineCollection({
        slug: "notes",
        access: { read: () => true, create: () => true },
        fields: [
          text({ name: "title" }),
          relationship({ name: "author", relationTo: "people" }),
        ],
      }),
    ],
  });
  const ada = await current.nextly.create({
    collection: "people",
    data: { name: "Ada" },
    overrideAccess: true,
  });
  for (const title of ["alpha", "beta", "gamma"]) {
    await current.nextly.create({
      collection: "notes",
      data: { title, author: title === "alpha" ? ada.item.id : null },
      overrideAccess: true,
    });
  }
  return current;
}

/** The error codes a read was refused with, or a failure if it answered. */
async function refusal(read: Promise<unknown>): Promise<string[]> {
  let caught: unknown;
  let answered: unknown;
  try {
    answered = await read;
  } catch (error) {
    caught = error;
  }
  expect(
    caught,
    `expected a refusal, and the read answered ${JSON.stringify(answered)}`
  ).toBeDefined();
  expect(NextlyError.is(caught), String(caught)).toBe(true);
  const e = caught as NextlyError;
  expect(e.statusCode).toBe(400);
  return (e.publicData as { errors: { code: string }[] }).errors.map(
    x => x.code
  );
}

const MALFORMED: Array<[string, WhereFilter, string]> = [
  [
    "an unknown operator",
    { title: { equal: "alpha" } } as WhereFilter,
    "FILTER_UNKNOWN_OPERATOR",
  ],
  [
    "an undefined operand",
    { title: { equals: undefined } } as WhereFilter,
    "FILTER_UNDEFINED_VALUE",
  ],
  [
    "an unknown field",
    { titel: { equals: "alpha" } } as WhereFilter,
    "FILTER_UNKNOWN_FIELD",
  ],
  ["an empty in", { title: { in: [] } } as WhereFilter, "FILTER_EMPTY_IN"],
  [
    "a dot path into a relationship",
    { "author.name": { equals: "Ada" } } as WhereFilter,
    "FILTER_UNFILTERABLE_PATH",
  ],
  [
    "an and that is not a list",
    { and: { title: { equals: "alpha" } } } as unknown as WhereFilter,
    "FILTER_INVALID_LOGICAL",
  ],
  [
    "a malformed language filter",
    { _translated: { locale: "fr", state: "done" } } as WhereFilter,
    "FILTER_INVALID_OPERAND",
  ],
];

describe.each(getConfiguredTestDialects())(
  "Direct API refuses a malformed filter (%s)",
  dialect => {
    it("answers the well-formed filter with the one entry it names", async () => {
      const t = await boot(dialect);
      const all = await t.nextly.find({ collection: "notes" });
      expect(all.items).toHaveLength(3);
      const one = await t.nextly.find({
        collection: "notes",
        where: { title: { equals: "alpha" } },
      });
      expect(one.items.map(i => (i as { title: string }).title)).toEqual([
        "alpha",
      ]);
    });

    it("refuses each malformed filter on find and on count", async () => {
      const t = await boot(dialect);
      for (const [name, where, code] of MALFORMED) {
        expect(
          await refusal(t.nextly.find({ collection: "notes", where })),
          `find with ${name}`
        ).toContain(code);
        expect(
          await refusal(t.nextly.count({ collection: "notes", where })),
          `count with ${name}`
        ).toContain(code);
      }
    });

    it("matches no entry for an empty or", async () => {
      // A computed `or: ids.map(...)` with no ids means "none of them". It
      // used to be dropped, which answered every entry.
      const t = await boot(dialect);
      const none = await t.nextly.find({
        collection: "notes",
        where: { or: [] },
      });
      expect(none.items).toHaveLength(0);
    });
  }
);
