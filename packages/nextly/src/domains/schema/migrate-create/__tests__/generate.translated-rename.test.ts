// A translated field renamed in a translated entity is written as a rename of its column in the
// entity's translations table, where the rename is accepted: the values stay under the new name.
// Declined, the new column is added as before, and the old one keeps its values. On every road
// (`migrate:create` with renames accepted, a Builder save with the person's choice), every dialect.

import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it } from "vitest";

import { generateMigration, type MinimalConfigEntity } from "../generate";

const translated = (
  fields: MinimalConfigEntity["fields"]
): MinimalConfigEntity => ({
  slug: "posts",
  tableName: "dc_posts",
  localized: true,
  fields,
});

const VIEWS = { name: "views", type: "number", localized: false };

/** The UP and DOWN of every file a second run writes, after a first for `before`. */
async function secondRun(
  dialect: SupportedDialect,
  before: MinimalConfigEntity,
  after: MinimalConfigEntity,
  acceptRenames: boolean
): Promise<{ up: string; down: string }> {
  const dir = await mkdtemp(join(tmpdir(), "nextly-translated-rename-"));
  const run = (entity: MinimalConfigEntity, name: string, at: string) =>
    generateMigration({
      name,
      dialect,
      migrationsDir: dir,
      defaultLocale: "en",
      collections: [entity],
      singles: [],
      components: [],
      // migrate:create without a terminal: renames as `--accept-renames` says.
      nonInteractive: true,
      autoAcceptRenames: acceptRenames,
      now: new Date(at),
    });
  await run(before, "one", "2026-11-06T10:00:00.000Z");
  const first = new Set(await readdir(dir));
  await run(after, "two", "2026-11-06T11:00:00.000Z");
  const written = (await readdir(dir))
    .filter(f => f.endsWith(".sql") && !first.has(f))
    .sort();
  const texts = await Promise.all(
    written.map(name => readFile(resolve(dir, name), "utf-8"))
  );
  return {
    up: texts
      .map(t => t.split("-- UP\n")[1]?.split("-- DOWN\n")[0] ?? "")
      .join("\n"),
    down: texts.map(t => t.split("-- DOWN\n")[1] ?? "").join("\n"),
  };
}

describe.each(["sqlite", "postgresql", "mysql"] as const)(
  "a translated field renamed (%s)",
  dialect => {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    const before = translated([{ name: "heading", type: "text" }, VIEWS]);
    const after = translated([{ name: "title2", type: "text" }, VIEWS]);

    it("refuses a rename that also changes the field's storage, since a rename keeps the column's type", async () => {
      // `heading` was translated text; renamed to `score`, it becomes a number in the same change.
      const reshaped = translated([
        { name: "score", type: "number", localized: true },
        VIEWS,
      ]);
      await expect(
        secondRun(dialect, before, reshaped, true)
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              code: "RESHAPED_TRANSLATED_FIELD_RENAMED",
            }),
          ],
        },
      });
    });

    it("renames its column in the translations table where the rename is accepted", async () => {
      const { up, down } = await secondRun(dialect, before, after, true);

      expect(up).toMatch(
        new RegExp(
          `${escape(q("dc_posts_locales"))}[^;]*RENAME COLUMN ${escape(q("heading"))} TO ${escape(q("title2"))}`
        )
      );
      expect(up).not.toMatch(new RegExp(`ADD COLUMN ${escape(q("title2"))}`));
      expect(down).toMatch(
        new RegExp(
          `RENAME COLUMN ${escape(q("title2"))} TO ${escape(q("heading"))}`
        )
      );
    });

    it("adds the new column, as before, where the rename is declined", async () => {
      const { up } = await secondRun(dialect, before, after, false);

      expect(up).toMatch(new RegExp(`ADD COLUMN ${escape(q("title2"))}`));
      expect(up).not.toMatch(/RENAME COLUMN/);
    });
  }
);

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
