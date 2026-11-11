/**
 * How `migrate:create`'s generator judges a shared field that becomes translated while its storage
 * changes, as a writer that knows the database asks it to (`joiningJudgement`): worded for the
 * surface the change came from, and, for a field whose values an earlier apply of the same change
 * already moved, judged as a retry. A file that widens such a field still copies every value; one
 * that narrows it is refused with how to finish the earlier change.
 */
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it } from "vitest";

import {
  generateMigration,
  type GenerateArgs,
  type MinimalConfigEntity,
} from "../generate";

/** `docs` with a translated `headline` and a decimal `price`, translated or not. */
const docs = (
  priceTranslated: boolean,
  precision: number
): MinimalConfigEntity => ({
  slug: "docs",
  tableName: "dc_docs",
  localized: true,
  fields: [
    { name: "headline", type: "text", localized: true },
    {
      name: "price",
      type: "number",
      dbType: "decimal",
      precision,
      scale: 2,
      localized: priceTranslated,
    },
  ],
});

/**
 * Generate `docs` with `price` shared as decimal(10,2), then translated at `precision`, and
 * return the second run's new files, or its refusal.
 */
async function joinAt(
  dialect: SupportedDialect,
  precision: number,
  judgement?: GenerateArgs["joiningJudgement"]
): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), "nextly-join-judgement-"));
  const run = (entity: MinimalConfigEntity, name: string, at: string) =>
    generateMigration({
      name,
      dialect,
      migrationsDir: dir,
      defaultLocale: "en",
      collections: [entity],
      singles: [],
      components: [],
      nonInteractive: true,
      now: new Date(at),
      ...(judgement === undefined ? {} : { joiningJudgement: judgement }),
    });
  await run(docs(false, 10), "one", "2026-11-11T10:00:00.000Z");
  const before = new Set(await readdir(dir));
  await run(docs(true, precision), "two", "2026-11-11T11:00:00.000Z");
  return (await readdir(dir)).filter(f => !before.has(f) && f.endsWith(".sql"));
}

/** The Builder's judgement: the retries its database shows, as its preflight judged them. */
const builder = (
  moved: string[],
  narrowed: string[] = []
): NonNullable<GenerateArgs["joiningJudgement"]> => ({
  slug: "docs",
  surface: "builder",
  retries: { moved: new Set(moved), narrowed: new Set(narrowed) },
});

describe.each(["postgresql", "mysql"] as const)(
  "the generator's judgement of a field joining translation as it is reshaped (%s)",
  dialect => {
    it("refuses a first join in the words for code when no writer says otherwise", async () => {
      await expect(joinAt(dialect, 8)).rejects.toThrow(
        /"price" changes how it is stored.*nextly migrate:create/
      );
    });

    it("words a first join's refusal for the Builder when the Builder writes the file", async () => {
      const refused = joinAt(dialect, 8, builder([]));
      await expect(refused).rejects.toThrow(
        /Its type, length or precision changes.*Turn off Localized/
      );
    });

    it("refuses a retry that narrows a field already moved, saying how to finish it", async () => {
      await expect(
        joinAt(dialect, 8, builder(["price"], ["price"]))
      ).rejects.toThrow(
        /earlier change that made "price" translated did not finish.*Save it with its earlier type/
      );
    });

    it("writes a retry that widens a field already moved, its values copied whole", async () => {
      expect(await joinAt(dialect, 12, builder(["price"]))).toContainEqual(
        expect.stringMatching(/_joins_localization_docs\.sql$/)
      );
    });

    it("judges another entity's joining field as a first join", async () => {
      await expect(
        joinAt(dialect, 12, { ...builder(["price"]), slug: "other" })
      ).rejects.toThrow(
        /"price" changes how it is stored.*nextly migrate:create/
      );
    });
  }
);
