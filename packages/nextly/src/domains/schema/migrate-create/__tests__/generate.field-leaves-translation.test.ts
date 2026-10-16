/**
 * `migrate:create` for a field that stops being translated while its entity stays translated.
 *
 * The field's values live in the companion `<table>_locales`, one row per language. Making it
 * shared gives the main table a column for it; the migration has to fill that column with the
 * default language's value, keep the other languages in the archive, and only then drop the
 * companion column. Three files, ordered by name:
 *
 *   1. before the main file: the archive writes, so an archive that refuses them stops the run
 *      before the main table changes;
 *   2. the main file: the main table gains the column;
 *   3. after it: the copy of the default language's value and the companion drop. Its DOWN puts
 *      the column back and refills it, from main for the default language and from the archive
 *      for the others.
 */
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it } from "vitest";

import { generateMigration, type MinimalConfigEntity } from "../generate";

const TRANSLATED: MinimalConfigEntity = {
  slug: "docs",
  tableName: "dc_docs",
  localized: true,
  fields: [
    { name: "body", type: "text", localized: true },
    { name: "price", type: "number" },
  ],
};

const SHARED: MinimalConfigEntity = {
  ...TRANSLATED,
  fields: [
    { name: "body", type: "text", localized: false },
    { name: "price", type: "number" },
  ],
};

/**
 * Run `migrate:create` twice and return the files the second run wrote, in name order.
 * `beforeSecond` runs between the two, on the migrations directory.
 */
async function secondRun(
  dialect: SupportedDialect,
  next: MinimalConfigEntity,
  options: {
    first?: MinimalConfigEntity;
    onWarning?: (message: string) => void;
    beforeSecond?: (dir: string) => Promise<void>;
  } = {}
): Promise<{ name: string; sql: string }[]> {
  const dir = await mkdtemp(join(tmpdir(), "nextly-field-leaves-"));
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
      ...(options.onWarning ? { onWarning: options.onWarning } : {}),
    });
  await run(options.first ?? TRANSLATED, "one", "2026-10-16T10:00:00.000Z");
  await options.beforeSecond?.(dir);
  const before = new Set(await readdir(dir));
  await run(next, "two", "2026-10-16T11:00:00.000Z");
  const written = (await readdir(dir))
    .filter(f => f.endsWith(".sql") && !before.has(f))
    .sort();
  return Promise.all(
    written.map(async name => ({
      name,
      sql: await readFile(resolve(dir, name), "utf-8"),
    }))
  );
}

/** A file's UP and DOWN sections. */
function sections(sql: string): { up: string; down: string } {
  const [, rest = ""] = sql.split("-- UP\n");
  const [up = "", down = ""] = rest.split("-- DOWN\n");
  return { up, down };
}

describe.each(["sqlite", "postgresql", "mysql"] as const)(
  "migrate:create when a field stops being translated (%s)",
  dialect => {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    it("archives first, adds the shared column, then copies and drops", async () => {
      const files = await secondRun(dialect, SHARED);

      expect(files.map(f => f.name)).toEqual([
        expect.stringMatching(/_archive_localization_docs\.sql$/),
        expect.stringMatching(/_two\.sql$/),
        expect.stringMatching(/_shared_localization_docs\.sql$/),
      ]);
      const [archive, main, shared] = files.map(f => sections(f.sql));

      expect(archive.up).toContain(`INSERT INTO ${q("nextly_i18n_archive")}`);
      expect(archive.up).toContain(`'body'`);
      expect(main.up).toContain(
        `ALTER TABLE ${q("dc_docs")} ADD COLUMN ${q("body")}`
      );
      expect(shared.up).toMatch(
        new RegExp(`UPDATE ${escape(q("dc_docs"))} SET ${escape(q("body"))}`)
      );
      expect(shared.up).toContain(
        `ALTER TABLE ${q("dc_docs_locales")} DROP COLUMN ${q("body")}`
      );
      // The copy runs before the drop that would lose its source.
      expect(shared.up.indexOf("UPDATE")).toBeLessThan(
        shared.up.indexOf("DROP COLUMN")
      );
      expect(shared.down).toContain(
        `ALTER TABLE ${q("dc_docs_locales")} ADD COLUMN ${q("body")}`
      );
      expect(shared.down).toContain(q("nextly_i18n_archive"));
    });

    it("refuses a field that changes type as it leaves, read from the migration history", async () => {
      // The snapshot records only the translated columns' names; the companion file the first run
      // wrote records that `body` is text.
      await expect(
        secondRun(dialect, {
          ...SHARED,
          fields: [
            { name: "body", type: "number", localized: false },
            { name: "price", type: "number" },
          ],
        })
      ).rejects.toThrow(/"body" changes how it is stored/);
    });

    it("refuses a slug leaving translation, which its automatic unique index covers", async () => {
      // No `unique` flag and no declared index: every `slug` column gets a unique index of its own,
      // which the main file creates while the column is still empty.
      const withSlug = (localized: boolean) => ({
        ...TRANSLATED,
        fields: [
          { name: "slug", type: "text", localized },
          { name: "price", type: "number" },
        ],
      });
      await expect(
        secondRun(dialect, withSlug(false), { first: withSlug(true) })
      ).rejects.toThrow(/"slug" is unique/);
    });

    it("refuses a field a unique index covers, naming it", async () => {
      await expect(
        secondRun(dialect, {
          ...SHARED,
          indexes: [{ fields: ["body"], unique: true }],
        })
      ).rejects.toThrow(/"body" is unique/);
    });

    it("warns when no migration file says how the field is stored", async () => {
      const warnings: string[] = [];
      // The companion file the first run wrote, gone: nothing describes `body`'s column now.
      const files = await secondRun(dialect, SHARED, {
        onWarning: message => warnings.push(message),
        beforeSecond: async dir => {
          for (const name of await readdir(dir)) {
            if (name.includes("_localization_")) await rm(resolve(dir, name));
          }
        },
      });

      expect(files.length).toBe(3);
      expect(warnings).toEqual([
        expect.stringMatching(
          /No migration file describes how "body" is stored/
        ),
      ]);
    });

    it.each([
      { before: false, after: true, rollbackWrites: false },
      { before: true, after: true, rollbackWrites: true },
    ])(
      "rolls back with _status only when Draft/Published was on before and stays on (before $before, after $after)",
      async ({ before, after, rollbackWrites }) => {
        const files = await secondRun(
          dialect,
          { ...SHARED, status: after },
          { first: { ...TRANSLATED, status: before } }
        );

        const shared = sections(
          files.find(f => f.name.includes("_shared_localization_"))?.sql ?? ""
        );
        expect(shared.down.includes(q("_status"))).toBe(rollbackWrites);
      }
    );

    it("warns when a translated field goes and a shared one arrives in the same change", async () => {
      const warnings: string[] = [];
      await secondRun(
        dialect,
        {
          ...TRANSLATED,
          fields: [
            { name: "content", type: "text", localized: false },
            { name: "price", type: "number" },
          ],
        },
        { onWarning: message => warnings.push(message) }
      );

      expect(warnings).toEqual([
        expect.stringMatching(
          /translated "body" is gone and shared "content" is new/
        ),
      ]);
    });

    it("refuses a required field leaving translation, naming it", async () => {
      await expect(
        secondRun(dialect, {
          ...SHARED,
          fields: [
            { name: "body", type: "text", localized: false, required: true },
            { name: "price", type: "number" },
          ],
        })
      ).rejects.toThrow(/"body" is required/);
    });
  }
);

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
