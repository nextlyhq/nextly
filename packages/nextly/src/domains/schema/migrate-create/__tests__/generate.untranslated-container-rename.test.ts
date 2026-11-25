// A repeater renamed in an entity that is not translated. Under per-language storage such an
// entity still keeps its translatable values per language, a container's text inside among them:
// each language's text in the container's overlay column on the translations table. Renamed, the
// overlay follows the structure where the rename is accepted, or every language's text is left in
// a column no read names, and dropped with it. Every dialect.

import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it } from "vitest";

import { perLanguageStorageSuite } from "../../../../__tests__/storage-layout";
import { generateMigration, type MinimalConfigEntity } from "../generate";

// As every installation lays tables out: an entity that is not translated still keeps its
// translatable values per language.
perLanguageStorageSuite();

const untranslated = (
  fields: MinimalConfigEntity["fields"]
): MinimalConfigEntity => ({
  slug: "boxes",
  tableName: "dc_boxes",
  fields,
});

const container = (name: string) => ({
  name,
  type: "group",
  fields: [
    { name: "label", type: "text" },
    { name: "size", type: "number" },
  ],
});

/** The UP and DOWN of the first run, and of every file a second run writes after it. */
async function runs(
  dialect: SupportedDialect,
  before: MinimalConfigEntity,
  after: MinimalConfigEntity
): Promise<{ first: string; up: string; down: string }> {
  const dir = await mkdtemp(join(tmpdir(), "nextly-untranslated-rename-"));
  const run = (entity: MinimalConfigEntity, name: string, at: string) =>
    generateMigration({
      name,
      dialect,
      migrationsDir: dir,
      defaultLocale: "en",
      collections: [entity],
      singles: [],
      components: [],
      // migrate:create without a terminal, renames accepted.
      nonInteractive: true,
      autoAcceptRenames: true,
      now: new Date(at),
    });
  const read = async (names: string[]) =>
    Promise.all(names.map(name => readFile(resolve(dir, name), "utf-8")));
  await run(before, "one", "2026-11-25T10:00:00.000Z");
  const firstFiles = (await readdir(dir)).filter(f => f.endsWith(".sql"));
  const first = (await read(firstFiles)).join("\n");
  await run(after, "two", "2026-11-25T11:00:00.000Z");
  const written = (await readdir(dir))
    .filter(f => f.endsWith(".sql") && !firstFiles.includes(f))
    .sort();
  const texts = await read(written);
  return {
    first,
    up: texts
      .map(t => t.split("-- UP\n")[1]?.split("-- DOWN\n")[0] ?? "")
      .join("\n"),
    down: texts.map(t => t.split("-- DOWN\n")[1] ?? "").join("\n"),
  };
}

describe.each(["sqlite", "postgresql", "mysql"] as const)(
  "a container renamed in an entity that is not translated (%s)",
  dialect => {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    const onCompanion = (statement: string) =>
      new RegExp(`${escape(q("dc_boxes_locales"))}[^;]*${statement}`);

    it("renames its overlay column with it where the rename is accepted", async () => {
      const { first, up, down } = await runs(
        dialect,
        untranslated([container("box")]),
        untranslated([container("crate")])
      );

      // POPULATION CONTROL: the container keeps its text in an overlay column.
      expect(first).toMatch(new RegExp(`${escape(q("box"))}`));
      expect(first).toMatch(new RegExp(escape(q("dc_boxes_locales"))));

      expect(up).toMatch(
        onCompanion(
          `RENAME COLUMN ${escape(q("box"))} TO ${escape(q("crate"))}`
        )
      );
      expect(up).not.toMatch(
        onCompanion(`ADD (COLUMN )?${escape(q("crate"))}`)
      );
      expect(up).not.toMatch(onCompanion(`DROP COLUMN ${escape(q("box"))}`));
      expect(down).toMatch(
        onCompanion(
          `RENAME COLUMN ${escape(q("crate"))} TO ${escape(q("box"))}`
        )
      );
    });
  }
);

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
