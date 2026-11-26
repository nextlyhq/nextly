/**
 * One `migrate:create` run that both changes a table in a way SQLite applies by rebuilding it (a
 * column made required) and turns translation on for its entity. The main file runs first and the
 * translation file after it copies each translated column's values into the translations table
 * before it drops them, so the main file must leave those columns, and their values, where they
 * are. On SQLite the rebuild copies the rows into the table the main file declares, so a declared
 * table without them dropped every value before the translation file read it.
 *
 * Checked by what `nextly migrate` leaves: each document's values in its default language's row,
 * the column made required, and the main table without the moved columns, on every dialect.
 *
 * The plausible broken plan: a rebuild to the desired table, which loses the values on SQLite and
 * fails the translation file.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it } from "vitest";

import { migrateCore } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { resolveDataLossConsent } from "../../migrate/data-loss-consent";
import { generateMigration, type MinimalConfigEntity } from "../generate";

let current: TestNextly | undefined;
let dir: string | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

/** `rkv_notes`: a text `heading` and `body`, translated or not, and a `views` count. */
const notes = (
  localized: boolean,
  viewsRequired: boolean
): MinimalConfigEntity => ({
  slug: "rkv_notes",
  tableName: "dc_rkv_notes",
  localized,
  fields: [
    { name: "heading", type: "text", localized },
    { name: "body", type: "textarea", localized },
    { name: "views", type: "number", required: viewsRequired },
  ],
});

describe.each(getConfiguredTestDialects())(
  "a run that rebuilds a table and turns its translation on (%s)",
  dialect => {
    const q = (id: string) => (dialect === "mysql" ? `\`${id}\`` : `"${id}"`);

    it("keeps every value the translation file moves", async () => {
      current = await createTestNextly({ dialect });
      const adapter = current.adapter as unknown as DrizzleAdapter;
      const query = async (statement: string) =>
        (await adapter.executeQuery(statement)) as unknown as Record<
          string,
          unknown
        >[];
      dir = await mkdtemp(join(tmpdir(), "nextly-rebuild-keeps-values-"));
      const migrationsDir = dir;
      const generate = (
        entity: MinimalConfigEntity,
        name: string,
        at: string
      ) =>
        generateMigration({
          name,
          dialect,
          migrationsDir,
          fieldGroupNaming: "current",
          defaultLocale: "en",
          collections: [entity],
          singles: [],
          components: [],
          nonInteractive: true,
          now: new Date(at),
        });
      const migrate = () =>
        migrateCore({
          extensionSchema: undefined,
          dialect,
          db: adapter.getDrizzle(),
          adapter: adapter as never,
          migrationsDir,
          logger: createLogger({ quiet: true }),
          lockMode: "fail-fast",
          // The translation file drops the main columns once their values are copied. MySQL
          // judges a column made NOT NULL a deletion too, since it would empty a null value.
          consent: resolveDataLossConsent({
            flag:
              dialect === "mysql"
                ? "dc_rkv_notes.heading,dc_rkv_notes.body,dc_rkv_notes.views"
                : "dc_rkv_notes.heading,dc_rkv_notes.body",
            env: {},
          }),
          interactive: false,
        } as never);

      await generate(notes(false, false), "one", "2026-11-23T10:00:00.000Z");
      await migrate();
      await query(
        `INSERT INTO ${q("dc_rkv_notes")} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("heading")}, ${q("body")}, ${q("views")}) VALUES ('n1', 'Note one', 'note-one', 'First', 'One body', 3), ('n2', 'Note two', 'note-two', 'Second', 'Two body', 5)`
      );

      await generate(notes(true, true), "two", "2026-11-23T11:00:00.000Z");
      const files = (await readdir(migrationsDir)).filter(f =>
        f.endsWith(".sql")
      );
      expect(files.some(f => /enable_localization_rkv_notes/.test(f))).toBe(
        true
      );
      await migrate();

      const rows = await query(
        `SELECT ${q("_parent")} AS parent, ${q("_locale")} AS locale, ${q("heading")} AS heading, ${q("body")} AS body FROM ${q("dc_rkv_notes_locales")} ORDER BY ${q("_parent")}`
      );
      expect(rows.map(row => ({ ...row }))).toEqual([
        { parent: "n1", locale: "en", heading: "First", body: "One body" },
        { parent: "n2", locale: "en", heading: "Second", body: "Two body" },
      ]);
      const views = await query(
        `SELECT ${q("views")} AS views FROM ${q("dc_rkv_notes")} ORDER BY ${q("id")}`
      );
      expect(views.map(row => Number(row.views))).toEqual([3, 5]);
      // The moved columns are gone from the main table, and `views` is required there.
      await expect(
        query(
          `INSERT INTO ${q("dc_rkv_notes")} (${q("id")}, ${q("views")}) VALUES ('n3', NULL)`
        )
      ).rejects.toThrow();
      await expect(
        query(`SELECT ${q("heading")} FROM ${q("dc_rkv_notes")}`)
      ).rejects.toThrow();
    });
  }
);
