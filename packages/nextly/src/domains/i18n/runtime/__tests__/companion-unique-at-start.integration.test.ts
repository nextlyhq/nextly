/**
 * A start that makes a code-first entity's translations table makes its
 * per-language unique indexes with it, as `nextly migrate` and the
 * development reload do.
 *
 * Every installation keeps its text fields in the translations table, a
 * unique slug included, so a table made without its indexes accepted one
 * value twice. A value already held twice is not a reason to refuse the start:
 * the field is left without its index and named in a warning, as the reload
 * names it. (A table a start makes is new, so that is the reconcile's own
 * case, asked of it directly.)
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { perLanguageStorageSuite } from "../../../../__tests__/storage-layout";
import { defineCollection, text } from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { readIndexUniqueness } from "../../../schema/pipeline/live-table-facts";
import { companionUniqueIndexName } from "../../migration/companion-unique-indexes";
import { reconcileCompanionUniquesAtStart } from "../companion-unique-reconcile";

perLanguageStorageSuite();

const COLLECTION = "articles";
const TABLE = "dc_articles";
const COMPANION = `${TABLE}_locales`;
const SLUG_INDEX = companionUniqueIndexName(COMPANION, "slug");

const articles = defineCollection({
  slug: COLLECTION,
  fields: [text({ name: "title" }), text({ name: "slug", unique: true })],
});

let handle: TestNextly | undefined;
let dir: string;
let previousDialect: string | undefined;

beforeEach(() => {
  previousDialect = process.env.DB_DIALECT;
  dir = mkdtempSync(join(tmpdir(), "nextly-companion-unique-"));
});

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  rmSync(dir, { recursive: true, force: true });
});

/** A start on a database of its own, on file. */
async function start(): Promise<TestNextly> {
  process.env.DB_DIALECT = "sqlite";
  const adapter = await createAdapter({
    type: "sqlite",
    url: `file:${join(dir, "site.db")}`,
  } as Parameters<typeof createAdapter>[0]);
  handle = await createTestNextly({ adapter, collections: [articles] });
  return handle;
}

async function create(t: TestNextly, title: string, slug: string) {
  return t.nextly.create({
    collection: COLLECTION,
    data: { title, slug },
    overrideAccess: true,
  });
}

/** Whether the translations table holds the slug's unique index. */
async function slugIndexed(t: TestNextly): Promise<boolean> {
  const indexes = await readIndexUniqueness(
    t.adapter.getDrizzle(),
    "sqlite",
    COMPANION
  );
  return indexes.get(SLUG_INDEX)?.unique === true;
}

describe("a translations table a start makes keeps its unique fields", () => {
  it("refuses a unique translated value twice once the start has made the table", async () => {
    const t = await start();

    expect(await slugIndexed(t)).toBe(true);
    await create(t, "One", "same");
    await expect(create(t, "Two", "same")).rejects.toMatchObject({
      code: "DUPLICATE",
    });
  });

  it("leaves a field whose value is held twice without its index, naming it, and never throws", async () => {
    const t = await start();
    // A table made before its index was, holding one slug twice.
    await t.adapter.executeQuery(`DROP INDEX "${SLUG_INDEX}"`);
    await create(t, "One", "same");
    await create(t, "Two", "same");
    const warnings: string[] = [];

    await expect(
      reconcileCompanionUniquesAtStart(
        t.adapter,
        {
          builtBy: "codeFirst",
          slug: COLLECTION,
          tableName: TABLE,
          fields: articles.fields,
        },
        message => warnings.push(message)
      )
    ).resolves.toBeUndefined();

    expect(await slugIndexed(t)).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /Could not index the translations table for "articles"/
    );
    expect(warnings[0]).toMatch(/slug/);
    // The entity still reads and writes.
    await create(t, "Three", "other");
  });
});
