/**
 * A code-first translated field marked unique gets its per-language index from the reconcile that
 * `db:sync` and the dev reload run, which also drops it when the rule goes, plans nothing on a
 * second run, and holds the index back, naming the documents, where a language already holds a
 * value twice.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../../config";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { readIndexNames } from "../../schema/pipeline/live-table-facts";
import { companionUniqueIndexName } from "../migration/companion-unique-indexes";
import { reconcileCompanionUniqueIndexes } from "../runtime/companion-unique-reconcile";
import { warnAboutUnindexedTranslatedUnique } from "../runtime/translated-unique-boot-check";

const COMPANION = "dc_articles_locales";
const INDEX = companionUniqueIndexName(COMPANION, "handle");

describeEachDialect("a code-first translated unique field", dialect => {
  let current: TestNextly;

  beforeEach(async () => {
    current = await createTestNextly({
      dialect,
      collections: [
        defineCollection({
          slug: "articles",
          localized: true,
          fields: [text({ name: "handle" })],
        }),
      ],
      localization: { locales: ["en", "fr"], defaultLocale: "en" },
    });
  });

  afterEach(async () => {
    await current.destroy();
  });

  /** One sync of the companion's unique indexes for `handle`, and what it reported. */
  async function sync(unique: boolean): Promise<string[]> {
    const reported: string[] = [];
    await reconcileCompanionUniqueIndexes(
      current.adapter,
      {
        builtBy: "codeFirst",
        tableName: "dc_articles",
        fields: [{ name: "handle", type: "text", unique }],
      },
      error =>
        reported.push(error instanceof Error ? error.message : String(error))
    );
    return reported;
  }

  const indexes = () =>
    readIndexNames(current.adapter.getDrizzle(), dialect, COMPANION);

  async function write(handle: string): Promise<string> {
    const created = await current.nextly.create({
      collection: "articles",
      data: { handle },
      locale: "en",
      overrideAccess: true,
    });
    return String(created.item.id);
  }

  it("gives the field its index, plans nothing the second time, and drops it when the rule goes", async () => {
    expect(await sync(true)).toEqual([]);
    expect(await indexes()).toContain(INDEX);
    await write("about");
    await expect(write("about")).rejects.toThrow();

    const executed = vi.spyOn(current.adapter, "executeQuery");
    expect(await sync(true)).toEqual([]);
    expect(
      executed.mock.calls.filter(([statement]) => /INDEX/i.test(statement))
    ).toEqual([]);
    executed.mockRestore();

    expect(await sync(false)).toEqual([]);
    expect(await indexes()).not.toContain(INDEX);
    expect(await write("about")).toBeTruthy();
  });

  it("holds the index back where a language already holds a value twice, naming the documents", async () => {
    const a = await write("about");
    const b = await write("about");

    const reported = await sync(true);

    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain(a);
    expect(reported[0]).toContain(b);
    expect(reported[0]).not.toContain("about");
    expect(await indexes()).not.toContain(INDEX);
  });

  it("names the field at boot, with the commands, until its index is there", async () => {
    const config = {
      collections: [
        {
          slug: "articles",
          localized: true,
          fields: [{ name: "handle", type: "text", unique: true }],
        },
      ],
    };
    const warned = async () => {
      const said: string[] = [];
      await warnAboutUnindexedTranslatedUnique(current.adapter, config, m =>
        said.push(m)
      );
      return said;
    };

    const before = await warned();
    expect(before).toHaveLength(1);
    expect(before[0]).toContain('"handle"');
    expect(before[0]).toContain("nextly migrate:create");

    await sync(true);
    expect(await warned()).toEqual([]);
  });

  it("through the Direct API, refuses a duplicate as DUPLICATE and reads blanks as before", async () => {
    const blankBefore = await write("");
    const readBlank = async (id: string) =>
      (
        await current.nextly.findByID({
          collection: "articles",
          id,
          locale: "en",
          overrideAccess: true,
        })
      )?.handle;
    const before = await readBlank(blankBefore);

    await sync(true);

    const blankAfter = await write("");
    expect(await readBlank(blankAfter)).toEqual(before);
    expect(await readBlank(blankBefore)).toEqual(before);
    await write("about");
    await expect(write("about")).rejects.toMatchObject({ code: "DUPLICATE" });
  });
});
