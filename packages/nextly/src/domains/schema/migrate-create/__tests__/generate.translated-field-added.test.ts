// A translated field added to an entity that is already translated is recorded in the migration
// `migrate:create` writes: an `adds` file whose UP adds the field's column to the entity's
// translations table and whose DOWN drops it. Its main table doesn't change, so without that file
// the run would write nothing, and only `nextly migrate`'s reconcile would add the column.

import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it } from "vitest";

import { parseLocalizationIntent } from "../../../i18n/migration/migration-intent";
import { generateMigration, type MinimalConfigEntity } from "../generate";

type Kind = "collections" | "singles" | "components";

const translated = (
  tableName: string,
  fields: MinimalConfigEntity["fields"]
): MinimalConfigEntity => ({
  slug: "docs",
  tableName,
  localized: true,
  fields,
});

const BODY = { name: "body", type: "text", localized: true };
const SUMMARY = { name: "summary", type: "text", localized: true };

/** The files a second `migrate:create` writes, after a first one for `before`, in name order. */
async function filesAdding(
  dialect: SupportedDialect,
  kind: Kind,
  before: MinimalConfigEntity,
  after: MinimalConfigEntity
): Promise<{ name: string; sql: string }[]> {
  const dir = await mkdtemp(join(tmpdir(), "nextly-field-added-"));
  const run = (entity: MinimalConfigEntity, name: string, at: string) =>
    generateMigration({
      name,
      dialect,
      migrationsDir: dir,
      defaultLocale: "en",
      collections: [],
      singles: [],
      components: [],
      [kind]: [entity],
      nonInteractive: true,
      now: new Date(at),
    });
  await run(before, "one", "2026-11-02T10:00:00.000Z");
  const first = new Set(await readdir(dir));
  await run(after, "two", "2026-11-02T11:00:00.000Z");
  const written = (await readdir(dir))
    .filter(f => f.endsWith(".sql") && !first.has(f))
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
  "migrate:create when a translated field is added to a translated entity (%s)",
  dialect => {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    it.each([
      ["collection", "collections", "dc_docs", "collection"],
      ["Single", "singles", "single_docs", "single"],
      ["field group", "components", "comp_docs", "fieldGroup"],
    ] as const)(
      "writes an adds file for a %s: UP adds the column to its translations table, DOWN drops it",
      async (_label, kind, table, entity) => {
        const files = await filesAdding(
          dialect,
          kind,
          translated(table, [BODY]),
          translated(table, [BODY, SUMMARY])
        );

        const adds = files.filter(
          f => parseLocalizationIntent(f.sql, f.name)?.kind === "adds"
        );
        expect(adds).toHaveLength(1);
        const [file] = adds;
        expect(parseLocalizationIntent(file.sql, file.name)?.entity).toBe(
          entity
        );
        const { up, down } = sections(file.sql);
        expect(up).toMatch(
          new RegExp(
            `ALTER TABLE ${escape(q(`${table}_locales`))} ADD COLUMN ${escape(q("summary"))}`
          )
        );
        expect(up).not.toContain(q("body"));
        expect(down).toMatch(
          new RegExp(
            `ALTER TABLE ${escape(q(`${table}_locales`))} DROP COLUMN ${escape(q("summary"))}`
          )
        );
      }
    );

    it("writes nothing more once the column is recorded", async () => {
      const files = await filesAdding(
        dialect,
        "collections",
        translated("dc_docs", [BODY, SUMMARY]),
        translated("dc_docs", [BODY, SUMMARY])
      );
      expect(files).toEqual([]);
    });

    // Its per-language unique index is the `unique` file's, which needs the column first.
    it("adds a translated Unique field's column before the file that indexes it", async () => {
      const files = await filesAdding(
        dialect,
        "collections",
        translated("dc_docs", [BODY]),
        translated("dc_docs", [BODY, { ...SUMMARY, unique: true }])
      );
      const kinds = files.map(
        f => parseLocalizationIntent(f.sql, f.name)?.kind
      );
      expect(kinds).toContain("adds");
      expect(kinds).toContain("unique");
      expect(kinds.indexOf("adds")).toBeLessThan(kinds.indexOf("unique"));
    });
  }
);

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
