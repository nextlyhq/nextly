/**
 * Every installation keeps its translatable fields per language: `experimental.perLanguageStorage`
 * no longer chooses a layout. Set to `false` in a site's configuration it changes nothing but a
 * warning at the start, which says the setting is deprecated; left out, it is not mentioned.
 *
 * The plausible broken implementations: one where `false` still keeps a collection's translatable
 * values on its main table, and one that says nothing about a setting that now does nothing.
 */
import { sql } from "drizzle-orm";
import { afterEach, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { Logger } from "../../../services/shared";
import { _resetPerLanguageStorage } from "../per-language-storage";

describeEachDialect("per-language storage for every installation", dialect => {
  let t: TestNextly | undefined;

  afterEach(async () => {
    await t?.destroy();
    t = undefined;
    _resetPerLanguageStorage();
  });

  /** A site with one collection that is not translated, booted with `setting`, and its warnings. */
  async function boot(setting: boolean | undefined): Promise<string[]> {
    const warnings: string[] = [];
    const logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: (message: string) => {
        warnings.push(message);
      },
      error: () => undefined,
    } as unknown as Logger;
    t = await createTestNextly({
      dialect,
      logger,
      ...(setting === undefined ? {} : { perLanguageStorage: setting }),
      collections: [
        defineCollection({ slug: "notes", fields: [text({ name: "title" })] }),
      ],
    });
    return warnings;
  }

  /** The title of the note `id` as its per-language table keeps it. */
  async function titleKeptPerLanguage(id: string): Promise<unknown> {
    const rows = await t!.adapter.queryStatement<{ title: unknown }>(
      sql`SELECT ${sql.identifier("title")} AS ${sql.identifier("title")} FROM ${sql.identifier("dc_notes_locales")} WHERE ${sql.identifier("_parent")} = ${id}`
    );
    return rows[0]?.title;
  }

  it("keeps translatable values per language with the setting false, and only warns", async () => {
    const warnings = await boot(false);
    const created = await t!.nextly.create({
      collection: "notes",
      data: { title: "hello" },
    });

    expect(await titleKeptPerLanguage(String(created.item.id))).toBe("hello");
    expect(warnings).toContainEqual(
      expect.stringMatching(/perLanguageStorage[\s\S]*deprecated/)
    );
  });

  it("keeps them per language without the setting, saying nothing of it", async () => {
    const warnings = await boot(undefined);
    const created = await t!.nextly.create({
      collection: "notes",
      data: { title: "hello" },
    });

    expect(await titleKeptPerLanguage(String(created.item.id))).toBe("hello");
    expect(
      warnings.filter(message => /perLanguageStorage/.test(message))
    ).toEqual([]);
  });
});
